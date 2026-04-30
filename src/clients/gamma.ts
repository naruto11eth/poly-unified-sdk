import { fetchJson, buildQuery } from "../http.js";
import { resolveSingleMarket, extractMarketsPayload, normalizeMarket } from "../normalize.js";
import type { FetchLike, Market } from "../types.js";

const DEFAULT_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";

export interface GammaClientOptions {
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
}

export interface GetBySlugOptions {
  readonly conditionId?: string;
  readonly marketId?: string;
}

/**
 * Read-only client for Polymarket's Gamma API (markets, events).
 *
 * Tolerant on input, strict on output: every method returns a normalized
 * `Market` (or array of) with `raw` preserved.
 */
export class GammaClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: GammaClientOptions = {}) {
    this.fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
    this.baseUrl = options.baseUrl ?? DEFAULT_GAMMA_BASE_URL;
  }

  /**
   * Resolve a slug to a single normalized Market. Tries `/markets/slug/:slug` first,
   * falls back to `/events/slug/:slug` for event-shaped responses.
   *
   * @throws MarketAmbiguityError if the slug resolves to multiple markets and `opts` did not narrow.
   */
  async getBySlug(slug: string, opts: GetBySlugOptions = {}): Promise<Market | null> {
    // Try /markets/slug/:slug first.
    const marketsRes = await tryFetch<unknown>(
      this.fetchImpl,
      `${this.baseUrl}/markets/slug/${encodeURIComponent(slug)}`,
    );
    if (marketsRes !== null) {
      const resolved = resolveSingleMarket(marketsRes, slug, opts);
      if (resolved) return resolved;
    }

    // Fall back to /events/slug/:slug for event-shaped slugs.
    const eventsRes = await tryFetch<unknown>(
      this.fetchImpl,
      `${this.baseUrl}/events/slug/${encodeURIComponent(slug)}`,
    );
    if (eventsRes !== null) {
      return resolveSingleMarket(eventsRes, slug, opts);
    }

    return null;
  }

  /** Resolve a market by exact conditionId. */
  async getByConditionId(conditionId: string): Promise<Market | null> {
    const url = `${this.baseUrl}/markets${buildQuery({ condition_ids: conditionId })}`;
    const res = await fetchJson<unknown>(this.fetchImpl, url);
    return resolveSingleMarket(res, conditionId, { conditionId });
  }

  /** List markets with optional filters. */
  async list(query: Record<string, string | number | boolean | undefined> = {}): Promise<Market[]> {
    const url = `${this.baseUrl}/markets${buildQuery(query)}`;
    const res = await fetchJson<unknown>(this.fetchImpl, url);
    const flat = extractMarketsPayload(res);
    return flat.map((m) => normalizeMarket(m));
  }
}

/**
 * Internal helper: fetch but return null on 404, throw on everything else.
 * Lets `getBySlug` cleanly fall through from /markets to /events.
 */
async function tryFetch<T>(fetchImpl: FetchLike, url: string): Promise<T | null> {
  try {
    return await fetchJson<T>(fetchImpl, url);
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      "status" in err &&
      (err as { status: number }).status === 404
    ) {
      return null;
    }
    throw err;
  }
}
