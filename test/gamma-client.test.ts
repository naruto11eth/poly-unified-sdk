import { describe, expect, it, vi } from "vitest";
import { MarketAmbiguityError, PolymarketApiError } from "../src/errors.js";
import { GammaClient } from "../src/clients/gamma.js";
import type { FetchLike } from "../src/types.js";

function fakeFetch(handler: (url: string) => unknown | Promise<unknown>): FetchLike {
  return async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const result = await handler(url);
    if (result === undefined) {
      return {
        ok: false,
        status: 404,
        text: async () => "Not Found",
        json: async () => ({ error: "not found" }),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(result),
      json: async () => result,
    };
  };
}

const cleanMarket = {
  conditionId: "0xabc",
  slug: "test-slug",
  question: "Will X?",
  outcomes: ["Yes", "No"],
  clobTokenIds: ["111", "222"],
  orderPriceMinTickSize: 0.01,
  orderMinSize: 5,
  negRisk: false,
  closed: false,
};

describe("GammaClient.getBySlug", () => {
  it("resolves a clean single-market response", async () => {
    const client = new GammaClient({
      fetch: fakeFetch((url) => (url.includes("/markets/slug/") ? cleanMarket : undefined)),
    });
    const m = await client.getBySlug("test-slug");
    expect(m?.conditionId).toBe("0xabc");
    expect(m?.outcomes).toHaveLength(2);
  });

  it("falls back to /events/slug when /markets/slug returns 404", async () => {
    const event = {
      slug: "election",
      markets: [{ ...cleanMarket, conditionId: "0xa" }],
    };
    const client = new GammaClient({
      fetch: fakeFetch((url) => {
        if (url.includes("/markets/slug/")) return undefined; // 404
        if (url.includes("/events/slug/")) return event;
        return undefined;
      }),
    });
    const m = await client.getBySlug("election");
    expect(m?.conditionId).toBe("0xa");
  });

  it("throws MarketAmbiguityError when event resolves to multiple markets", async () => {
    const event = {
      slug: "multi",
      markets: [
        { ...cleanMarket, conditionId: "0xa", question: "A" },
        { ...cleanMarket, conditionId: "0xb", question: "B" },
      ],
    };
    const client = new GammaClient({
      fetch: fakeFetch((url) => (url.includes("/events/slug/") ? event : undefined)),
    });
    await expect(client.getBySlug("multi")).rejects.toBeInstanceOf(MarketAmbiguityError);
  });

  it("disambiguates with conditionId filter on event response", async () => {
    const event = {
      slug: "multi",
      markets: [
        { ...cleanMarket, conditionId: "0xa" },
        { ...cleanMarket, conditionId: "0xb" },
      ],
    };
    const client = new GammaClient({
      fetch: fakeFetch((url) => (url.includes("/events/slug/") ? event : undefined)),
    });
    const m = await client.getBySlug("multi", { conditionId: "0xb" });
    expect(m?.conditionId).toBe("0xb");
  });

  it("returns null when both endpoints 404", async () => {
    const client = new GammaClient({ fetch: fakeFetch(() => undefined) });
    const m = await client.getBySlug("nonexistent");
    expect(m).toBeNull();
  });

  it("propagates non-404 errors", async () => {
    const fetch500: FetchLike = async () => ({
      ok: false,
      status: 500,
      text: async () => "boom",
      json: async () => ({}),
    });
    const client = new GammaClient({ fetch: fetch500 });
    await expect(client.getBySlug("x")).rejects.toBeInstanceOf(PolymarketApiError);
  });

  it("calls /markets/slug only when it succeeds (no fallback hit)", async () => {
    const spy = vi.fn(async (url: string | URL) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("/markets/slug/")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(cleanMarket),
          json: async () => cleanMarket,
        };
      }
      throw new Error("should not be reached");
    });
    const client = new GammaClient({ fetch: spy as FetchLike });
    await client.getBySlug("test-slug");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("GammaClient.getByConditionId", () => {
  it("issues a /markets?condition_ids= query", async () => {
    let called: string | null = null;
    const fetch: FetchLike = async (url) => {
      called = typeof url === "string" ? url : url.toString();
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([cleanMarket]),
        json: async () => [cleanMarket],
      };
    };
    const client = new GammaClient({ fetch });
    const m = await client.getByConditionId("0xabc");
    expect(called).toContain("/markets");
    expect(called).toContain("condition_ids=0xabc");
    expect(m?.conditionId).toBe("0xabc");
  });
});

describe("GammaClient.list", () => {
  it("returns normalized markets from /markets", async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => [cleanMarket, { ...cleanMarket, conditionId: "0xdef" }],
    });
    const client = new GammaClient({ fetch });
    const list = await client.list({ active: true });
    expect(list).toHaveLength(2);
    expect(list[0]?.conditionId).toBe("0xabc");
  });

  it("propagates query params", async () => {
    let url: string | null = null;
    const fetch: FetchLike = async (input) => {
      url = typeof input === "string" ? input : input.toString();
      return {
        ok: true,
        status: 200,
        text: async () => "",
        json: async () => [],
      };
    };
    const client = new GammaClient({ fetch });
    await client.list({ active: true, limit: 10 });
    expect(url).toContain("active=true");
    expect(url).toContain("limit=10");
  });
});
