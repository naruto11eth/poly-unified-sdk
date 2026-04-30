import { describe, expect, it, vi } from "vitest";
import { OrderType, Side, type SignedOrder } from "@polymarket/clob-client-v2";
import { ClobAdapter, validateFokOrderResponse } from "../src/clients/clob-adapter.js";
import { MissingOutcomeError, OrderPlacementError } from "../src/errors.js";
import type { ClobClientLike, Market, PlaceOrderArgs, Quote } from "../src/types.js";

function fakeMarket(): Market {
  return {
    conditionId: "0xabc",
    slug: "test",
    question: "Q?",
    outcomes: [
      { name: "Yes", tokenId: "111" },
      { name: "No", tokenId: "222" },
    ],
    tickSize: 0.01,
    negRisk: false,
    minOrderSize: 1,
    closed: false,
    raw: {},
  };
}

function fakeClob(overrides: Partial<ClobClientLike> = {}): ClobClientLike {
  const base: ClobClientLike = {
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
  };
  return { ...base, ...overrides };
}

describe("ClobAdapter.quoteFok", () => {
  it("BUY 5 USDC at avgPrice 0.5 produces worstPrice 0.51 with default 100 bps", async () => {
    const adapter = new ClobAdapter({ clob: fakeClob() });
    const market = fakeMarket();
    const quote = await adapter.quoteFok({ market, outcome: "Yes", side: "BUY", amount: 5 });

    expect(quote.avgPrice).toBeCloseTo(0.5);
    expect(quote.worstPrice).toBeCloseTo(0.51);
    expect(quote.expectedShares).toBeCloseTo(10);
    expect(quote.expectedCost).toBeCloseTo(5);
    expect(quote.slippageBps).toBe(100);
    expect(quote.outcome.tokenId).toBe("111");
  });

  it("SELL 10 shares at avgPrice 0.5 produces worstPrice 0.49", async () => {
    const adapter = new ClobAdapter({ clob: fakeClob() });
    const quote = await adapter.quoteFok({
      market: fakeMarket(),
      outcome: "Yes",
      side: "SELL",
      amount: 10,
    });
    expect(quote.worstPrice).toBeCloseTo(0.49);
    expect(quote.expectedShares).toBe(10);
    expect(quote.expectedCost).toBeCloseTo(5);
  });

  it("resolves outcome name case-insensitively", async () => {
    const adapter = new ClobAdapter({ clob: fakeClob() });
    const quote = await adapter.quoteFok({
      market: fakeMarket(),
      outcome: "yes",
      side: "BUY",
      amount: 1,
    });
    expect(quote.outcome.name).toBe("Yes");
  });

  it("throws MissingOutcomeError for an unknown outcome", async () => {
    const adapter = new ClobAdapter({ clob: fakeClob() });
    await expect(
      adapter.quoteFok({
        market: fakeMarket(),
        outcome: "Maybe",
        side: "BUY",
        amount: 1,
      }),
    ).rejects.toBeInstanceOf(MissingOutcomeError);
  });

  it("calls calculateMarketPrice with FOK order type", async () => {
    const clob = fakeClob();
    const adapter = new ClobAdapter({ clob });
    await adapter.quoteFok({
      market: fakeMarket(),
      outcome: "Yes",
      side: "BUY",
      amount: 1,
    });
    expect(clob.calculateMarketPrice).toHaveBeenCalledWith("111", Side.BUY, 1, OrderType.FOK);
  });

  it("respects custom slippageBps", async () => {
    const adapter = new ClobAdapter({ clob: fakeClob() });
    const quote = await adapter.quoteFok({
      market: fakeMarket(),
      outcome: "Yes",
      side: "BUY",
      amount: 1,
      slippageBps: 500,
    });
    // 0.5 * 1.05 = 0.525 → ceil to 0.53
    expect(quote.worstPrice).toBeCloseTo(0.53);
    expect(quote.slippageBps).toBe(500);
  });
});

describe("ClobAdapter.placeFok — live mode", () => {
  function liveQuote(): Quote {
    const market = fakeMarket();
    return {
      market,
      outcome: market.outcomes[0]!,
      side: "BUY",
      amount: 5,
      avgPrice: 0.5,
      worstPrice: 0.51,
      expectedShares: 10,
      expectedCost: 5,
      slippageBps: 100,
      tickSize: 0.01,
      feeUsd: 0.025,
    };
  }

  it("happy path returns OrderReceipt", async () => {
    const clob = fakeClob();
    const adapter = new ClobAdapter({ clob });
    const args: PlaceOrderArgs = {
      market: fakeMarket(),
      outcome: "Yes",
      side: "BUY",
      amount: 5,
      confirm: true,
    };
    const result = await adapter.placeFok(liveQuote(), args);
    expect("status" in result).toBe(true);
    if ("status" in result) {
      expect(result.status).toBe("matched");
      expect(result.orderId).toBe("ord-1");
      expect(result.transactionHashes).toEqual(["0xtx"]);
    }
    expect(clob.createMarketOrder).toHaveBeenCalled();
    expect(clob.postOrder).toHaveBeenCalled();
  });

  it("throws OrderPlacementError on success: false", async () => {
    const clob = fakeClob({
      postOrder: vi.fn(async () => ({ success: false, errorMsg: "no liquidity", status: "killed" })),
    });
    const adapter = new ClobAdapter({ clob });
    await expect(
      adapter.placeFok(liveQuote(), {
        market: fakeMarket(),
        outcome: "Yes",
        side: "BUY",
        amount: 5,
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(OrderPlacementError);
  });

  it("throws OrderPlacementError on terminal failure status", async () => {
    const clob = fakeClob({
      postOrder: vi.fn(async () => ({ success: true, status: "killed", errorMsg: "" })),
    });
    const adapter = new ClobAdapter({ clob });
    await expect(
      adapter.placeFok(liveQuote(), {
        market: fakeMarket(),
        outcome: "Yes",
        side: "BUY",
        amount: 5,
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(OrderPlacementError);
  });

  it("throws OrderPlacementError on non-empty errorMsg", async () => {
    const clob = fakeClob({
      postOrder: vi.fn(async () => ({ success: true, status: "matched", errorMsg: "warning" })),
    });
    const adapter = new ClobAdapter({ clob });
    await expect(
      adapter.placeFok(liveQuote(), {
        market: fakeMarket(),
        outcome: "Yes",
        side: "BUY",
        amount: 5,
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(OrderPlacementError);
  });
});

describe("ClobAdapter.placeFok — dryRun mode", () => {
  it("signs but never calls postOrder", async () => {
    const clob = fakeClob();
    const adapter = new ClobAdapter({ clob });
    const result = await adapter.placeFok(
      {
        market: fakeMarket(),
        outcome: { name: "Yes", tokenId: "111" },
        side: "BUY",
        amount: 5,
        avgPrice: 0.5,
        worstPrice: 0.51,
        expectedShares: 10,
        expectedCost: 5,
        slippageBps: 100,
        tickSize: 0.01,
        feeUsd: undefined,
      },
      {
        market: fakeMarket(),
        outcome: "Yes",
        side: "BUY",
        amount: 5,
        dryRun: true,
      },
    );
    expect("kind" in result && result.kind).toBe("dryRun");
    expect(clob.createMarketOrder).toHaveBeenCalledTimes(1);
    expect(clob.postOrder).not.toHaveBeenCalled();
  });

  it("dryRun result carries signedOrder, userMarketOrder, and options", async () => {
    const adapter = new ClobAdapter({ clob: fakeClob() });
    const result = await adapter.placeFok(
      {
        market: fakeMarket(),
        outcome: { name: "Yes", tokenId: "111" },
        side: "BUY",
        amount: 5,
        avgPrice: 0.5,
        worstPrice: 0.51,
        expectedShares: 10,
        expectedCost: 5,
        slippageBps: 100,
        tickSize: 0.01,
        feeUsd: undefined,
      },
      { market: fakeMarket(), outcome: "Yes", side: "BUY", amount: 5, dryRun: true },
    );
    if ("kind" in result) {
      expect(result.signedOrder).toBeDefined();
      expect(result.userMarketOrder.tokenID).toBe("111");
      expect(result.userMarketOrder.orderType).toBe(OrderType.FOK);
      expect(result.options.tickSize).toBe("0.01");
      expect(result.options.negRisk).toBe(false);
    }
  });
});

describe("validateFokOrderResponse", () => {
  it.each([
    ["success: false", { success: false, status: "matched" }],
    ["non-empty errorMsg", { success: true, status: "matched", errorMsg: "boom" }],
    ["status: killed", { success: true, status: "killed", errorMsg: "" }],
    ["status: failed", { success: true, status: "failed", errorMsg: "" }],
    ["status: rejected", { success: true, status: "rejected", errorMsg: "" }],
    ["status: canceled", { success: true, status: "canceled", errorMsg: "" }],
    ["status: cancelled (UK spelling)", { success: true, status: "cancelled", errorMsg: "" }],
    ["unknown status", { success: true, status: "weird", errorMsg: "" }],
  ])("rejects %s", (_, response) => {
    expect(() => validateFokOrderResponse(response)).toThrow(OrderPlacementError);
  });

  it.each([
    ["matched", { success: true, status: "matched", errorMsg: "" }],
    ["delayed", { success: true, status: "delayed", errorMsg: "" }],
    ["live", { success: true, status: "live", errorMsg: "" }],
  ])("accepts %s", (_, response) => {
    expect(() => validateFokOrderResponse(response)).not.toThrow();
  });
});
