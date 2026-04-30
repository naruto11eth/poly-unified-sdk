/**
 * Tolerant Gamma payload normalization.
 *
 * Gamma returns inconsistent shapes:
 *   - some endpoints return a single market object,
 *   - some return an array,
 *   - some return an event object with `markets: [...]` nested inside,
 *   - boolean/number fields arrive in snake_case OR camelCase,
 *   - `outcomes` and `clobTokenIds` may be JSON-stringified arrays.
 *
 * The normalize layer absorbs all of this and produces a stable `Market`
 * shape with the original payload preserved as `raw`.
 */

import { MarketAmbiguityError } from "./errors.js";
import type { Market, MarketOutcome } from "./types.js";

type Json = Record<string, unknown>;

// =============================================================================
// Field-level helpers
// =============================================================================

export function stringField(obj: Json, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function booleanField(obj: Json, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "boolean") return v;
  }
  return undefined;
}

export function numberField(obj: Json, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** Tick size lives under several names depending on the endpoint. Returns numeric form. */
export function tickSizeField(obj: Json): number | undefined {
  return numberField(obj, "orderPriceMinTickSize", "min_tick_size", "tickSize", "tick_size");
}

/** Outcomes / clobTokenIds arrive as either arrays or JSON-stringified arrays. */
export function parseMaybeJsonArray<T = unknown>(value: unknown): ReadonlyArray<T> | undefined {
  if (Array.isArray(value)) return value as ReadonlyArray<T>;
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as ReadonlyArray<T>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function arrayField<T = unknown>(obj: Json, ...keys: string[]): ReadonlyArray<T> | undefined {
  for (const key of keys) {
    const parsed = parseMaybeJsonArray<T>(obj[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

// =============================================================================
// Payload extraction (3 Gamma response shapes)
// =============================================================================

/**
 * Flattens the three Gamma response shapes into a flat array of market objects:
 *   - single market: `{ conditionId, ... }`         → [{ ... }]
 *   - market list:   `[{ ... }, { ... }]`           → as-is
 *   - event:         `{ markets: [{ ... }, ... ] }` → contained markets, with parent-event fields hoisted
 */
export function extractMarketsPayload(response: unknown): Json[] {
  if (Array.isArray(response)) {
    // Could be a list of markets OR a list of events. Detect by first element.
    const flattened: Json[] = [];
    for (const item of response) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const obj = item as Json;
        if (Array.isArray(obj.markets)) {
          flattened.push(...hoistEventMarkets(obj));
        } else if (looksLikeMarket(obj)) {
          flattened.push(obj);
        }
      }
    }
    return flattened;
  }
  if (response && typeof response === "object") {
    const obj = response as Json;
    if (Array.isArray(obj.markets)) {
      return hoistEventMarkets(obj);
    }
    if (looksLikeMarket(obj)) {
      return [obj];
    }
  }
  return [];
}

function looksLikeMarket(obj: Json): boolean {
  return (
    stringField(obj, "conditionId", "condition_id") !== undefined ||
    stringField(obj, "id") !== undefined
  );
}

/** Hoist event-level fields (slug, end_date, etc.) onto each market when missing. */
function hoistEventMarkets(event: Json): Json[] {
  const markets = (event.markets as unknown[]) ?? [];
  const eventSlug = stringField(event, "slug");
  const eventTitle = stringField(event, "title", "question");
  return markets
    .filter((m): m is Json => m !== null && typeof m === "object" && !Array.isArray(m))
    .map((m) => {
      const result: Json = { ...m };
      if (eventSlug && stringField(result, "eventSlug", "event_slug") === undefined) {
        result.eventSlug = eventSlug;
      }
      if (eventTitle && stringField(result, "eventTitle") === undefined) {
        result.eventTitle = eventTitle;
      }
      return result;
    });
}

// =============================================================================
// Filter / disambiguation
// =============================================================================

export interface FilterOptions {
  readonly conditionId?: string;
  readonly marketId?: string;
}

export function filterMarkets(markets: Json[], opts: FilterOptions = {}): Json[] {
  let filtered = markets;
  if (opts.conditionId) {
    const target = opts.conditionId.toLowerCase();
    filtered = filtered.filter((m) => {
      const cid = stringField(m, "conditionId", "condition_id");
      return cid != null && cid.toLowerCase() === target;
    });
  }
  if (opts.marketId) {
    filtered = filtered.filter((m) => stringField(m, "id") === opts.marketId);
  }
  return filtered;
}

// =============================================================================
// Normalize → Market
// =============================================================================

export function normalizeMarket(raw: Json): Market {
  const conditionId = stringField(raw, "conditionId", "condition_id");
  if (!conditionId) {
    throw new Error("normalizeMarket: missing conditionId");
  }
  const slug = stringField(raw, "slug") ?? conditionId;
  const question = stringField(raw, "question", "title") ?? "(no question)";

  const outcomes = parseMaybeJsonArray<string>(
    raw.outcomes ?? raw.outcomeNames ?? raw["outcome_names"],
  );
  const tokenIds = parseMaybeJsonArray<string>(
    raw.clobTokenIds ?? raw["clob_token_ids"] ?? raw.tokens ?? raw["token_ids"],
  );

  const builtOutcomes: MarketOutcome[] = [];
  if (outcomes && tokenIds && outcomes.length === tokenIds.length) {
    for (let i = 0; i < outcomes.length; i++) {
      const name = outcomes[i];
      const tokenId = tokenIds[i];
      if (typeof name === "string" && typeof tokenId === "string") {
        builtOutcomes.push({ name, tokenId });
      }
    }
  }

  const tickSize = tickSizeField(raw) ?? 0.01;
  const negRisk =
    booleanField(raw, "negRisk", "neg_risk", "negativeRisk", "negative_risk") ?? false;
  const minOrderSize =
    numberField(raw, "orderMinSize", "min_order_size", "minOrderSize") ?? 0;
  const closed = booleanField(raw, "closed") ?? false;
  const marketId = stringField(raw, "id");

  const result: Market = {
    conditionId,
    slug,
    question,
    outcomes: builtOutcomes,
    tickSize,
    negRisk,
    minOrderSize,
    closed,
    raw,
    ...(marketId !== undefined ? { marketId } : {}),
  };
  return result;
}

/**
 * Resolves a Gamma response down to a single normalized Market, applying
 * `filterMarkets` for disambiguation and throwing `MarketAmbiguityError`
 * if multiple still match.
 *
 * Returns `null` if zero markets match. The caller decides whether that's an
 * error or just a "not found".
 */
export function resolveSingleMarket(
  response: unknown,
  slug: string,
  opts: FilterOptions = {},
): Market | null {
  const flat = extractMarketsPayload(response);
  const filtered = filterMarkets(flat, opts);
  if (filtered.length === 0) return null;
  if (filtered.length > 1) {
    throw new MarketAmbiguityError(
      slug,
      filtered.map((m) => {
        const candidate: { conditionId?: string; marketId?: string; question?: string } = {};
        const cid = stringField(m, "conditionId", "condition_id");
        const mid = stringField(m, "id");
        const q = stringField(m, "question", "title");
        if (cid !== undefined) candidate.conditionId = cid;
        if (mid !== undefined) candidate.marketId = mid;
        if (q !== undefined) candidate.question = q;
        return candidate;
      }),
    );
  }
  return normalizeMarket(filtered[0]!);
}
