// List all markets nested inside an event slug, so you can pick a conditionId.
//
// Run:  npm run diag:markets <slug>
//
// Example:
//   npm run diag:markets us-x-iran-permanent-peace-deal-by

const slug = process.argv[2];
if (!slug) {
  console.error("Usage: npm run diag:markets <event-slug>");
  process.exit(1);
}

const url = `https://gamma-api.polymarket.com/events/slug/${encodeURIComponent(slug)}`;
console.log(`Fetching ${url}\n`);

const response = await fetch(url);
if (!response.ok) {
  console.error(`HTTP ${response.status} — ${await response.text()}`);
  process.exit(1);
}

const event = await response.json();
const markets = event.markets ?? [];

console.log(`Event: ${event.title ?? event.slug}`);
console.log(`Markets: ${markets.length}\n`);

for (let i = 0; i < markets.length; i++) {
  const m = markets[i];
  console.log(`${i + 1}. ${m.question ?? "(no question)"}`);
  console.log(`   conditionId:  ${m.conditionId ?? "?"}`);
  console.log(`   id:           ${m.id ?? "?"}`);
  console.log(`   closed:       ${m.closed ?? false}`);
  console.log(`   active:       ${m.active ?? "?"}`);
  console.log(`   outcomes:     ${m.outcomes ?? "?"}`);
  console.log("");
}

console.log("To use one of these in the smoke test, edit .env and add (uncomment) ONE of:");
console.log("  CONDITION_ID=<conditionId from above>");
console.log("  MARKET_ID=<id from above>");
console.log("");
console.log("Then re-run `npm run smoke`.");
