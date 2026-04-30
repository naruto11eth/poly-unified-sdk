import { PolymarketApiError } from "./errors.js";
import type { FetchLike } from "./types.js";

/**
 * Minimal JSON fetch wrapper. Throws `PolymarketApiError` on non-2xx and on
 * network failure. Used by `GammaClient` and `DataApiClient` — the CLOB
 * adapter goes through `@polymarket/clob-client-v2` directly.
 */
export async function fetchJson<T = unknown>(
  fetchImpl: FetchLike,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<T> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, init);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new PolymarketApiError(0, message, { url, cause });
  }

  if (!response.ok) {
    const body = await readBody(response);
    throw new PolymarketApiError(response.status, body, { url });
  }

  try {
    return (await response.json()) as T;
  } catch (cause) {
    const text = await safeText(response);
    throw new PolymarketApiError(response.status, text ?? "(unparseable JSON)", {
      url,
      cause,
    });
  }
}

async function readBody(response: Awaited<ReturnType<FetchLike>>): Promise<unknown> {
  const text = await safeText(response);
  if (text == null || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function safeText(response: Awaited<ReturnType<FetchLike>>): Promise<string | null> {
  try {
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Tiny querystring helper. Skips undefined/null values and array-encodes by
 * repeating the key (Polymarket's APIs accept both repeated keys and CSVs;
 * we use repeated keys for clarity).
 */
export function buildQuery(params: Record<string, string | number | boolean | undefined | null | ReadonlyArray<string | number>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length === 0 ? "" : "?" + parts.join("&");
}
