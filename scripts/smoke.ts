/**
 * Read-only end-to-end smoke test against live Polymarket APIs.
 *
 * Spends zero money. Calls Gamma → CLOB pricing → Data API positions →
 * dryRun signing (which signs locally but never submits).
 *
 * Usage:
 *   1. cp .env.example .env
 *   2. Fill PRIVATE_KEY, FUNDER_ADDRESS (other params from .env or CLI flags)
 *   3. npm run smoke                          # uses .env values
 *      npm run smoke -- --slug=foo --side=BUY # CLI overrides per invocation
 *      npm run smoke -- --help                # show all flags
 *
 * The smoke deliberately does NOT enable live trading — `enableLiveTrading`
 * is forced false here regardless of the env var.
 */

import { PolymarketClient } from "../src/client.js";
import { resolveWorkflowConfig } from "./cli.js";

const BANNER = "============================================================";

async function main(): Promise<void> {
  console.log(BANNER);
  console.log("Polymarket Unified SDK — read-only smoke test");
  console.log(BANNER);

  const cfg = resolveWorkflowConfig({
    scriptName: "smoke",
    description: "Read-only end-to-end smoke test (zero money risk).",
  });

  // Force live trading OFF for the smoke regardless of env. Defense in depth.
  const client = await PolymarketClient.create({
    privateKey: cfg.privateKey,
    funderAddress: cfg.funderAddress,
    enableLiveTrading: false,
    ...(cfg.creds !== undefined ? { creds: cfg.creds } : {}),
  });

  // -------------------------------------------------------------------------
  // 1. Fetch market
  // -------------------------------------------------------------------------
  console.log(`\n[1/4] Fetching market by slug: "${cfg.marketSlug}"`);
  const market = await client.markets.get({
    slug: cfg.marketSlug,
    ...(cfg.conditionId !== undefined ? { conditionId: cfg.conditionId } : {}),
    ...(cfg.marketId !== undefined ? { marketId: cfg.marketId } : {}),
  });
  if (!market) {
    console.error(`✗ No market found for slug "${cfg.marketSlug}".`);
    process.exit(1);
  }
  console.log(`✓ Found market`);
  console.log(`    conditionId: ${market.conditionId}`);
  console.log(`    question:    ${market.question}`);
  console.log(`    tickSize:    ${market.tickSize}`);
  console.log(`    negRisk:     ${market.negRisk}`);
  console.log(`    closed:      ${market.closed}`);
  console.log(`    outcomes:`);
  for (const o of market.outcomes) {
    console.log(`      - ${o.name.padEnd(30)} ${o.tokenId}`);
  }

  // -------------------------------------------------------------------------
  // 2. Quote FOK
  // -------------------------------------------------------------------------
  console.log(`\n[2/4] Quoting FOK ${cfg.side} ${cfg.amount} ${cfg.side === "BUY" ? "USDC" : "shares"} for "${cfg.outcome}"`);
  const quote = await client.orders.quote({
    market,
    outcome: cfg.outcome,
    side: cfg.side,
    amount: cfg.amount,
    slippageBps: cfg.slippageBps,
  });
  console.log(`✓ Quote computed`);
  console.log(`    avgPrice:        ${quote.avgPrice.toFixed(4)}`);
  console.log(`    worstPrice:      ${quote.worstPrice.toFixed(4)} (after ${cfg.slippageBps} bps slippage, tick-rounded)`);
  console.log(`    expectedShares:  ${quote.expectedShares.toFixed(4)}`);
  console.log(`    expectedCost:    ${quote.expectedCost.toFixed(4)} USDC`);
  console.log(`    feeUsd (est):    ${quote.feeUsd?.toFixed(6) ?? "n/a"}`);

  // -------------------------------------------------------------------------
  // 3. Dry-run place (signs but never submits)
  // -------------------------------------------------------------------------
  console.log(`\n[3/4] Dry-run signing — calls createMarketOrder, skips postOrder`);
  const placement = await client.orders.place({
    market,
    outcome: cfg.outcome,
    side: cfg.side,
    amount: cfg.amount,
    slippageBps: cfg.slippageBps,
    dryRun: true,
  });
  if ("kind" in placement && placement.kind === "dryRun") {
    const preview = JSON.stringify(placement.signedOrder).slice(0, 200);
    console.log(`✓ Signed payload built (live submission was NOT made)`);
    console.log(`    userMarketOrder.tokenID:   ${placement.userMarketOrder.tokenID}`);
    console.log(`    userMarketOrder.price:     ${placement.userMarketOrder.price}`);
    console.log(`    userMarketOrder.amount:    ${placement.userMarketOrder.amount}`);
    console.log(`    userMarketOrder.side:      ${placement.userMarketOrder.side}`);
    console.log(`    userMarketOrder.orderType: ${placement.userMarketOrder.orderType}`);
    console.log(`    options.tickSize:          ${placement.options.tickSize}`);
    console.log(`    options.negRisk:           ${placement.options.negRisk}`);
    console.log(`    signedOrder preview:       ${preview}${preview.length === 200 ? "..." : ""}`);
  }

  // -------------------------------------------------------------------------
  // 4. Positions
  // -------------------------------------------------------------------------
  console.log(`\n[4/4] Listing positions for funder ${cfg.funderAddress}`);
  const positions = await client.positions.list({
    user: cfg.funderAddress,
  });
  console.log(`✓ ${positions.length} position(s)`);
  for (const p of positions.slice(0, 5)) {
    console.log(`    - ${p.title} (${p.outcome}) | size=${p.size} avg=${p.avgPrice} value=${p.currentValue}`);
  }
  if (positions.length > 5) {
    console.log(`    ... and ${positions.length - 5} more`);
  }

  console.log(`\n${BANNER}`);
  console.log("Smoke test complete. No funds were moved.");
  console.log(BANNER);
}

main().catch((err: unknown) => {
  console.error("\n✗ Smoke test failed:");
  if (err instanceof Error) {
    console.error(`    ${err.name}: ${err.message}`);
    if ("status" in err) console.error(`    status: ${(err as { status: number }).status}`);
    if ("body" in err) {
      const body = (err as { body: unknown }).body;
      console.error(`    body: ${typeof body === "string" ? body : JSON.stringify(body)?.slice(0, 200)}`);
    }
  } else {
    console.error(err);
  }
  process.exit(1);
});
