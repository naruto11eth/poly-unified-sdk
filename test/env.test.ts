import { describe, expect, it } from "vitest";
import { loadWorkflowConfigFromEnv } from "../src/env.js";

const VALID_PK = "0x" + "a".repeat(64);
const VALID_FUNDER = "0x" + "b".repeat(40);

function baseEnv(): NodeJS.ProcessEnv {
  return {
    PRIVATE_KEY: VALID_PK,
    FUNDER_ADDRESS: VALID_FUNDER,
    MARKET_SLUG: "test-market",
    OUTCOME: "Yes",
    SIDE: "BUY",
    AMOUNT: "1",
  };
}

describe("loadWorkflowConfigFromEnv — happy path", () => {
  it("parses a minimal valid env", () => {
    const cfg = loadWorkflowConfigFromEnv(baseEnv());
    expect(cfg.privateKey).toBe(VALID_PK);
    expect(cfg.funderAddress).toBe(VALID_FUNDER);
    expect(cfg.marketSlug).toBe("test-market");
    expect(cfg.outcome).toBe("Yes");
    expect(cfg.side).toBe("BUY");
    expect(cfg.amount).toBe(1);
    expect(cfg.slippageBps).toBe(100);
    expect(cfg.enableLiveTrading).toBe(false);
  });

  it("uppercases SIDE to canonical form", () => {
    const cfg = loadWorkflowConfigFromEnv({ ...baseEnv(), SIDE: "buy" });
    expect(cfg.side).toBe("BUY");
  });

  it("respects custom SLIPPAGE_BPS", () => {
    const cfg = loadWorkflowConfigFromEnv({ ...baseEnv(), SLIPPAGE_BPS: "250" });
    expect(cfg.slippageBps).toBe(250);
  });

  it("includes CONDITION_ID when set", () => {
    const cfg = loadWorkflowConfigFromEnv({ ...baseEnv(), CONDITION_ID: "0xabc" });
    expect(cfg.conditionId).toBe("0xabc");
    expect(cfg.marketId).toBeUndefined();
  });

  it("includes MARKET_ID when set", () => {
    const cfg = loadWorkflowConfigFromEnv({ ...baseEnv(), MARKET_ID: "1234" });
    expect(cfg.marketId).toBe("1234");
    expect(cfg.conditionId).toBeUndefined();
  });

  it("includes creds when all three CLOB env vars set", () => {
    const cfg = loadWorkflowConfigFromEnv({
      ...baseEnv(),
      CLOB_API_KEY: "k",
      CLOB_SECRET: "s",
      CLOB_PASSPHRASE: "p",
    });
    expect(cfg.creds).toEqual({ key: "k", secret: "s", passphrase: "p" });
  });
});

describe("loadWorkflowConfigFromEnv — strict POLYMARKET_ENABLE_LIVE_TRADING", () => {
  it("enables on literal lowercase 'true'", () => {
    const cfg = loadWorkflowConfigFromEnv({ ...baseEnv(), POLYMARKET_ENABLE_LIVE_TRADING: "true" });
    expect(cfg.enableLiveTrading).toBe(true);
  });

  it.each(["TRUE", "True", "1", "yes", "on", "y", " true ", ""])(
    "rejects '%s' (treats as false)",
    (val) => {
      const cfg = loadWorkflowConfigFromEnv({
        ...baseEnv(),
        POLYMARKET_ENABLE_LIVE_TRADING: val,
      });
      expect(cfg.enableLiveTrading).toBe(false);
    },
  );

  it("defaults to false when unset", () => {
    const cfg = loadWorkflowConfigFromEnv(baseEnv());
    expect(cfg.enableLiveTrading).toBe(false);
  });
});

describe("loadWorkflowConfigFromEnv — validation errors", () => {
  it.each([
    "PRIVATE_KEY",
    "FUNDER_ADDRESS",
    "MARKET_SLUG",
    "OUTCOME",
    "SIDE",
    "AMOUNT",
  ])("throws when %s is missing", (key) => {
    const env = baseEnv();
    delete env[key];
    expect(() => loadWorkflowConfigFromEnv(env)).toThrow(new RegExp(key));
  });

  it("rejects malformed PRIVATE_KEY", () => {
    expect(() =>
      loadWorkflowConfigFromEnv({ ...baseEnv(), PRIVATE_KEY: "0xabc" }),
    ).toThrow(/PRIVATE_KEY/);
  });

  it("rejects malformed FUNDER_ADDRESS", () => {
    expect(() =>
      loadWorkflowConfigFromEnv({ ...baseEnv(), FUNDER_ADDRESS: "not-an-address" }),
    ).toThrow(/FUNDER_ADDRESS/);
  });

  it("rejects invalid SIDE", () => {
    expect(() => loadWorkflowConfigFromEnv({ ...baseEnv(), SIDE: "HOLD" })).toThrow(/SIDE/);
  });

  it("rejects non-positive AMOUNT", () => {
    expect(() => loadWorkflowConfigFromEnv({ ...baseEnv(), AMOUNT: "0" })).toThrow(/AMOUNT/);
    expect(() => loadWorkflowConfigFromEnv({ ...baseEnv(), AMOUNT: "-1" })).toThrow(/AMOUNT/);
    expect(() => loadWorkflowConfigFromEnv({ ...baseEnv(), AMOUNT: "abc" })).toThrow(/AMOUNT/);
  });

  it("rejects negative SLIPPAGE_BPS", () => {
    expect(() =>
      loadWorkflowConfigFromEnv({ ...baseEnv(), SLIPPAGE_BPS: "-1" }),
    ).toThrow(/SLIPPAGE_BPS/);
  });

  it("rejects both CONDITION_ID and MARKET_ID set together (group rule)", () => {
    expect(() =>
      loadWorkflowConfigFromEnv({
        ...baseEnv(),
        CONDITION_ID: "0xabc",
        MARKET_ID: "1234",
      }),
    ).toThrow(/CONDITION_ID.*MARKET_ID/);
  });

  it("rejects partial CLOB cred triple (all-or-none rule)", () => {
    expect(() =>
      loadWorkflowConfigFromEnv({ ...baseEnv(), CLOB_API_KEY: "k" }),
    ).toThrow(/CLOB_API_KEY/);
    expect(() =>
      loadWorkflowConfigFromEnv({ ...baseEnv(), CLOB_API_KEY: "k", CLOB_SECRET: "s" }),
    ).toThrow(/CLOB_API_KEY/);
  });

  it("accepts CLOB_API_KEY=' ' as unset (empty string treated as absent)", () => {
    const cfg = loadWorkflowConfigFromEnv({ ...baseEnv(), CLOB_API_KEY: "" });
    expect(cfg.creds).toBeUndefined();
  });
});
