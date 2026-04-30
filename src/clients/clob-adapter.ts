import {
  OrderType,
  Side,
  type CreateOrderOptions,
  type SignedOrder,
  type TickSize,
  type UserMarketOrderV2,
} from "@polymarket/clob-client-v2";
import { MissingOutcomeError, OrderPlacementError, type OrderPlacementErrorPayload } from "../errors.js";
import { applySlippage, roundPriceToTick } from "../price.js";
import type {
  ClobClientLike,
  DryRunResult,
  Market,
  MarketOutcome,
  OrderReceipt,
  PlaceOrderArgs,
  Quote,
} from "../types.js";

/** Placement statuses we treat as successful enough to return a receipt. */
const SUCCESSFUL_STATUSES = new Set([
  "matched",
  "delayed",
  "live",
  "unmatched", // FAK case where book moved; for FOK this would have errored already
]);

/** Placement statuses we always treat as failure — short-circuit `runWorkflow`. */
const FAILURE_STATUSES = new Set(["failed", "killed", "rejected", "canceled", "cancelled"]);

export interface ClobAdapterOptions {
  readonly clob: ClobClientLike;
}

/**
 * Uniform wrapper around `@polymarket/clob-client-v2`'s ClobClient.
 *
 * Why the wrap rather than re-export:
 *   1. We always throw named errors. The underlying client returns `{ error, status }`
 *      objects by default; we eliminate that quirk at the boundary.
 *   2. We translate raw OrderResponse into a typed `OrderReceipt` for live trades,
 *      or a `DryRunResult` carrying the signed payload for inspection.
 *   3. We hold the BUY-ceil/SELL-floor tick rounding invariant inside `quoteFok`.
 */
export class ClobAdapter {
  private readonly clob: ClobClientLike;

  constructor(options: ClobAdapterOptions) {
    this.clob = options.clob;
  }

  /** Pass-through. */
  getTickSize(tokenId: string): Promise<TickSize> {
    return this.clob.getTickSize(tokenId);
  }

  /** Pass-through. */
  getNegRisk(tokenId: string): Promise<boolean> {
    return this.clob.getNegRisk(tokenId);
  }

  /**
   * FOK quote: average fill price from `calculateMarketPrice`, padded by slippage,
   * tick-rounded with BUY ceil / SELL floor, plus a best-effort fee estimate.
   */
  async quoteFok(args: {
    market: Market;
    outcome: string;
    side: "BUY" | "SELL";
    amount: number;
    slippageBps?: number;
  }): Promise<Quote> {
    const outcome = resolveOutcome(args.market, args.outcome);
    const slippageBps = args.slippageBps ?? 100;

    const sdkSide = args.side === "BUY" ? Side.BUY : Side.SELL;
    const avgPrice = await this.clob.calculateMarketPrice(
      outcome.tokenId,
      sdkSide,
      args.amount,
      OrderType.FOK,
    );

    const padded = applySlippage(avgPrice, args.side, slippageBps);
    const worstPrice = roundPriceToTick(padded, args.market.tickSize, args.side);

    const expectedShares = args.side === "BUY" ? args.amount / avgPrice : args.amount;
    const expectedCost = args.side === "BUY" ? args.amount : args.amount * avgPrice;
    const feeUsd = estimateFeeUsd(expectedCost, avgPrice);

    return {
      market: args.market,
      outcome,
      side: args.side,
      amount: args.amount,
      avgPrice,
      worstPrice,
      expectedShares,
      expectedCost,
      slippageBps,
      tickSize: args.market.tickSize,
      feeUsd,
    };
  }

  /**
   * Build a `UserMarketOrderV2`, sign it via `createMarketOrder`. If `dryRun: true`,
   * return the signed payload and stop. Otherwise call `postOrder` with `OrderType.FOK`,
   * validate the response, and return a typed `OrderReceipt`.
   *
   * @throws OrderPlacementError on response failure
   */
  async placeFok(quote: Quote, args: PlaceOrderArgs): Promise<OrderReceipt | DryRunResult> {
    const userOrder: UserMarketOrderV2 = {
      tokenID: quote.outcome.tokenId,
      price: quote.worstPrice,
      amount: quote.amount,
      side: quote.side === "BUY" ? Side.BUY : Side.SELL,
      orderType: OrderType.FOK,
    };
    const options: CreateOrderOptions = {
      tickSize: numberToTickSize(quote.tickSize),
      negRisk: quote.market.negRisk,
    };

    const signed: SignedOrder = await this.clob.createMarketOrder(userOrder, options);

    if (args.dryRun === true) {
      return {
        kind: "dryRun",
        signedOrder: signed,
        userMarketOrder: userOrder,
        options,
      };
    }

    const rawResponse = await this.clob.postOrder(signed, OrderType.FOK);
    const response = coerceOrderResponse(rawResponse);
    validateFokOrderResponse(response);

    return {
      status: response.status ?? "matched",
      orderId: response.orderID ?? "",
      transactionHashes: response.transactionsHashes ?? [],
      takingAmount: response.takingAmount ?? "",
      raw: response,
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Case-insensitive outcome lookup. */
export function resolveOutcome(market: Market, outcomeName: string): MarketOutcome {
  const target = outcomeName.toLowerCase();
  const match = market.outcomes.find((o) => o.name.toLowerCase() === target);
  if (!match) {
    throw new MissingOutcomeError(
      outcomeName,
      market.outcomes.map((o) => o.name),
    );
  }
  return match;
}

/**
 * Reject any CLOB response that signals failure. The four equivalent failure
 * modes — `success: false`, non-empty `errorMsg`, terminal failure status, or
 * `status: undefined` with no orderID — all become `OrderPlacementError`.
 */
export function validateFokOrderResponse(response: ClobOrderResponse): void {
  if (response.success === false) {
    throw new OrderPlacementError(toErrorPayload(response));
  }
  if (typeof response.errorMsg === "string" && response.errorMsg.length > 0) {
    throw new OrderPlacementError(toErrorPayload(response));
  }
  const status = response.status?.toLowerCase();
  if (status && FAILURE_STATUSES.has(status)) {
    throw new OrderPlacementError(toErrorPayload(response));
  }
  if (status && !SUCCESSFUL_STATUSES.has(status)) {
    // Unknown status — be conservative, treat as failure rather than silently succeed.
    throw new OrderPlacementError(toErrorPayload(response));
  }
}

interface ClobOrderResponse {
  success?: boolean;
  errorMsg?: string;
  orderID?: string;
  transactionsHashes?: string[];
  status?: string;
  takingAmount?: string;
}

function coerceOrderResponse(raw: unknown): ClobOrderResponse {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ClobOrderResponse;
  }
  // Defensive: clob-client-v2 types this as `Promise<any>`. If we get something
  // truly unexpected, fail fast with a structured error.
  throw new OrderPlacementError({
    success: false,
    errorMsg: "Unexpected response shape from clob.postOrder",
    raw,
  });
}

function toErrorPayload(response: ClobOrderResponse): OrderPlacementErrorPayload {
  const payload: OrderPlacementErrorPayload = { raw: response };
  if (response.success !== undefined) payload.success = response.success;
  if (response.errorMsg !== undefined) payload.errorMsg = response.errorMsg;
  if (response.status !== undefined) payload.status = response.status;
  if (response.orderID !== undefined) payload.orderID = response.orderID;
  return payload;
}

/** Polymarket fee formula: C × feeRate × p × (1−p). Uses a default rate of 2% as a placeholder. */
function estimateFeeUsd(notionalUsd: number, price: number): number | undefined {
  if (!Number.isFinite(notionalUsd) || !Number.isFinite(price)) return undefined;
  if (price <= 0 || price >= 1) return 0;
  // Default fee rate kept conservative — actual rate comes from the matching engine.
  // Fee transparency is the whole purpose of surfacing this estimate.
  const defaultFeeRate = 0.02;
  return notionalUsd * defaultFeeRate * price * (1 - price);
}

/** Coerce numeric tickSize to the SDK's `TickSize` literal type. */
function numberToTickSize(n: number): TickSize {
  // Polymarket only allows these four. Anything else is a bug elsewhere.
  if (n === 0.1) return "0.1";
  if (n === 0.01) return "0.01";
  if (n === 0.001) return "0.001";
  if (n === 0.0001) return "0.0001";
  // Fall back to the closest legal tick. This shouldn't trigger if Gamma is well-formed.
  if (n >= 0.05) return "0.1";
  if (n >= 0.005) return "0.01";
  if (n >= 0.0005) return "0.001";
  return "0.0001";
}
