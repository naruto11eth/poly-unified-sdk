// Exercise the named-export sub-clients directly, bypassing the facade.
// Proves the escape-hatch design isn't just rhetoric — the sub-clients are
// usable standalone for off-journey operations.
//
// Run:  npm run diag:subclients

import { GammaClient, DataApiClient } from "../src/index.js";

const FUNDER = process.env.FUNDER_ADDRESS;

console.log("=".repeat(60));
console.log("Testing named-export sub-clients directly (no facade)");
console.log("=".repeat(60));

// 1. GammaClient.list — fetch trending markets
console.log("\n[1] GammaClient.list — fetching 5 active markets...");
const gamma = new GammaClient();
const markets = await gamma.list({ active: true, closed: false, limit: 5 });
console.log(`✓ Got ${markets.length} markets`);
for (const m of markets.slice(0, 3)) {
  const q = (m.question ?? "").slice(0, 60);
  console.log(`    - ${q} (${m.outcomes.length} outcomes)`);
}

// 2. GammaClient.getByConditionId — fetch your env's specific market
if (process.env.CONDITION_ID) {
  console.log("\n[2] GammaClient.getByConditionId — fetching your env's conditionId...");
  const market = await gamma.getByConditionId(process.env.CONDITION_ID);
  console.log(`✓ ${market?.question}`);
  console.log(`   tickSize: ${market?.tickSize}, negRisk: ${market?.negRisk}`);
}

// 3. DataApiClient.list — fetch positions for a known active Polymarket trader
//    (an arbitrary public address with rich position history)
console.log("\n[3] DataApiClient.list — fetching positions for a known active trader...");
const data = new DataApiClient();
const knownTrader = "0x56687bf447db6ffa42ffe2204a05edaa20f55839" as `0x${string}`;
const positions = await data.list({ user: knownTrader, limit: 3 });
console.log(`✓ Got ${positions.length} positions for ${knownTrader.slice(0, 10)}...`);
for (const p of positions) {
  const title = (p.title ?? "").slice(0, 50);
  const value = p.currentValue?.toFixed(2) ?? "?";
  console.log(`    - ${title} | ${p.outcome} | size=${p.size} value=$${value}`);
}

// 4. DataApiClient.list — your own positions (now non-empty after that live trade)
if (FUNDER) {
  console.log(`\n[4] DataApiClient.list — your own funder ${FUNDER.slice(0, 10)}...`);
  const mine = await data.list({ user: FUNDER as `0x${string}` });
  console.log(`✓ Got ${mine.length} of your own positions`);
  for (const p of mine.slice(0, 5)) {
    const title = (p.title ?? "").slice(0, 50);
    console.log(`    - ${title} | ${p.outcome} | size=${p.size} | value=$${p.currentValue?.toFixed(4) ?? "?"}`);
  }
}

console.log("\n" + "=".repeat(60));
console.log("Sub-clients work standalone. Facade is optional.");
console.log("=".repeat(60));
