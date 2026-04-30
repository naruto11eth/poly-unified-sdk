import { describe, expect, it } from "vitest";
import { applySlippage, roundPriceToTick } from "../src/price.js";

describe("applySlippage", () => {
  it("widens BUY price upward", () => {
    expect(applySlippage(0.5, "BUY", 100)).toBeCloseTo(0.505, 10);
  });

  it("widens SELL price downward", () => {
    expect(applySlippage(0.5, "SELL", 100)).toBeCloseTo(0.495, 10);
  });

  it("returns the same price at 0 bps", () => {
    expect(applySlippage(0.5, "BUY", 0)).toBeCloseTo(0.5);
    expect(applySlippage(0.5, "SELL", 0)).toBeCloseTo(0.5);
  });

  it("handles 1000 bps (10%)", () => {
    expect(applySlippage(0.5, "BUY", 1000)).toBeCloseTo(0.55);
    expect(applySlippage(0.5, "SELL", 1000)).toBeCloseTo(0.45);
  });

  it("does not clamp — clamping is roundPriceToTick's job", () => {
    expect(applySlippage(0.99, "BUY", 1000)).toBeGreaterThan(1);
  });

  it("rejects negative bps", () => {
    expect(() => applySlippage(0.5, "BUY", -1)).toThrow(RangeError);
  });

  it("rejects non-finite inputs", () => {
    expect(() => applySlippage(NaN, "BUY", 100)).toThrow(RangeError);
    expect(() => applySlippage(0.5, "BUY", Infinity)).toThrow(RangeError);
  });
});

describe("roundPriceToTick — direction invariant", () => {
  it("BUY ceils at tick 0.01", () => {
    expect(roundPriceToTick(0.5051, 0.01, "BUY")).toBeCloseTo(0.51);
  });

  it("SELL floors at tick 0.01", () => {
    expect(roundPriceToTick(0.5051, 0.01, "SELL")).toBeCloseTo(0.5);
  });

  it("BUY ceils at tick 0.001", () => {
    expect(roundPriceToTick(0.5005, 0.001, "BUY")).toBeCloseTo(0.501);
  });

  it("SELL floors at tick 0.001", () => {
    expect(roundPriceToTick(0.5005, 0.001, "SELL")).toBeCloseTo(0.5);
  });

  it("returns price unchanged when already on a tick", () => {
    expect(roundPriceToTick(0.5, 0.01, "BUY")).toBeCloseTo(0.5);
    expect(roundPriceToTick(0.5, 0.01, "SELL")).toBeCloseTo(0.5);
  });

  it("clamps BUY at 1.0 — doesn't ceil above", () => {
    expect(roundPriceToTick(1.005, 0.01, "BUY")).toBeLessThanOrEqual(1);
    expect(roundPriceToTick(0.995, 0.01, "BUY")).toBeCloseTo(1.0);
  });

  it("clamps SELL at tickSize — doesn't floor below", () => {
    expect(roundPriceToTick(0.005, 0.01, "SELL")).toBeCloseTo(0.01);
    expect(roundPriceToTick(0.0001, 0.01, "SELL")).toBeCloseTo(0.01);
  });

  it("rejects invalid tickSize", () => {
    expect(() => roundPriceToTick(0.5, 0, "BUY")).toThrow(RangeError);
    expect(() => roundPriceToTick(0.5, 1.5, "BUY")).toThrow(RangeError);
    expect(() => roundPriceToTick(0.5, -0.01, "BUY")).toThrow(RangeError);
  });

  it("rejects non-finite price", () => {
    expect(() => roundPriceToTick(NaN, 0.01, "BUY")).toThrow(RangeError);
  });
});

describe("roundPriceToTick — fuzz invariants", () => {
  // Outside the [tickSize, 1] clamp region, rounding direction is strict:
  //   BUY rounded ≥ unrounded
  //   SELL rounded ≤ unrounded
  // Inside the clamp region (price near 0 or near 1), the clamp deliberately
  // moves the worst-price toward the safer bound — those cases are tested
  // separately above.
  it("BUY rounded ≥ unrounded for 1000 random samples (clear of clamps)", () => {
    for (let i = 0; i < 1000; i++) {
      const tickPick = [0.0001, 0.001, 0.01, 0.1][Math.floor(Math.random() * 4)] ?? 0.01;
      // Stay clear of the 1.0 ceiling clamp.
      const price = Math.random() * (1 - 2 * tickPick - 0.01) + tickPick;
      const rounded = roundPriceToTick(price, tickPick, "BUY");
      expect(rounded + 1e-12).toBeGreaterThanOrEqual(price);
    }
  });

  it("SELL rounded ≤ unrounded for 1000 random samples (clear of clamps)", () => {
    for (let i = 0; i < 1000; i++) {
      const tickPick = [0.0001, 0.001, 0.01, 0.1][Math.floor(Math.random() * 4)] ?? 0.01;
      // Stay clear of the tickSize floor clamp.
      const price = Math.random() * (1 - 2 * tickPick - 0.01) + 2 * tickPick;
      const rounded = roundPriceToTick(price, tickPick, "SELL");
      expect(rounded - 1e-12).toBeLessThanOrEqual(price);
    }
  });
});
