/**
 * Public types for the Polymarket Unified SDK.
 *
 * - `Market` and `Position` are the normalized, stable shapes consumers should depend on.
 * - `raw` is preserved on every normalized object for fields the SDK does not surface.
 * - `ClobClientLike` and `FetchLike` are structurally-typed DI seams so tests substitute fakes.
 */

import type {
  ApiKeyCreds,
  Chain,
  CreateOrderOptions,
  OrderBookSummary,
  OrderType,
  Side,
  SignedOrder,
  SignatureTypeV2,
  TickSize,
  UserMarketOrderV2,
} from "@polymarket/clob-client-v2";

// =============================================================================
// Market & outcomes
// =============================================================================

export interface MarketOutcome {
  /** Outcome label as Polymarket displays it ("Yes", "No", or candidate name). */
  readonly name: string;
  /** ERC-1155 conditional token ID (decimal string from Gamma). */
  readonly tokenId: string;
}

export interface Market {
  readonly conditionId: string;
  readonly slug: string;
  readonly question: string;
  readonly outcomes: ReadonlyArray<MarketOutcome>;
  /**
   * Minimum price increment. Polymarket tick sizes are one of "0.1" | "0.01" | "0.001" | "0.0001".
   * We hold the numeric form so price math is unambiguous; cast to the SDK's `TickSize` literal at the boundary.
   */
  readonly tickSize: number;
  readonly negRisk: boolean;
  /** Smallest tradable size (shares for SELL, USDC for BUY). */
  readonly minOrderSize: number;
  readonly closed: boolean;
  /** Optional Gamma `id` (distinct from conditionId; useful for disambiguation). */
  readonly marketId?: string;
  /** The original Gamma payload, untouched. */
  readonly raw: unknown;
}

// =============================================================================
// Quote (output of orders.quote)
// =============================================================================

export interface Quote {
  readonly market: Market;
  readonly outcome: MarketOutcome;
  readonly side: "BUY" | "SELL";
  /** Caller's input — USDC for BUY, shares for SELL. */
  readonly amount: number;
  /** Average fill price returned by `clob.calculateMarketPrice` (FOK). */
  readonly avgPrice: number;
  /** Slippage-padded, tick-rounded worst-price cap that goes onto the signed order. */
  readonly worstPrice: number;
  /** Estimated shares filled at `avgPrice` (BUY: amount / avgPrice; SELL: amount). */
  readonly expectedShares: number;
  /** Estimated USDC cost at `avgPrice` (BUY: amount; SELL: amount * avgPrice). */
  readonly expectedCost: number;
  readonly slippageBps: number;
  /** Tick used for rounding (numeric form of `Market.tickSize`). */
  readonly tickSize: number;
  /**
   * Best-effort fee estimate using the documented formula `C × feeRate × p × (1-p)`.
   * Actual fees are applied at match time and authoritative on the receipt.
   */
  readonly feeUsd: number | undefined;
  /** Raw orderbook snapshot if fetched, otherwise undefined. */
  readonly raw?: unknown;
}

// =============================================================================
// Order placement args (discriminated union — the live-trading guardrail)
// =============================================================================

export interface PlaceOrderBase {
  readonly market: Market;
  readonly outcome: string;
  readonly side: "BUY" | "SELL";
  /** USDC for BUY, shares for SELL. Same semantics as the Quote input. */
  readonly amount: number;
  readonly slippageBps?: number;
}

/** Sign and inspect — never submits. Bypasses both gates. */
export interface PlaceOrderDryRunArgs extends PlaceOrderBase {
  readonly dryRun: true;
  readonly confirm?: never;
}

/**
 * Live submission. Requires the literal `true` (rejects `confirm: someBoolean`).
 * Also requires runtime `enableLiveTrading` on the client.
 */
export interface PlaceOrderLiveArgs extends PlaceOrderBase {
  readonly dryRun?: false;
  readonly confirm: true;
}

export type PlaceOrderArgs = PlaceOrderDryRunArgs | PlaceOrderLiveArgs;

// =============================================================================
// Order receipt and dryRun result
// =============================================================================

export interface OrderReceipt {
  readonly status: string;
  readonly orderId: string;
  readonly transactionHashes: ReadonlyArray<string>;
  readonly takingAmount: string;
  readonly raw: unknown;
}

export interface DryRunResult {
  readonly kind: "dryRun";
  readonly signedOrder: SignedOrder;
  readonly userMarketOrder: UserMarketOrderV2;
  readonly options: CreateOrderOptions;
}

// =============================================================================
// Position
// =============================================================================

export interface Position {
  readonly conditionId: string;
  readonly outcome: string;
  readonly title: string;
  readonly size: number;
  readonly avgPrice: number;
  readonly currentValue: number;
  readonly cashPnl: number;
  readonly percentPnl: number;
  readonly endDate: string | undefined;
  readonly redeemable: boolean;
  readonly mergeable: boolean;
  readonly negativeRisk: boolean;
  readonly raw: unknown;
}

// =============================================================================
// runWorkflow
// =============================================================================

/** Shared fields for both runWorkflow modes. */
export interface RunWorkflowBaseInput {
  readonly slug: string;
  readonly conditionId?: string;
  readonly marketId?: string;
  readonly outcome: string;
  readonly side: "BUY" | "SELL";
  readonly amount: number;
  readonly slippageBps?: number;
  readonly user?: `0x${string}`;
}

/** Run the journey end-to-end without submitting. Bypasses both gates. */
export interface RunWorkflowDryRunInput extends RunWorkflowBaseInput {
  readonly dryRun: true;
  readonly confirm?: never;
}

/**
 * Run the journey live. Requires the literal `true` (rejects `confirm: someBoolean`)
 * AND `enableLiveTrading: true` on the client at runtime. Symmetric with
 * `client.orders.place` so the intent gate is uniform across the public API.
 */
export interface RunWorkflowLiveInput extends RunWorkflowBaseInput {
  readonly dryRun?: false;
  readonly confirm: true;
}

export type RunWorkflowInput = RunWorkflowDryRunInput | RunWorkflowLiveInput;

export type RunWorkflowResult =
  | {
      readonly kind: "live";
      readonly market: Market;
      readonly quote: Quote;
      readonly receipt: OrderReceipt;
      readonly positions: ReadonlyArray<Position>;
    }
  | {
      readonly kind: "dryRun";
      readonly market: Market;
      readonly quote: Quote;
      readonly dryRun: DryRunResult;
      readonly positions: ReadonlyArray<Position>;
    };

// =============================================================================
// DI seams
// =============================================================================

/**
 * Structural subset of `@polymarket/clob-client-v2`'s ClobClient covering only
 * the methods our adapter and facade call. Tests substitute a fake; production
 * passes the real client instance.
 */
export interface ClobClientLike {
  /** Used by `PolymarketClient.create` for cred derivation (fallback path). */
  createApiKey(nonce?: number): Promise<ApiKeyCreds>;
  /** Used by `PolymarketClient.create` for cred derivation (preferred path). */
  deriveApiKey(nonce?: number): Promise<ApiKeyCreds>;
  /** Kept on the seam for API completeness; not used by the facade itself. */
  createOrDeriveApiKey(nonce?: number): Promise<ApiKeyCreds>;
  getTickSize(tokenId: string): Promise<TickSize>;
  getNegRisk(tokenId: string): Promise<boolean>;
  getOrderBook(tokenId: string): Promise<OrderBookSummary>;
  calculateMarketPrice(
    tokenId: string,
    side: Side,
    amount: number,
    orderType?: OrderType,
  ): Promise<number>;
  createMarketOrder(
    userMarketOrder: UserMarketOrderV2,
    options?: Partial<CreateOrderOptions>,
  ): Promise<SignedOrder>;
  postOrder(
    order: SignedOrder,
    orderType?: OrderType,
    postOnly?: boolean,
    deferExec?: boolean,
  ): Promise<unknown>;
}

/** Subset of the global `fetch` covering only the parts `http.ts` uses. */
export type FetchLike = (
  input: string | URL,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

// =============================================================================
// Client config
// =============================================================================

export interface PolymarketClientConfig {
  readonly privateKey: `0x${string}`;
  readonly funderAddress: `0x${string}`;
  /** Defaults to `SignatureTypeV2.POLY_GNOSIS_SAFE` (2). */
  readonly signatureType?: SignatureTypeV2;
  /** Defaults to `Chain.POLYGON` (137). */
  readonly chain?: Chain;
  /** Pre-derived API credentials. If omitted, the client derives via `createOrDeriveApiKey()`. */
  readonly creds?: ApiKeyCreds;
  /** Defaults to false. Required for live submission; bypassed by dryRun. */
  readonly enableLiveTrading?: boolean;
  readonly baseUrls?: {
    readonly clob?: string;
    readonly gamma?: string;
    readonly data?: string;
  };
}

/**
 * Test seam: pre-built sub-clients + fetch. Skips all viem/credential wiring.
 * Used by `PolymarketClient.fromDependencies(...)`.
 */
export interface PolymarketClientDependencies {
  readonly clob: ClobClientLike;
  readonly fetch: FetchLike;
  readonly funderAddress: `0x${string}`;
  readonly enableLiveTrading?: boolean;
  readonly baseUrls?: {
    readonly gamma?: string;
    readonly data?: string;
  };
}

// Re-exports so consumers of our SDK can use the underlying enums without a second import.
export {
  Side,
  OrderType,
  Chain,
  SignatureTypeV2,
} from "@polymarket/clob-client-v2";
export type {
  ApiKeyCreds,
  TickSize,
  SignedOrder,
  CreateOrderOptions,
  UserMarketOrderV2,
  OrderBookSummary,
} from "@polymarket/clob-client-v2";
