/**
 * Named error taxonomy. Every SDK error is an instance of `PolymarketWorkflowError`
 * so callers can `instanceof`-discriminate on the base type and narrow further on
 * specific subclasses.
 */

export class PolymarketWorkflowError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Any non-2xx HTTP response from gamma-api or data-api. */
export class PolymarketApiError extends PolymarketWorkflowError {
  readonly status: number;
  readonly body: unknown;
  readonly url: string | undefined;

  constructor(
    status: number,
    body: unknown,
    options?: { url?: string; cause?: unknown },
  ) {
    super(formatApiErrorMessage(status, body, options?.url), options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.status = status;
    this.body = body;
    this.url = options?.url;
  }
}

/** A slug or event resolution returned multiple candidate markets and the caller did not disambiguate. */
export class MarketAmbiguityError extends PolymarketWorkflowError {
  readonly slug: string;
  readonly candidates: ReadonlyArray<{
    conditionId?: string;
    marketId?: string;
    question?: string;
  }>;

  constructor(
    slug: string,
    candidates: MarketAmbiguityError["candidates"],
  ) {
    super(
      `Multiple markets matched slug "${slug}" (${candidates.length} candidates). ` +
        `Disambiguate by passing { conditionId } or { marketId }.`,
    );
    this.slug = slug;
    this.candidates = candidates;
  }
}

/** Caller asked for an outcome name that does not exist on the resolved market. */
export class MissingOutcomeError extends PolymarketWorkflowError {
  readonly outcome: string;
  readonly available: ReadonlyArray<string>;

  constructor(outcome: string, available: ReadonlyArray<string>) {
    super(
      `Outcome "${outcome}" not found on market. Available: [${available.join(", ")}].`,
    );
    this.outcome = outcome;
    this.available = available;
  }
}

/**
 * `orders.place` was called in live mode (not dryRun) but `enableLiveTrading`
 * is false in the client config / env. Bypassed entirely by `dryRun: true`.
 */
export class LiveTradingNotEnabledError extends PolymarketWorkflowError {
  constructor() {
    super(
      "Live trading is disabled. Set { enableLiveTrading: true } on the client " +
        "or POLYMARKET_ENABLE_LIVE_TRADING=true in env. " +
        "Use { dryRun: true } to sign without submitting.",
    );
  }
}

/**
 * The CLOB accepted the order request but rejected, killed, or otherwise failed it.
 * Carries the raw response so callers can inspect `errorMsg`, `status`, etc.
 */
export class OrderPlacementError extends PolymarketWorkflowError {
  readonly response: OrderPlacementErrorPayload;

  constructor(response: OrderPlacementErrorPayload) {
    super(formatPlacementErrorMessage(response));
    this.response = response;
  }
}

export interface OrderPlacementErrorPayload {
  success?: boolean;
  errorMsg?: string;
  status?: string;
  orderID?: string;
  raw?: unknown;
}

function formatApiErrorMessage(status: number, body: unknown, url?: string): string {
  const target = url ? ` (${url})` : "";
  if (status === 0) {
    return `Network error${target}: ${stringifyBodyHint(body)}`;
  }
  return `HTTP ${status}${target}: ${stringifyBodyHint(body)}`;
}

function formatPlacementErrorMessage(r: OrderPlacementErrorPayload): string {
  const parts: string[] = [];
  if (r.status) parts.push(`status="${r.status}"`);
  if (r.errorMsg) parts.push(`errorMsg="${r.errorMsg}"`);
  if (r.orderID) parts.push(`orderID=${r.orderID}`);
  return `Order placement failed${parts.length > 0 ? ": " + parts.join(", ") : "."}`;
}

function stringifyBodyHint(body: unknown): string {
  if (body == null) return "(no body)";
  if (typeof body === "string") return body.slice(0, 200);
  try {
    return JSON.stringify(body).slice(0, 200);
  } catch {
    return String(body).slice(0, 200);
  }
}
