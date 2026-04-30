import { describe, expect, it } from "vitest";
import { PolymarketApiError } from "../src/errors.js";
import { buildQuery, fetchJson } from "../src/http.js";
import type { FetchLike } from "../src/types.js";

function makeResponse(opts: {
  ok: boolean;
  status: number;
  body?: string;
  json?: unknown;
  jsonThrows?: boolean;
}): Awaited<ReturnType<FetchLike>> {
  return {
    ok: opts.ok,
    status: opts.status,
    text: async () => opts.body ?? "",
    json: async () => {
      if (opts.jsonThrows) throw new SyntaxError("bad json");
      return opts.json ?? JSON.parse(opts.body ?? "null");
    },
  };
}

describe("fetchJson", () => {
  it("parses 200 JSON happy path", async () => {
    const fakeFetch: FetchLike = async () =>
      makeResponse({ ok: true, status: 200, json: { hello: "world" } });
    const result = await fetchJson(fakeFetch, "https://example.com/api");
    expect(result).toEqual({ hello: "world" });
  });

  it("throws PolymarketApiError on 404 with parsed JSON body", async () => {
    const fakeFetch: FetchLike = async () =>
      makeResponse({ ok: false, status: 404, body: '{"error":"not found"}' });
    await expect(fetchJson(fakeFetch, "https://gamma/foo")).rejects.toMatchObject({
      status: 404,
      body: { error: "not found" },
      url: "https://gamma/foo",
    });
  });

  it("throws PolymarketApiError on 500 with non-JSON body", async () => {
    const fakeFetch: FetchLike = async () =>
      makeResponse({ ok: false, status: 500, body: "Internal Server Error" });
    const promise = fetchJson(fakeFetch, "https://gamma/foo");
    await expect(promise).rejects.toBeInstanceOf(PolymarketApiError);
    await expect(promise).rejects.toMatchObject({ status: 500, body: "Internal Server Error" });
  });

  it("wraps network errors as PolymarketApiError(0, ...)", async () => {
    const fakeFetch: FetchLike = async () => {
      throw new TypeError("ECONNRESET");
    };
    await expect(fetchJson(fakeFetch, "https://x")).rejects.toMatchObject({
      status: 0,
      body: "ECONNRESET",
      url: "https://x",
    });
  });

  it("preserves original error as cause on network failure", async () => {
    const original = new TypeError("dns");
    const fakeFetch: FetchLike = async () => {
      throw original;
    };
    await expect(fetchJson(fakeFetch, "https://x")).rejects.toMatchObject({ cause: original });
  });

  it("throws PolymarketApiError when JSON parsing fails on a 200 response", async () => {
    const fakeFetch: FetchLike = async () =>
      makeResponse({ ok: true, status: 200, body: "not json", jsonThrows: true });
    await expect(fetchJson(fakeFetch, "https://x")).rejects.toBeInstanceOf(PolymarketApiError);
  });
});

describe("buildQuery", () => {
  it("returns empty string for empty params", () => {
    expect(buildQuery({})).toBe("");
  });

  it("skips null and undefined values", () => {
    expect(buildQuery({ a: undefined, b: null, c: "x" })).toBe("?c=x");
  });

  it("encodes special characters", () => {
    expect(buildQuery({ q: "hello world" })).toBe("?q=hello%20world");
  });

  it("repeats keys for array values", () => {
    expect(buildQuery({ tag: ["a", "b"] })).toBe("?tag=a&tag=b");
  });

  it("stringifies numbers and booleans", () => {
    expect(buildQuery({ limit: 50, active: true })).toBe("?limit=50&active=true");
  });
});
