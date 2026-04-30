import { fetchJson, buildQuery } from "../http.js";
import type { FetchLike, Position } from "../types.js";

const DEFAULT_DATA_BASE_URL = "https://data-api.polymarket.com";

export interface DataApiClientOptions {
  readonly fetch?: FetchLike;
  readonly baseUrl?: string;
}

export interface ListPositionsArgs {
  readonly user: `0x${string}`;
  /** Optional: comma-separated condition IDs OR a single conditionId we'll pass through. */
  readonly market?: string;
  readonly eventId?: string;
  readonly sizeThreshold?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly redeemable?: boolean;
  readonly mergeable?: boolean;
}

/**
 * Read-only client for Polymarket's Data API. Currently scoped to positions —
 * the only endpoint the journey needs.
 */
export class DataApiClient {
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: DataApiClientOptions = {}) {
    this.fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
    this.baseUrl = options.baseUrl ?? DEFAULT_DATA_BASE_URL;
  }

  async list(args: ListPositionsArgs): Promise<Position[]> {
    const url = `${this.baseUrl}/positions${buildQuery({
      user: args.user,
      ...(args.market !== undefined ? { market: args.market } : {}),
      ...(args.eventId !== undefined ? { eventId: args.eventId } : {}),
      ...(args.sizeThreshold !== undefined ? { sizeThreshold: args.sizeThreshold } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.offset !== undefined ? { offset: args.offset } : {}),
      ...(args.redeemable !== undefined ? { redeemable: args.redeemable } : {}),
      ...(args.mergeable !== undefined ? { mergeable: args.mergeable } : {}),
    })}`;
    const raw = await fetchJson<unknown>(this.fetchImpl, url);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is Record<string, unknown> => p !== null && typeof p === "object")
      .map((p) => normalizePosition(p));
  }
}

function normalizePosition(raw: Record<string, unknown>): Position {
  return {
    conditionId: stringValue(raw, "conditionId", "condition_id") ?? "",
    outcome: stringValue(raw, "outcome") ?? "",
    title: stringValue(raw, "title") ?? "",
    size: numberValue(raw, "size") ?? 0,
    avgPrice: numberValue(raw, "avgPrice", "avg_price") ?? 0,
    currentValue: numberValue(raw, "currentValue", "current_value") ?? 0,
    cashPnl: numberValue(raw, "cashPnl", "cash_pnl") ?? 0,
    percentPnl: numberValue(raw, "percentPnl", "percent_pnl") ?? 0,
    endDate: stringValue(raw, "endDate", "end_date"),
    redeemable: booleanValue(raw, "redeemable") ?? false,
    mergeable: booleanValue(raw, "mergeable") ?? false,
    negativeRisk: booleanValue(raw, "negativeRisk", "negative_risk") ?? false,
    raw,
  };
}

function stringValue(obj: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function numberValue(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.length > 0) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function booleanValue(obj: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "boolean") return v;
  }
  return undefined;
}
