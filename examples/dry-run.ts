/**
 * Example 2 — Dry-run signing.
 *
 * Walks the full workflow but uses { dryRun: true } so the order is signed
 * (createMarketOrder is called) and the signed payload is returned, but
 * postOrder is NEVER called. Spends no money.
 *
 * Useful for:
 *   - Verifying signer + funder + sigType wiring against real Polymarket APIs.
 *   - Inspecting an EIP-712 payload before deciding whether to submit.
 *
 * Usage:
 *   npm run example:dry-run                                        # uses .env values
 *   npm run example:dry-run -- --slug=foo --side=SELL --amount=10  # CLI overrides
 *   npm run example:dry-run -- --help                              # show all flags
 */

import { PolymarketClient } from "../src/client.js";
import { resolveWorkflowConfig } from "../scripts/cli.js";

async function main(): Promise<void> {
  const cfg = resolveWorkflowConfig({
    scriptName: "example:dry-run",
    description: "Sign a full FOK order without submitting (no money spent).",
  });
  const client = await PolymarketClient.create({
    privateKey: cfg.privateKey,
    funderAddress: cfg.funderAddress,
    enableLiveTrading: false,
    ...(cfg.creds !== undefined ? { creds: cfg.creds } : {}),
  });

  const result = await client.runWorkflow({
    slug: cfg.marketSlug,
    ...(cfg.conditionId !== undefined ? { conditionId: cfg.conditionId } : {}),
    ...(cfg.marketId !== undefined ? { marketId: cfg.marketId } : {}),
    outcome: cfg.outcome,
    side: cfg.side,
    amount: cfg.amount,
    slippageBps: cfg.slippageBps,
    dryRun: true,
  });

  if (result.kind !== "dryRun") {
    throw new Error("Expected dryRun result");
  }

  console.log("Market:");
  console.log(`  ${result.market.slug} — ${result.market.question}`);
  console.log(`\nQuote:`);
  console.log(`  avgPrice:   ${result.quote.avgPrice}`);
  console.log(`  worstPrice: ${result.quote.worstPrice}`);
  console.log(`\nDry-run signed payload (NOT submitted):`);
  console.log(`  tokenID:    ${result.dryRun.userMarketOrder.tokenID}`);
  console.log(`  price:      ${result.dryRun.userMarketOrder.price}`);
  console.log(`  amount:     ${result.dryRun.userMarketOrder.amount}`);
  console.log(`  side:       ${result.dryRun.userMarketOrder.side}`);
  console.log(`  orderType:  ${result.dryRun.userMarketOrder.orderType}`);
  console.log(`\nPositions (${result.positions.length}):`);
  for (const p of result.positions.slice(0, 5)) {
    console.log(`  - ${p.title} (${p.outcome}) size=${p.size}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
