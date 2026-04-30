import { describe, expect, it } from "vitest";
import { PolymarketApiError } from "../src/errors.js";
import { DataApiClient } from "../src/clients/data-api.js";
import type { FetchLike } from "../src/types.js";

const samplePosition = {
  conditionId: "0xabc",
  outcome: "Yes",
  title: "Will it rain?",
  size: 10,
  avgPrice: 0.5,
  currentValue: 5,
  cashPnl: 0.5,
  percentPnl: 10,
  endDate: "2026-12-31",
  redeemable: false,
  mergeable: false,
  negativeRisk: false,
};

describe("DataApiClient.list", () => {
  it("returns normalized positions", async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => [samplePosition, samplePosition],
    });
    const client = new DataApiClient({ fetch });
    const result = await client.list({ user: "0x1234" });
    expect(result).toHaveLength(2);
    expect(result[0]?.conditionId).toBe("0xabc");
    expect(result[0]?.size).toBe(10);
    expect(result[0]?.raw).toBe(samplePosition);
  });

  it("returns empty array on empty response", async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => [],
    });
    const client = new DataApiClient({ fetch });
    const result = await client.list({ user: "0x1234" });
    expect(result).toEqual([]);
  });

  it("returns empty array on non-array response (defensive)", async () => {
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ unexpected: "shape" }),
    });
    const client = new DataApiClient({ fetch });
    expect(await client.list({ user: "0x1234" })).toEqual([]);
  });

  it("passes market filter through as ?market= query", async () => {
    let url: string | null = null;
    const fetch: FetchLike = async (input) => {
      url = typeof input === "string" ? input : input.toString();
      return { ok: true, status: 200, text: async () => "", json: async () => [] };
    };
    const client = new DataApiClient({ fetch });
    await client.list({ user: "0x1234", market: "0xabc" });
    expect(url).toContain("user=0x1234");
    expect(url).toContain("market=0xabc");
  });

  it("propagates 500 errors as PolymarketApiError", async () => {
    const fetch: FetchLike = async () => ({
      ok: false,
      status: 500,
      text: async () => "internal",
      json: async () => ({ error: "boom" }),
    });
    const client = new DataApiClient({ fetch });
    await expect(client.list({ user: "0x1234" })).rejects.toBeInstanceOf(PolymarketApiError);
  });

  it("normalizes snake_case fields from real Data API shape", async () => {
    const snakeCasePosition = {
      condition_id: "0xdef",
      outcome: "No",
      title: "Q",
      size: 5,
      avg_price: 0.3,
      current_value: 1.5,
      cash_pnl: 0,
      percent_pnl: 0,
      end_date: "2026-01-01",
      redeemable: true,
      mergeable: false,
      negative_risk: true,
    };
    const fetch: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => [snakeCasePosition],
    });
    const client = new DataApiClient({ fetch });
    const result = await client.list({ user: "0x1234" });
    expect(result[0]?.conditionId).toBe("0xdef");
    expect(result[0]?.avgPrice).toBe(0.3);
    expect(result[0]?.currentValue).toBe(1.5);
    expect(result[0]?.endDate).toBe("2026-01-01");
    expect(result[0]?.redeemable).toBe(true);
    expect(result[0]?.negativeRisk).toBe(true);
  });
});
