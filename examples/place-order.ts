/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║                       ⚠  REAL MONEY WARNING  ⚠                           ║
 * ║                                                                          ║
 * ║  This script places a LIVE FOK market order on Polymarket. It will       ║
 * ║  spend real USDC from your funder Safe proxy if all gates pass.          ║
 * ║                                                                          ║
 * ║  Required to run live:                                                   ║
 * ║    1. POLYMARKET_ENABLE_LIVE_TRADING=true in env (operational gate)      ║
 * ║    2. The hardcoded `confirm: true` literal below (intent gate)          ║
 * ║                                                                          ║
 * ║  Pass --dry-run on the CLI to force-bypass live submission as a safety   ║
 * ║  override (signs without submitting), even when both gates are open.     ║
 * ║                                                                          ║
 * ║  Default AMOUNT in .env.example is 1 USDC. Test with that first.         ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   npm run example:place                                  # uses .env values
 *   npm run example:place -- --slug=foo --amount=2         # CLI overrides
 *   npm run example:place -- --dry-run                     # force dry-run safety override
 *   npm run example:place -- --help
 */

import { PolymarketClient } from "../src/client.js";
import { OrderPlacementError } from "../src/errors.js";
import { resolveWorkflowConfig } from "../scripts/cli.js";

const POLYGONSCAN = "https://polygonscan.com";
const POLYMARKET = "https://polymarket.com";

async function main(): Promise<void> {
  const cfg = resolveWorkflowConfig({
    scriptName: "example:place",
    description: "Place a LIVE FOK order on Polymarket. Spends real USDC unless --dry-run.",
    supportsDryRun: true,
  });

  const forceDryRun = cfg.dryRunOverride === true;

  if (!cfg.enableLiveTrading && !forceDryRun) {
    console.error(
      "✗ Live trading is disabled. Set POLYMARKET_ENABLE_LIVE_TRADING=true to enable,\n" +
        "  or pass --dry-run on the CLI to sign without submitting.",
    );
    process.exit(1);
  }

  const client = await PolymarketClient.create({
    privateKey: cfg.privateKey,
    funderAddress: cfg.funderAddress,
    enableLiveTrading: cfg.enableLiveTrading,
    ...(cfg.creds !== undefined ? { creds: cfg.creds } : {}),
  });

  const action = forceDryRun ? "DRY-RUN sign" : "LIVE FOK order";
  const denom = cfg.side === "BUY" ? "USDC" : "shares";
  console.log(`About to ${action}`);
  console.log(`  market slug:   ${cfg.marketSlug}`);
  console.log(`                 ${POLYMARKET}/event/${cfg.marketSlug}`);
  console.log(`  outcome:       ${cfg.outcome}`);
  console.log(`  side:          ${cfg.side}`);
  console.log(`  amount:        ${cfg.amount} ${denom}`);
  console.log(`  slippage:      ${cfg.slippageBps} bps`);
  console.log(`  funder:        ${cfg.funderAddress}`);
  console.log(`                 ${POLYGONSCAN}/address/${cfg.funderAddress}`);

  if (!forceDryRun) {
    console.log(`\n⚠ Real money. Proceeding in 5 seconds. Ctrl-C to abort.`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  try {
    // The discriminated union forces explicit intent: dryRun mode uses { dryRun: true },
    // live mode requires literal `confirm: true`. Mirrors `client.orders.place`.
    const baseInput = {
      slug: cfg.marketSlug,
      ...(cfg.conditionId !== undefined ? { conditionId: cfg.conditionId } : {}),
      ...(cfg.marketId !== undefined ? { marketId: cfg.marketId } : {}),
      outcome: cfg.outcome,
      side: cfg.side,
      amount: cfg.amount,
      slippageBps: cfg.slippageBps,
    };
    const result = forceDryRun
      ? await client.runWorkflow({ ...baseInput, dryRun: true })
      : await client.runWorkflow({ ...baseInput, confirm: true });

    if (forceDryRun) {
      if (result.kind !== "dryRun") throw new Error("Expected dryRun result");
      console.log(`\n✓ Dry-run signed payload built (NOT submitted)`);
      console.log(`  market:      "${result.market.question}"`);
      console.log(`  tokenID:     ${result.dryRun.userMarketOrder.tokenID}`);
      console.log(`  price cap:   ${result.dryRun.userMarketOrder.price}`);
      console.log(`  amount:      ${result.dryRun.userMarketOrder.amount}`);
      console.log(`  side:        ${result.dryRun.userMarketOrder.side}`);
      console.log(`  orderType:   ${result.dryRun.userMarketOrder.orderType}`);
      console.log(`  options.tickSize: ${result.dryRun.options.tickSize}`);
      console.log(`  options.negRisk:  ${result.dryRun.options.negRisk}`);
      return;
    }

    if (result.kind !== "live") {
      throw new Error("Expected live result");
    }

    // ---- Quote that built the order ----
    console.log(`\nQuote computed (used to build the signed order):`);
    console.log(`  market:        "${result.market.question}"`);
    console.log(`  avgPrice:      ${result.quote.avgPrice.toFixed(4)}  (from clob.calculateMarketPrice)`);
    console.log(`  worstPrice:    ${result.quote.worstPrice.toFixed(4)}  (slippage cap on the signed order)`);
    console.log(`  expectedShares:${result.quote.expectedShares.toFixed(4)}`);
    console.log(`  expectedCost:  ${result.quote.expectedCost.toFixed(4)} USDC`);
    console.log(`  feeUsd (est):  ${result.quote.feeUsd?.toFixed(6) ?? "n/a"}`);

    // ---- Order receipt ----
    console.log(`\n✓ Order accepted by CLOB`);
    console.log(`  status:        ${result.receipt.status}`);
    console.log(`  orderID:       ${result.receipt.orderId}`);
    console.log(`  takingAmount:  ${result.receipt.takingAmount}  (raw base units returned by CLOB)`);

    // ---- Transaction links ----
    console.log(`\nOn-chain transaction(s):`);
    if (result.receipt.transactionHashes.length === 0) {
      console.log(`  (none returned yet — the matcher submits the tx asynchronously after MATCHED;`);
      console.log(`   it'll appear in your funder's Polygonscan history within a few seconds:`);
      console.log(`   ${POLYGONSCAN}/address/${cfg.funderAddress})`);
    } else {
      for (const tx of result.receipt.transactionHashes) {
        console.log(`  ${POLYGONSCAN}/tx/${tx}`);
      }
    }

    // ---- Position read-back ----
    console.log(`\nResulting positions (${result.positions.length}):`);
    if (result.positions.length === 0) {
      console.log(`  (Data API hasn't indexed yet — typical after a fresh trade.`);
      console.log(`   Re-run \`npm run smoke\` in ~30s and step 4 will show the new position.`);
      console.log(`   Or check live: ${POLYMARKET}/profile/${cfg.funderAddress})`);
    } else {
      for (const p of result.positions.slice(0, 10)) {
        // toFixed already prints the minus sign for negatives; only add "+" for non-negatives.
        const cashPnlStr = (p.cashPnl >= 0 ? "+" : "") + p.cashPnl.toFixed(4);
        const pctPnlStr = (p.percentPnl >= 0 ? "+" : "") + p.percentPnl.toFixed(2);
        console.log(
          `  - "${p.title}" (${p.outcome})\n` +
            `      size=${p.size}  avg=${p.avgPrice}  value=$${p.currentValue?.toFixed(4) ?? "?"}` +
            `  pnl=$${cashPnlStr} (${pctPnlStr}%)`,
        );
      }
    }

    console.log(`\nView all positions: ${POLYMARKET}/profile/${cfg.funderAddress}`);
  } catch (err) {
    if (err instanceof OrderPlacementError) {
      console.error(`\n✗ Order rejected by CLOB:`);
      console.error(`  status:   ${err.response.status}`);
      console.error(`  errorMsg: ${err.response.errorMsg}`);
      console.error(`\nNo funds moved.`);
      process.exit(2);
    }
    throw err;
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
