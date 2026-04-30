import { describe, expect, it } from "vitest";
import {
  LiveTradingNotEnabledError,
  MarketAmbiguityError,
  MissingOutcomeError,
  OrderPlacementError,
  PolymarketApiError,
  PolymarketWorkflowError,
} from "../src/errors.js";

describe("error taxonomy", () => {
  it("every subclass is instanceof PolymarketWorkflowError", () => {
    const errors = [
      new PolymarketApiError(404, { msg: "not found" }),
      new MarketAmbiguityError("foo", []),
      new MissingOutcomeError("Yes", ["No"]),
      new LiveTradingNotEnabledError(),
      new OrderPlacementError({ status: "killed" }),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(PolymarketWorkflowError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it("preserves the error name across subclasses", () => {
    expect(new PolymarketApiError(500, null).name).toBe("PolymarketApiError");
    expect(new MarketAmbiguityError("x", []).name).toBe("MarketAmbiguityError");
    expect(new MissingOutcomeError("Yes", []).name).toBe("MissingOutcomeError");
    expect(new LiveTradingNotEnabledError().name).toBe("LiveTradingNotEnabledError");
    expect(new OrderPlacementError({}).name).toBe("OrderPlacementError");
  });

  describe("PolymarketApiError", () => {
    it("exposes status, body, and url", () => {
      const e = new PolymarketApiError(429, { error: "rate" }, { url: "https://gamma" });
      expect(e.status).toBe(429);
      expect(e.body).toEqual({ error: "rate" });
      expect(e.url).toBe("https://gamma");
      expect(e.message).toContain("429");
      expect(e.message).toContain("https://gamma");
    });

    it("uses status 0 for network errors", () => {
      const e = new PolymarketApiError(0, "ECONNRESET");
      expect(e.status).toBe(0);
      expect(e.message.toLowerCase()).toContain("network");
    });

    it("propagates cause for stack trace chaining", () => {
      const original = new TypeError("fetch failed");
      const e = new PolymarketApiError(0, "x", { cause: original });
      expect(e.cause).toBe(original);
    });
  });

  describe("MarketAmbiguityError", () => {
    it("exposes candidates as a structured array", () => {
      const candidates = [
        { conditionId: "0xa", question: "Q1" },
        { conditionId: "0xb", question: "Q2" },
      ];
      const e = new MarketAmbiguityError("event-slug", candidates);
      expect(e.slug).toBe("event-slug");
      expect(e.candidates).toEqual(candidates);
      expect(e.message).toContain("event-slug");
      expect(e.message).toContain("2 candidates");
    });
  });

  describe("MissingOutcomeError", () => {
    it("lists available outcomes in the message", () => {
      const e = new MissingOutcomeError("Maybe", ["Yes", "No"]);
      expect(e.outcome).toBe("Maybe");
      expect(e.available).toEqual(["Yes", "No"]);
      expect(e.message).toContain("Maybe");
      expect(e.message).toContain("Yes");
      expect(e.message).toContain("No");
    });
  });

  describe("OrderPlacementError", () => {
    it("formats status, errorMsg, orderID into message", () => {
      const e = new OrderPlacementError({
        success: false,
        status: "killed",
        errorMsg: "no liquidity",
        orderID: "abc-123",
      });
      expect(e.response.status).toBe("killed");
      expect(e.message).toContain("killed");
      expect(e.message).toContain("no liquidity");
      expect(e.message).toContain("abc-123");
    });

    it("falls back to a generic message when no fields are present", () => {
      const e = new OrderPlacementError({});
      expect(e.message).toMatch(/order placement failed/i);
    });
  });
});

// =============================================================================
// Type-level tests for PlaceOrderArgs discriminated union.
// These do not run; they fail compilation if the union shape regresses.
// =============================================================================
import type { Market, PlaceOrderArgs } from "../src/types.js";

const fakeMarket = {} as Market;

// Accepted shapes:
const _live: PlaceOrderArgs = {
  market: fakeMarket,
  outcome: "Yes",
  side: "BUY",
  amount: 1,
  confirm: true,
};

const _dryRun: PlaceOrderArgs = {
  market: fakeMarket,
  outcome: "Yes",
  side: "BUY",
  amount: 1,
  dryRun: true,
};

// @ts-expect-error confirm: false is rejected (literal-true requirement).
const _noConfirmFalse: PlaceOrderArgs = {
  market: fakeMarket,
  outcome: "Yes",
  side: "BUY",
  amount: 1,
  confirm: false,
};

// @ts-expect-error missing confirm in live mode is rejected.
const _missingConfirm: PlaceOrderArgs = {
  market: fakeMarket,
  outcome: "Yes",
  side: "BUY",
  amount: 1,
};

// @ts-expect-error confirm: someBoolean (not literal true) is rejected.
const _runtimeBoolean: PlaceOrderArgs = {
  market: fakeMarket,
  outcome: "Yes",
  side: "BUY",
  amount: 1,
  confirm: Math.random() > 0 ? true : false,
};

// @ts-expect-error dryRun + confirm together is rejected.
const _bothModes: PlaceOrderArgs = {
  market: fakeMarket,
  outcome: "Yes",
  side: "BUY",
  amount: 1,
  dryRun: true,
  confirm: true,
};

// Reference all to avoid unused-variable noise (the @ts-expect-error consumes the line).
void [_live, _dryRun, _noConfirmFalse, _missingConfirm, _runtimeBoolean, _bothModes];
