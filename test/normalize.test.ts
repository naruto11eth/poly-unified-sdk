import { describe, expect, it } from "vitest";
import { MarketAmbiguityError } from "../src/errors.js";
import {
  arrayField,
  booleanField,
  extractMarketsPayload,
  filterMarkets,
  normalizeMarket,
  numberField,
  parseMaybeJsonArray,
  resolveSingleMarket,
  stringField,
  tickSizeField,
} from "../src/normalize.js";

describe("field helpers", () => {
  describe("stringField", () => {
    it("returns first non-empty string from candidate keys", () => {
      expect(stringField({ a: "", b: "hi", c: "x" }, "a", "b", "c")).toBe("hi");
    });
    it("returns undefined when all keys missing or empty", () => {
      expect(stringField({}, "a")).toBeUndefined();
      expect(stringField({ a: "" }, "a")).toBeUndefined();
      expect(stringField({ a: 5 }, "a")).toBeUndefined();
    });
  });

  describe("booleanField", () => {
    it("returns first boolean value", () => {
      expect(booleanField({ a: true }, "a")).toBe(true);
      expect(booleanField({ a: false }, "a")).toBe(false);
    });
    it("ignores non-boolean values", () => {
      expect(booleanField({ a: "true" }, "a")).toBeUndefined();
    });
  });

  describe("numberField", () => {
    it("returns numeric values", () => {
      expect(numberField({ x: 5 }, "x")).toBe(5);
    });
    it("coerces numeric strings", () => {
      expect(numberField({ x: "5.5" }, "x")).toBe(5.5);
    });
    it("rejects non-finite", () => {
      expect(numberField({ x: NaN }, "x")).toBeUndefined();
      expect(numberField({ x: "abc" }, "x")).toBeUndefined();
    });
  });

  describe("tickSizeField", () => {
    it("reads orderPriceMinTickSize (Gamma camelCase)", () => {
      expect(tickSizeField({ orderPriceMinTickSize: 0.01 })).toBe(0.01);
    });
    it("reads min_tick_size (CLOB snake_case)", () => {
      expect(tickSizeField({ min_tick_size: 0.001 })).toBe(0.001);
    });
    it("coerces string tickSize", () => {
      expect(tickSizeField({ tickSize: "0.0001" })).toBe(0.0001);
    });
  });

  describe("parseMaybeJsonArray", () => {
    it("returns array as-is", () => {
      expect(parseMaybeJsonArray(["a", "b"])).toEqual(["a", "b"]);
    });
    it("parses JSON-stringified array", () => {
      expect(parseMaybeJsonArray('["Yes","No"]')).toEqual(["Yes", "No"]);
    });
    it("returns undefined on malformed JSON", () => {
      expect(parseMaybeJsonArray("[invalid")).toBeUndefined();
    });
    it("returns undefined for non-array values", () => {
      expect(parseMaybeJsonArray("hello")).toBeUndefined();
      expect(parseMaybeJsonArray(123)).toBeUndefined();
    });
  });

  describe("arrayField", () => {
    it("reads array fields with multiple key candidates", () => {
      expect(arrayField({ outcomes: ["Yes", "No"] }, "outcomes")).toEqual(["Yes", "No"]);
    });
    it("handles JSON-stringified arrays", () => {
      expect(arrayField({ clobTokenIds: '["111","222"]' }, "clobTokenIds")).toEqual(["111", "222"]);
    });
  });
});

// =============================================================================
// extractMarketsPayload — the 3-shape flattener
// =============================================================================

describe("extractMarketsPayload", () => {
  it("handles single market shape", () => {
    const res = { conditionId: "0xa", question: "Q?" };
    expect(extractMarketsPayload(res)).toEqual([res]);
  });

  it("handles market list shape", () => {
    const res = [
      { conditionId: "0xa" },
      { conditionId: "0xb" },
    ];
    expect(extractMarketsPayload(res)).toHaveLength(2);
  });

  it("handles event shape with nested markets", () => {
    const event = {
      slug: "election-2024",
      title: "Who wins?",
      markets: [
        { conditionId: "0xa", question: "Candidate A" },
        { conditionId: "0xb", question: "Candidate B" },
      ],
    };
    const flat = extractMarketsPayload(event);
    expect(flat).toHaveLength(2);
    expect(flat[0]).toMatchObject({ conditionId: "0xa", eventSlug: "election-2024" });
    expect(flat[1]).toMatchObject({ conditionId: "0xb", eventSlug: "election-2024" });
  });

  it("handles array of events", () => {
    const events = [
      { markets: [{ conditionId: "0xa" }, { conditionId: "0xb" }] },
      { markets: [{ conditionId: "0xc" }] },
    ];
    expect(extractMarketsPayload(events)).toHaveLength(3);
  });

  it("returns empty array on truly empty/malformed input", () => {
    expect(extractMarketsPayload(null)).toEqual([]);
    expect(extractMarketsPayload(undefined)).toEqual([]);
    expect(extractMarketsPayload({})).toEqual([]);
    expect(extractMarketsPayload([])).toEqual([]);
  });
});

// =============================================================================
// filterMarkets
// =============================================================================

describe("filterMarkets", () => {
  const markets = [
    { conditionId: "0xa", id: "1" },
    { conditionId: "0xb", id: "2" },
    { conditionId: "0xc", id: "3" },
  ];

  it("filters by conditionId (case-insensitive)", () => {
    expect(filterMarkets(markets, { conditionId: "0xA" })).toHaveLength(1);
    expect(filterMarkets(markets, { conditionId: "0xa" })[0]).toEqual(markets[0]);
  });

  it("filters by marketId", () => {
    expect(filterMarkets(markets, { marketId: "2" })[0]).toEqual(markets[1]);
  });

  it("returns full set when no filter", () => {
    expect(filterMarkets(markets, {})).toHaveLength(3);
  });

  it("returns empty when nothing matches", () => {
    expect(filterMarkets(markets, { conditionId: "0xz" })).toHaveLength(0);
  });
});

// =============================================================================
// normalizeMarket
// =============================================================================

describe("normalizeMarket", () => {
  it("normalizes a clean market with array outcomes", () => {
    const raw = {
      conditionId: "0xa",
      slug: "test-market",
      question: "Will it rain?",
      outcomes: ["Yes", "No"],
      clobTokenIds: ["111", "222"],
      orderPriceMinTickSize: 0.01,
      negRisk: false,
      orderMinSize: 5,
      closed: false,
      id: "1234",
    };
    const m = normalizeMarket(raw);
    expect(m.conditionId).toBe("0xa");
    expect(m.slug).toBe("test-market");
    expect(m.outcomes).toEqual([
      { name: "Yes", tokenId: "111" },
      { name: "No", tokenId: "222" },
    ]);
    expect(m.tickSize).toBe(0.01);
    expect(m.negRisk).toBe(false);
    expect(m.minOrderSize).toBe(5);
    expect(m.marketId).toBe("1234");
    expect(m.raw).toBe(raw);
  });

  it("parses JSON-stringified outcomes and clobTokenIds", () => {
    const raw = {
      conditionId: "0xa",
      outcomes: '["Yes","No"]',
      clobTokenIds: '["111","222"]',
    };
    const m = normalizeMarket(raw);
    expect(m.outcomes).toEqual([
      { name: "Yes", tokenId: "111" },
      { name: "No", tokenId: "222" },
    ]);
  });

  it("reads snake_case condition_id and neg_risk", () => {
    const raw = {
      condition_id: "0xa",
      outcomes: ["Yes"],
      clob_token_ids: ["111"],
      neg_risk: true,
    };
    const m = normalizeMarket(raw);
    expect(m.conditionId).toBe("0xa");
    expect(m.negRisk).toBe(true);
  });

  it("defaults tickSize, negRisk, minOrderSize, closed when missing", () => {
    const m = normalizeMarket({ conditionId: "0xa" });
    expect(m.tickSize).toBe(0.01);
    expect(m.negRisk).toBe(false);
    expect(m.minOrderSize).toBe(0);
    expect(m.closed).toBe(false);
    expect(m.outcomes).toEqual([]);
  });

  it("throws if conditionId missing", () => {
    expect(() => normalizeMarket({})).toThrow(/missing conditionId/i);
  });

  it("preserves raw payload reference", () => {
    const raw = { conditionId: "0xa", weird_field: "kept" };
    const m = normalizeMarket(raw);
    expect(m.raw).toBe(raw);
    expect((m.raw as Record<string, unknown>).weird_field).toBe("kept");
  });
});

// =============================================================================
// resolveSingleMarket
// =============================================================================

describe("resolveSingleMarket", () => {
  it("returns the single market from a clean response", () => {
    const res = { conditionId: "0xa", outcomes: ["Yes", "No"], clobTokenIds: ["1", "2"] };
    const m = resolveSingleMarket(res, "slug");
    expect(m?.conditionId).toBe("0xa");
  });

  it("returns null when no markets match", () => {
    expect(resolveSingleMarket({}, "slug")).toBeNull();
  });

  it("throws MarketAmbiguityError when multiple match without filter", () => {
    const event = {
      slug: "election",
      markets: [
        { conditionId: "0xa", question: "A" },
        { conditionId: "0xb", question: "B" },
      ],
    };
    expect(() => resolveSingleMarket(event, "election")).toThrow(MarketAmbiguityError);
  });

  it("resolves to one when filter narrows", () => {
    const event = {
      slug: "election",
      markets: [
        { conditionId: "0xa", question: "A" },
        { conditionId: "0xb", question: "B" },
      ],
    };
    const m = resolveSingleMarket(event, "election", { conditionId: "0xb" });
    expect(m?.conditionId).toBe("0xb");
  });
});
