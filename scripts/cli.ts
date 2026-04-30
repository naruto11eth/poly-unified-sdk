/**
 * CLI parsing for the example scripts. NOT part of the SDK — this is reviewer-experience tooling.
 *
 * Precedence: CLI args > env vars > defaults.
 *
 * Wallet secrets (PRIVATE_KEY, FUNDER_ADDRESS) NEVER accept CLI overrides — too risky to put
 * them in shell history. Those still come from .env exclusively. Everything else can be
 * overridden per-invocation.
 *
 * Implementation note: we pre-populate process.env from CLI args, then defer to the SDK's
 * loadWorkflowConfigFromEnv() so we get its validation + group-rule logic for free.
 */

import { parseArgs } from "node:util";
import { loadWorkflowConfigFromEnv, type WorkflowConfig } from "../src/env.js";

export interface ScriptOptions {
  /** Human-readable script name shown in --help output. */
  readonly scriptName: string;
  /** What this script does, shown in --help. */
  readonly description: string;
  /** Whether `--dry-run` is a meaningful flag for this script. */
  readonly supportsDryRun?: boolean;
}

const FLAG_DEFINITIONS = {
  slug: { type: "string", description: "Market slug (overrides MARKET_SLUG)" },
  "condition-id": { type: "string", description: "Disambiguator for event slugs (overrides CONDITION_ID)" },
  "market-id": { type: "string", description: "Disambiguator alternative (overrides MARKET_ID)" },
  outcome: { type: "string", description: 'Outcome name, e.g. "Yes" / "No" (overrides OUTCOME)' },
  side: { type: "string", description: "BUY or SELL (overrides SIDE)" },
  amount: { type: "string", description: "Amount: USDC for BUY, shares for SELL (overrides AMOUNT)" },
  slippage: { type: "string", description: "Slippage in basis points, default 100 (overrides SLIPPAGE_BPS)" },
  "dry-run": { type: "boolean", description: "Force dryRun mode (sign without submitting)" },
  help: { type: "boolean", short: "h", description: "Show this help and exit" },
} as const;

/**
 * Parse CLI args, merge with env, return the validated workflow config.
 * Calls process.exit(0) on --help, process.exit(1) on validation failure.
 */
export function resolveWorkflowConfig(opts: ScriptOptions): WorkflowConfig & { dryRunOverride?: boolean } {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      slug: { type: "string" },
      "condition-id": { type: "string" },
      "market-id": { type: "string" },
      outcome: { type: "string" },
      side: { type: "string" },
      amount: { type: "string" },
      slippage: { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
    allowPositionals: false,
  });

  const { values } = parsed;

  if (values.help) {
    printHelp(opts);
    process.exit(0);
  }

  // Validate before merging.
  if (typeof values.side === "string") {
    const s = values.side.toUpperCase();
    if (s !== "BUY" && s !== "SELL") {
      console.error(`✗ --side must be BUY or SELL (got "${values.side}")`);
      process.exit(1);
    }
  }
  if (typeof values.amount === "string") {
    const n = Number(values.amount);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`✗ --amount must be a positive number (got "${values.amount}")`);
      process.exit(1);
    }
  }
  if (typeof values.slippage === "string") {
    const n = Number(values.slippage);
    if (!Number.isFinite(n) || n < 0) {
      console.error(`✗ --slippage must be a non-negative number (got "${values.slippage}")`);
      process.exit(1);
    }
  }
  if (typeof values["condition-id"] === "string" && typeof values["market-id"] === "string") {
    console.error(`✗ Pass either --condition-id or --market-id, not both.`);
    process.exit(1);
  }

  // Pre-populate env so the SDK's existing loader does the heavy lifting.
  // Wallet secrets never come from CLI — they must already be in env.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (typeof values.slug === "string") env.MARKET_SLUG = values.slug;
  if (typeof values["condition-id"] === "string") {
    env.CONDITION_ID = values["condition-id"];
    delete env.MARKET_ID; // CLI conditionId clears any conflicting env market-id
  }
  if (typeof values["market-id"] === "string") {
    env.MARKET_ID = values["market-id"];
    delete env.CONDITION_ID;
  }
  if (typeof values.outcome === "string") env.OUTCOME = values.outcome;
  if (typeof values.side === "string") env.SIDE = values.side.toUpperCase();
  if (typeof values.amount === "string") env.AMOUNT = values.amount;
  if (typeof values.slippage === "string") env.SLIPPAGE_BPS = values.slippage;

  let config: WorkflowConfig;
  try {
    config = loadWorkflowConfigFromEnv(env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ Configuration error: ${msg}`);
    console.error(`\nRun with --help to see available CLI flags.`);
    process.exit(1);
  }

  // Attach dryRun override if the script supports it.
  if (opts.supportsDryRun && values["dry-run"] === true) {
    return { ...config, dryRunOverride: true };
  }
  return config;
}

function printHelp(opts: ScriptOptions): void {
  const flags = Object.entries(FLAG_DEFINITIONS)
    .filter(([k]) => opts.supportsDryRun || k !== "dry-run")
    .map(([k, v]) => {
      const flag = `--${k}`.padEnd(18);
      return `  ${flag}  ${v.description}`;
    })
    .join("\n");

  console.log(`
${opts.scriptName} — ${opts.description}

Usage:
  npm run ${opts.scriptName} -- [flags]

Flags (all optional; CLI overrides .env):
${flags}

Required in .env (no CLI override for safety):
  PRIVATE_KEY        EOA private key (64 hex chars after 0x)
  FUNDER_ADDRESS     Polymarket Safe proxy address (top-right of polymarket.com)

Examples:
  npm run ${opts.scriptName} -- --slug=us-x-iran-diplomatic-meeting-by-329
  npm run ${opts.scriptName} -- --condition-id=0xbbc6... --side=SELL --amount=2 --slippage=250
  npm run ${opts.scriptName} -- --help
`.trim());
}
