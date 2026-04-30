/**
 * Example 1 — Read-only quote.
 *
 * Fetches a market and computes an FOK quote. Spends no money. Does not sign anything.
 *
 * Usage:
 *   npm run example:quote                                       # uses .env values
 *   npm run example:quote -- --slug=foo --outcome=Yes --amount=2 # CLI overrides
 *   npm run example:quote -- --help                              # show all flags
 */

import { PolymarketClient } from "../src/client.js";
import { resolveWorkflowConfig } from "../scripts/cli.js";

async function main(): Promise<void> {
  const cfg = resolveWorkflowConfig({
    scriptName: "example:quote",
    description: "Fetch a market and compute an FOK quote (no signing, no submission).",
  });
  const client = await PolymarketClient.create({
    privateKey: cfg.privateKey,
    funderAddress: cfg.funderAddress,
    enableLiveTrading: false,
    ...(cfg.creds !== undefined ? { creds: cfg.creds } : {}),
  });

  const market = await client.markets.get({
    slug: cfg.marketSlug,
    ...(cfg.conditionId !== undefined ? { conditionId: cfg.conditionId } : {}),
    ...(cfg.marketId !== undefined ? { marketId: cfg.marketId } : {}),
  });
  if (!market) throw new Error(`No market for slug "${cfg.marketSlug}".`);

  const quote = await client.orders.quote({
    market,
    outcome: cfg.outcome,
    side: cfg.side,
    amount: cfg.amount,
    slippageBps: cfg.slippageBps,
  });

  console.log(`${cfg.side} ${cfg.amount} ${cfg.side === "BUY" ? "USDC" : "shares"} of "${cfg.outcome}":`);
  console.log(`  avg price:        ${quote.avgPrice.toFixed(4)}`);
  console.log(`  worst price cap:  ${quote.worstPrice.toFixed(4)} (${cfg.slippageBps} bps slippage)`);
  console.log(`  expected shares:  ${quote.expectedShares.toFixed(4)}`);
  console.log(`  expected cost:    ${quote.expectedCost.toFixed(4)} USDC`);
  console.log(`  fee (est):        ${quote.feeUsd?.toFixed(6) ?? "n/a"}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
