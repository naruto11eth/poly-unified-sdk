import { describe, expect, it, vi } from "vitest";
import { type SignedOrder } from "@polymarket/clob-client-v2";
import { PolymarketClient } from "../src/client.js";
import { LiveTradingNotEnabledError, OrderPlacementError } from "../src/errors.js";
import type { ClobClientLike, FetchLike } from "../src/types.js";

const FUNDER: `0x${string}` = "0x000000000000000000000000000000000000beef";

const cleanMarket = {
  conditionId: "0xabc",
  slug: "test",
  question: "Q?",
  outcomes: ["Yes", "No"],
  clobTokenIds: ["111", "222"],
  orderPriceMinTickSize: 0.01,
  orderMinSize: 1,
  negRisk: false,
  closed: false,
};

function fakeFetch(responses: Record<string, unknown>): FetchLike {
  return async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [key, body] of Object.entries(responses)) {
      if (url.includes(key)) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(body),
          json: async () => body,
        };
      }
    }
    return { ok: false, status: 404, text: async () => "Not Found", json: async () => ({}) };
  };
}

function fakeClob(overrides: Partial<ClobClientLike> = {}): ClobClientLike {
  return {
    createApiKey: vi.fn(async () => ({ key: "k", secret: "s", passphrase: "p" })),
    deriveApiKey: vi.fn(async () => ({ key: "k", secret: "s", passphrase: "p" })),
    createOrDeriveApiKey: vi.fn(async () => ({ key: "k", secret: "s", passphrase: "p" })),
    getTickSize: vi.fn(async () => "0.01"),
    getNegRisk: vi.fn(async () => false),
    getOrderBook: vi.fn(async () => ({
      market: "0xabc",
      asset_id: "111",
      timestamp: "0",
      hash: "h",
      bids: [],
      asks: [],
      min_order_size: "1",
      tick_size: "0.01",
      neg_risk: false,
      last_trade_price: "0.5",
    })),
    calculateMarketPrice: vi.fn(async () => 0.5),
    createMarketOrder: vi.fn(async () => ({ signed: "payload" } as unknown as SignedOrder)),
    postOrder: vi.fn(async () => ({
      success: true,
      status: "matched",
      orderID: "ord-1",
      transactionsHashes: ["0xtx"],
      takingAmount: "10",
      errorMsg: "",
    })),
    ...overrides,
  };
}

describe("PolymarketClient.fromDependencies — construction", () => {
  it("constructs without any network or signing", async () => {
    const fetchSpy = vi.fn();
    const clob = fakeClob();
    const client = PolymarketClient.fromDependencies({
      clob,
      fetch: fetchSpy as unknown as FetchLike,
      funderAddress: FUNDER,
    });
    expect(client.markets).toBeDefined();
    expect(client.orders).toBeDefined();
    expect(client.positions).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(clob.createOrDeriveApiKey).not.toHaveBeenCalled();
  });
});

describe("PolymarketClient resources — happy paths", () => {
  it("client.markets.get resolves via fake Gamma", async () => {
    const client = PolymarketClient.fromDependencies({
      clob: fakeClob(),
      fetch: fakeFetch({ "/markets/slug/": cleanMarket }),
      funderAddress: FUNDER,
    });
    const m = await client.markets.get({ slug: "test" });
    expect(m?.conditionId).toBe("0xabc");
  });

  it("client.orders.quote resolves through ClobAdapter", async () => {
    const client = PolymarketClient.fromDependencies({
      clob: fakeClob(),
      fetch: fakeFetch({ "/markets/slug/": cleanMarket }),
      funderAddress: FUNDER,
    });
    const m = await client.markets.get({ slug: "test" });
    if (!m) throw new Error("market missing");
    const q = await client.orders.quote({ market: m, outcome: "Yes", side: "BUY", amount: 1 });
    expect(q.avgPrice).toBeCloseTo(0.5);
  });

  it("client.positions.list defaults to funder address", async () => {
    let calledUrl = "";
    const client = PolymarketClient.fromDependencies({
      clob: fakeClob(),
      fetch: async (input) => {
        calledUrl = typeof input === "string" ? input : input.toString();
        return { ok: true, status: 200, text: async () => "", json: async () => [] };
      },
      funderAddress: FUNDER,
    });
    await client.positions.list();
    expect(calledUrl).toContain(`user=${FUNDER}`);
  });
});

describe("PolymarketClient.runWorkflow", () => {
  it("live mode: runs all four steps in order, returns kind=live", async () => {
    const clob = fakeClob();
    const dataResponse = [
      {
        conditionId: "0xabc",
        outcome: "Yes",
        title: "Q?",
        size: 10,
        avg_price: 0.5,
        current_value: 5,
        cash_pnl: 0,
        percent_pnl: 0,
        end_date: null,
        redeemable: false,
        mergeable: false,
        negative_risk: false,
      },
    ];
    const client = PolymarketClient.fromDependencies({
      clob,
      fetch: fakeFetch({ "/markets/slug/": cleanMarket, "/positions": dataResponse }),
      funderAddress: FUNDER,
      enableLiveTrading: true,
    });

    const result = await client.runWorkflow({
      slug: "test",
      outcome: "Yes",
      side: "BUY",
      amount: 1,
      confirm: true,
    });

    expect(result.kind).toBe("live");
    if (result.kind === "live") {
      expect(result.market.conditionId).toBe("0xabc");
      expect(result.quote.avgPrice).toBeCloseTo(0.5);
      expect(result.receipt.status).toBe("matched");
      expect(result.positions).toHaveLength(1);
    }
    expect(clob.createMarketOrder).toHaveBeenCalled();
    expect(clob.postOrder).toHaveBeenCalled();
  });

  it("dryRun mode: signs but never calls postOrder, still returns positions", async () => {
    const clob = fakeClob();
    const client = PolymarketClient.fromDependencies({
      clob,
      fetch: fakeFetch({ "/markets/slug/": cleanMarket, "/positions": [] }),
      funderAddress: FUNDER,
      enableLiveTrading: false, // dryRun bypasses this gate
    });

    const result = await client.runWorkflow({
      slug: "test",
      outcome: "Yes",
      side: "BUY",
      amount: 1,
      dryRun: true,
    });

    expect(result.kind).toBe("dryRun");
    expect(clob.createMarketOrder).toHaveBeenCalledTimes(1);
    expect(clob.postOrder).not.toHaveBeenCalled();
  });

  it("kill short-circuit: positions.list NOT called when placement throws", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/markets/slug/")) {
        return {
          ok: true,
          status: 200,
          text: async () => "",
          json: async () => cleanMarket,
        };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => [] };
    });
    const clob = fakeClob({
      postOrder: vi.fn(async () => ({ success: false, status: "killed", errorMsg: "no liquidity" })),
    });
    const client = PolymarketClient.fromDependencies({
      clob,
      fetch: fetchSpy as unknown as FetchLike,
      funderAddress: FUNDER,
      enableLiveTrading: true,
    });

    await expect(
      client.runWorkflow({ slug: "test", outcome: "Yes", side: "BUY", amount: 1, confirm: true }),
    ).rejects.toBeInstanceOf(OrderPlacementError);

    // Verify /positions was never fetched.
    const positionsCalls = fetchSpy.mock.calls.filter((c) => {
      const url = typeof c[0] === "string" ? c[0] : (c[0] as URL).toString();
      return url.includes("/positions");
    });
    expect(positionsCalls).toHaveLength(0);
  });

  it("throws LiveTradingNotEnabledError in live mode without enableLiveTrading", async () => {
    const clob = fakeClob();
    const client = PolymarketClient.fromDependencies({
      clob,
      fetch: fakeFetch({ "/markets/slug/": cleanMarket }),
      funderAddress: FUNDER,
      enableLiveTrading: false,
    });
    await expect(
      client.runWorkflow({ slug: "test", outcome: "Yes", side: "BUY", amount: 1, confirm: true }),
    ).rejects.toBeInstanceOf(LiveTradingNotEnabledError);
    expect(clob.createMarketOrder).not.toHaveBeenCalled();
    expect(clob.postOrder).not.toHaveBeenCalled();
  });

  it("calls calculateMarketPrice exactly once across the workflow (no double-quoting)", async () => {
    // #given a clob whose calculateMarketPrice would return DIFFERENT prices
    //        across calls (simulating orderbook movement between quote and place)
    const calculateMarketPrice = vi
      .fn()
      .mockResolvedValueOnce(0.5) // first call: 0.50
      .mockResolvedValueOnce(0.6); // second call (the bug): 0.60 — would silently change worstPrice
    const clob = fakeClob({ calculateMarketPrice });
    const client = PolymarketClient.fromDependencies({
      clob,
      fetch: fakeFetch({ "/markets/slug/": cleanMarket, "/positions": [] }),
      funderAddress: FUNDER,
      enableLiveTrading: true,
    });

    // #when runWorkflow runs the full live journey
    const result = await client.runWorkflow({
      slug: "test",
      outcome: "Yes",
      side: "BUY",
      amount: 1,
      confirm: true,
    });

    // #then calculateMarketPrice is called exactly once (not twice)
    expect(calculateMarketPrice).toHaveBeenCalledTimes(1);
    // #and the displayed avgPrice on the result matches the price actually used
    //      to build the worstPrice on the signed order
    expect(result.kind).toBe("live");
    if (result.kind === "live") {
      expect(result.quote.avgPrice).toBeCloseTo(0.5);
      // worstPrice = ceil(0.5 * 1.01 / 0.01) * 0.01 = 0.51, not the 0.61 the
      // bug would have produced from the second quote.
      expect(result.quote.worstPrice).toBeCloseTo(0.51);
    }
  });

  it("orders.place accepts a pre-computed quote and skips re-quoting", async () => {
    // #given a calculateMarketPrice spy
    const calculateMarketPrice = vi.fn().mockResolvedValue(0.5);
    const clob = fakeClob({ calculateMarketPrice });
    const client = PolymarketClient.fromDependencies({
      clob,
      fetch: fakeFetch({ "/markets/slug/": cleanMarket }),
      funderAddress: FUNDER,
      enableLiveTrading: true,
    });
    const market = await client.markets.get({ slug: "test" });
    if (!market) throw new Error("market missing");
    const quote = await client.orders.quote({ market, outcome: "Yes", side: "BUY", amount: 1 });
    expect(calculateMarketPrice).toHaveBeenCalledTimes(1);

    // #when place is called with the existing quote
    await client.orders.place(
      { market, outcome: "Yes", side: "BUY", amount: 1, confirm: true },
      { quote },
    );

    // #then no additional calculateMarketPrice call was made
    expect(calculateMarketPrice).toHaveBeenCalledTimes(1);
  });

  it("orders.place still computes a quote when none is provided", async () => {
    // #given a calculateMarketPrice spy
    const calculateMarketPrice = vi.fn().mockResolvedValue(0.5);
    const clob = fakeClob({ calculateMarketPrice });
    const client = PolymarketClient.fromDependencies({
      clob,
      fetch: fakeFetch({ "/markets/slug/": cleanMarket }),
      funderAddress: FUNDER,
      enableLiveTrading: true,
    });
    const market = await client.markets.get({ slug: "test" });
    if (!market) throw new Error("market missing");

    // #when place is called WITHOUT a pre-computed quote
    await client.orders.place({
      market,
      outcome: "Yes",
      side: "BUY",
      amount: 1,
      confirm: true,
    });

    // #then place computes a fresh quote internally
    expect(calculateMarketPrice).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// Type-level checks — the discriminated union for orders.place.
// =============================================================================
import type { Market, PlaceOrderArgs } from "../src/types.js";
const dummyMarket = {} as Market;

const _validLive: PlaceOrderArgs = {
  market: dummyMarket,
  outcome: "Yes",
  side: "BUY",
  amount: 1,
  confirm: true,
};
const _validDry: PlaceOrderArgs = {
  market: dummyMarket,
  outcome: "Yes",
  side: "BUY",
  amount: 1,
  dryRun: true,
};
// @ts-expect-error confirm: false rejected.
const _bad1: PlaceOrderArgs = { market: dummyMarket, outcome: "Yes", side: "BUY", amount: 1, confirm: false };
// @ts-expect-error missing confirm in live mode rejected.
const _bad2: PlaceOrderArgs = { market: dummyMarket, outcome: "Yes", side: "BUY", amount: 1 };

void [_validLive, _validDry, _bad1, _bad2];
