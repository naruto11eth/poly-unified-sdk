import type { ApiKeyCreds } from "@polymarket/clob-client-v2";

/**
 * Workflow config loaded from environment variables. Used by the smoke script
 * and example scripts. Not part of the SDK's public surface — callers building
 * their own apps construct `PolymarketClient` directly.
 */
export interface WorkflowConfig {
  readonly privateKey: `0x${string}`;
  readonly funderAddress: `0x${string}`;
  readonly marketSlug: string;
  readonly outcome: string;
  readonly side: "BUY" | "SELL";
  readonly amount: number;
  readonly slippageBps: number;
  readonly enableLiveTrading: boolean;
  readonly conditionId?: string;
  readonly marketId?: string;
  readonly creds?: ApiKeyCreds;
}

// Strict: literal lowercase "true" only. "TRUE", "1", "yes" do NOT enable live
// trading. The strictness prevents accidental enables from sloppy env handling.

export function loadWorkflowConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): WorkflowConfig {
  const privateKey = requireString(env, "PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("PRIVATE_KEY must be a 0x-prefixed 64-hex-char string.");
  }
  const funderAddress = requireString(env, "FUNDER_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(funderAddress)) {
    throw new Error("FUNDER_ADDRESS must be a 0x-prefixed 40-hex-char address.");
  }

  const marketSlug = requireString(env, "MARKET_SLUG");
  const outcome = requireString(env, "OUTCOME");

  const sideRaw = requireString(env, "SIDE").toUpperCase();
  if (sideRaw !== "BUY" && sideRaw !== "SELL") {
    throw new Error(`SIDE must be BUY or SELL (got "${sideRaw}").`);
  }
  const side = sideRaw as "BUY" | "SELL";

  const amount = Number(requireString(env, "AMOUNT"));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`AMOUNT must be a positive number (got "${env.AMOUNT}").`);
  }

  const slippageBpsRaw = env.SLIPPAGE_BPS;
  const slippageBps = slippageBpsRaw === undefined ? 100 : Number(slippageBpsRaw);
  if (!Number.isFinite(slippageBps) || slippageBps < 0) {
    throw new Error(`SLIPPAGE_BPS must be a non-negative number (got "${slippageBpsRaw}").`);
  }

  // Strict equality with literal lowercase "true". Anything else is false.
  const enableLiveTrading = env.POLYMARKET_ENABLE_LIVE_TRADING === "true";

  // Group rule: exactly one of CONDITION_ID / MARKET_ID may be set.
  const conditionId = env.CONDITION_ID;
  const marketId = env.MARKET_ID;
  if (conditionId && marketId) {
    throw new Error("Set exactly one of CONDITION_ID or MARKET_ID, not both.");
  }

  // Group rule: all-or-none of CLOB_API_KEY / CLOB_SECRET / CLOB_PASSPHRASE.
  const credKeys = ["CLOB_API_KEY", "CLOB_SECRET", "CLOB_PASSPHRASE"] as const;
  const credValues = credKeys.map((k) => env[k]);
  const credPresent = credValues.filter((v) => v !== undefined && v !== "").length;
  if (credPresent !== 0 && credPresent !== 3) {
    throw new Error(
      `CLOB_API_KEY/CLOB_SECRET/CLOB_PASSPHRASE must all be set together or all unset.`,
    );
  }
  const creds: ApiKeyCreds | undefined =
    credPresent === 3
      ? {
          key: env.CLOB_API_KEY!,
          secret: env.CLOB_SECRET!,
          passphrase: env.CLOB_PASSPHRASE!,
        }
      : undefined;

  return {
    privateKey: privateKey as `0x${string}`,
    funderAddress: funderAddress as `0x${string}`,
    marketSlug,
    outcome,
    side,
    amount,
    slippageBps,
    enableLiveTrading,
    ...(conditionId !== undefined && conditionId !== "" ? { conditionId } : {}),
    ...(marketId !== undefined && marketId !== "" ? { marketId } : {}),
    ...(creds !== undefined ? { creds } : {}),
  };
}

function requireString(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required env var: ${name}.`);
  }
  return value;
}
