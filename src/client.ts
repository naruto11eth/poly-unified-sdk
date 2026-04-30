import {
  Chain,
  ClobClient,
  SignatureTypeV2,
} from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { ClobAdapter } from "./clients/clob-adapter.js";
import { DataApiClient } from "./clients/data-api.js";
import { GammaClient } from "./clients/gamma.js";
import { LiveTradingNotEnabledError, OrderPlacementError } from "./errors.js";
import type {
  ClobClientLike,
  DryRunResult,
  FetchLike,
  Market,
  OrderReceipt,
  PlaceOrderArgs,
  PolymarketClientConfig,
  PolymarketClientDependencies,
  Position,
  Quote,
  RunWorkflowInput,
  RunWorkflowResult,
} from "./types.js";

const DEFAULT_CLOB_HOST = "https://clob.polymarket.com";

/**
 * The public entry point — Stripe-style resource namespace over Polymarket's
 * three back-end services.
 *
 * Two construction paths:
 *   - {@link PolymarketClient.create} — production: wires viem + clob-client-v2 + creds.
 *   - {@link PolymarketClient.fromDependencies} — tests: takes pre-built fakes.
 *
 * Sub-clients (`GammaClient`, `ClobAdapter`, `DataApiClient`) are also
 * exported as named exports for off-journey use.
 */
export class PolymarketClient {
  readonly markets: MarketsResource;
  readonly orders: OrdersResource;
  readonly positions: PositionsResource;

  private readonly clobAdapter: ClobAdapter;
  private readonly gamma: GammaClient;
  private readonly data: DataApiClient;
  private readonly funderAddress: `0x${string}`;
  private readonly enableLiveTrading: boolean;

  /** Use `PolymarketClient.create()` or `.fromDependencies()`. */
  private constructor(deps: {
    gamma: GammaClient;
    clobAdapter: ClobAdapter;
    data: DataApiClient;
    funderAddress: `0x${string}`;
    enableLiveTrading: boolean;
  }) {
    this.gamma = deps.gamma;
    this.clobAdapter = deps.clobAdapter;
    this.data = deps.data;
    this.funderAddress = deps.funderAddress;
    this.enableLiveTrading = deps.enableLiveTrading;

    this.markets = new MarketsResource(this.gamma);
    this.orders = new OrdersResource(this.clobAdapter, () => this.enableLiveTrading);
    this.positions = new PositionsResource(this.data, this.funderAddress);
  }

  /**
   * Production constructor: builds a viem account from `privateKey`, wires the
   * underlying `ClobClient` with sigType 2 + funder address, and derives API
   * credentials lazily on the first L2 call (or uses pre-supplied creds).
   */
  static async create(config: PolymarketClientConfig): Promise<PolymarketClient> {
    const account = privateKeyToAccount(config.privateKey);
    const walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(),
    });

    // The CLOB client's `ClobSigner` union accepts a viem `WalletClient`.
    let creds = config.creds;
    let clobClient = new ClobClient({
      host: config.baseUrls?.clob ?? DEFAULT_CLOB_HOST,
      chain: config.chain ?? Chain.POLYGON,
      signer: walletClient,
      ...(creds !== undefined ? { creds } : {}),
      signatureType: config.signatureType ?? SignatureTypeV2.POLY_GNOSIS_SAFE,
      funderAddress: config.funderAddress,
      throwOnError: true, // we always throw — never return { error, status }
    });

    // Derive API credentials if not supplied.
    //
    // Order matters: try `deriveApiKey` (read existing) BEFORE `createApiKey`.
    // Reasoning: clob-client-v2's `createOrDeriveApiKey` tries create first and
    // falls back to derive only on certain errors. With our `throwOnError: true`
    // setting, a 400 "Could not create api key" (returned when a key already
    // exists for this wallet at this nonce) propagates up before the fallback
    // can fire. Inverting the order handles both cases cleanly:
    //   - Returning wallet (key exists): deriveApiKey returns it.
    //   - First-time wallet (no key):    deriveApiKey 404s; createApiKey runs.
    if (creds === undefined) {
      try {
        creds = await clobClient.deriveApiKey(0);
      } catch {
        creds = await clobClient.createApiKey(0);
      }
      clobClient = new ClobClient({
        host: config.baseUrls?.clob ?? DEFAULT_CLOB_HOST,
        chain: config.chain ?? Chain.POLYGON,
        signer: walletClient,
        creds,
        signatureType: config.signatureType ?? SignatureTypeV2.POLY_GNOSIS_SAFE,
        funderAddress: config.funderAddress,
        throwOnError: true,
      });
    }

    const gamma = new GammaClient(
      config.baseUrls?.gamma !== undefined ? { baseUrl: config.baseUrls.gamma } : {},
    );
    const data = new DataApiClient(
      config.baseUrls?.data !== undefined ? { baseUrl: config.baseUrls.data } : {},
    );
    const clobAdapter = new ClobAdapter({ clob: clobClient });

    return new PolymarketClient({
      gamma,
      clobAdapter,
      data,
      funderAddress: config.funderAddress,
      enableLiveTrading: config.enableLiveTrading ?? false,
    });
  }

  /**
   * Test seam. Pre-built `clob` (any `ClobClientLike`) + `fetch` (any `FetchLike`)
   * skip all viem and credential wiring. Vitest uses this exclusively.
   */
  static fromDependencies(deps: PolymarketClientDependencies): PolymarketClient {
    const gamma = new GammaClient({
      fetch: deps.fetch,
      ...(deps.baseUrls?.gamma !== undefined ? { baseUrl: deps.baseUrls.gamma } : {}),
    });
    const data = new DataApiClient({
      fetch: deps.fetch,
      ...(deps.baseUrls?.data !== undefined ? { baseUrl: deps.baseUrls.data } : {}),
    });
    const clobAdapter = new ClobAdapter({ clob: deps.clob });
    return new PolymarketClient({
      gamma,
      clobAdapter,
      data,
      funderAddress: deps.funderAddress,
      enableLiveTrading: deps.enableLiveTrading ?? false,
    });
  }

  /**
   * The four-step journey stitched together. Returns a discriminated union
   * — `kind: 'live'` after a real submission, `kind: 'dryRun'` after signing only.
   *
   * `OrderPlacementError` from `orders.place` short-circuits before `positions.list`
   * is called.
   */
  async runWorkflow(input: RunWorkflowInput): Promise<RunWorkflowResult> {
    const market = await this.markets.get({
      slug: input.slug,
      ...(input.conditionId !== undefined ? { conditionId: input.conditionId } : {}),
      ...(input.marketId !== undefined ? { marketId: input.marketId } : {}),
    });
    if (!market) {
      throw new Error(`Market not found for slug "${input.slug}"`);
    }

    const quote = await this.orders.quote({
      market,
      outcome: input.outcome,
      side: input.side,
      amount: input.amount,
      ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
    });

    const placeArgs: PlaceOrderArgs =
      input.dryRun === true
        ? {
            market,
            outcome: input.outcome,
            side: input.side,
            amount: input.amount,
            ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
            dryRun: true,
          }
        : {
            market,
            outcome: input.outcome,
            side: input.side,
            amount: input.amount,
            ...(input.slippageBps !== undefined ? { slippageBps: input.slippageBps } : {}),
            confirm: true,
          };

    // Pass the already-computed `quote` so `place` doesn't re-fetch via
    // `calculateMarketPrice`. This avoids a redundant CLOB round-trip and,
    // more importantly, prevents the displayed quote from diverging from
    // the actually-signed worst-price if the orderbook moves between calls.
    //
    // OrderPlacementError throws here — the next line never runs.
    // That's the kill short-circuit: positions.list is only reached on success.
    const placement = await this.orders.place(placeArgs, { quote });

    const positions = await this.positions.list({
      ...(input.user !== undefined ? { user: input.user } : { user: this.funderAddress }),
      market: market.conditionId,
    });

    if ("kind" in placement && placement.kind === "dryRun") {
      return { kind: "dryRun", market, quote, dryRun: placement, positions };
    }
    return { kind: "live", market, quote, receipt: placement as OrderReceipt, positions };
  }
}

// =============================================================================
// Resource classes — Stripe-style namespace
// =============================================================================

class MarketsResource {
  constructor(private readonly gamma: GammaClient) {}

  get(args: { slug: string; conditionId?: string; marketId?: string }): Promise<Market | null> {
    const opts: { conditionId?: string; marketId?: string } = {};
    if (args.conditionId !== undefined) opts.conditionId = args.conditionId;
    if (args.marketId !== undefined) opts.marketId = args.marketId;
    return this.gamma.getBySlug(args.slug, opts);
  }

  getByConditionId(conditionId: string): Promise<Market | null> {
    return this.gamma.getByConditionId(conditionId);
  }

  list(query?: Record<string, string | number | boolean | undefined>): Promise<Market[]> {
    return this.gamma.list(query);
  }
}

class OrdersResource {
  constructor(
    private readonly adapter: ClobAdapter,
    private readonly liveTradingEnabled: () => boolean,
  ) {}

  quote(args: {
    market: Market;
    outcome: string;
    side: "BUY" | "SELL";
    amount: number;
    slippageBps?: number;
  }): Promise<Quote> {
    const slippageBpsArg: { slippageBps?: number } = {};
    if (args.slippageBps !== undefined) slippageBpsArg.slippageBps = args.slippageBps;
    return this.adapter.quoteFok({
      market: args.market,
      outcome: args.outcome,
      side: args.side,
      amount: args.amount,
      ...slippageBpsArg,
    });
  }

  /**
   * Place a market order. Discriminated union enforces:
   *   - dryRun mode: never submits, bypasses both gates.
   *   - live mode: requires literal `confirm: true` (compile-time) AND
   *                `enableLiveTrading` on the client (runtime).
   *
   * Optional `quote`: callers who already computed a quote (e.g., `runWorkflow`
   * after calling `orders.quote`) can pass it to avoid a redundant
   * `calculateMarketPrice` round-trip. When omitted, a fresh quote is computed.
   * Without this, the displayed quote and the actually-signed worst-price could
   * diverge if the orderbook moved between the two calls.
   */
  async place(
    args: PlaceOrderArgs,
    options: { quote?: Quote } = {},
  ): Promise<OrderReceipt | DryRunResult> {
    if (args.dryRun !== true && !this.liveTradingEnabled()) {
      throw new LiveTradingNotEnabledError();
    }
    let quote = options.quote;
    if (quote === undefined) {
      const slippageBpsArg: { slippageBps?: number } = {};
      if (args.slippageBps !== undefined) slippageBpsArg.slippageBps = args.slippageBps;
      quote = await this.adapter.quoteFok({
        market: args.market,
        outcome: args.outcome,
        side: args.side,
        amount: args.amount,
        ...slippageBpsArg,
      });
    }
    return this.adapter.placeFok(quote, args);
  }
}

class PositionsResource {
  constructor(
    private readonly data: DataApiClient,
    private readonly defaultUser: `0x${string}`,
  ) {}

  list(args: { user?: `0x${string}`; market?: string; eventId?: string } = {}): Promise<Position[]> {
    const params: { user: `0x${string}`; market?: string; eventId?: string } = {
      user: args.user ?? this.defaultUser,
    };
    if (args.market !== undefined) params.market = args.market;
    if (args.eventId !== undefined) params.eventId = args.eventId;
    return this.data.list(params);
  }
}

// Re-export the OrderPlacementError so callers using `runWorkflow` can catch it.
export { OrderPlacementError };
