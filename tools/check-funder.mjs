// One-off diagnostic: is the Polymarket Safe proxy at FUNDER_ADDRESS deployed on Polygon?
//
// If `result` is "0x"     -> Safe NOT deployed -> complete onboarding on polymarket.com (deposit USDC)
// If `result` starts 0x6080 -> Safe IS deployed -> the auth issue is something else
//
// Run:  npm run diag:funder

const FUNDER = "0x50494B33a0C165DD9574D9142e29b0c30E2ce4EA";
const RPC = "https://polygon.drpc.org";

const response = await fetch(RPC, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_getCode",
    params: [FUNDER, "latest"],
    id: 1,
  }),
});

const body = await response.json();
const code = body?.result;

console.log("=".repeat(60));
console.log(`Funder address: ${FUNDER}`);
console.log(`RPC:            ${RPC}`);
console.log("=".repeat(60));

if (typeof code !== "string") {
  console.log("✗ Unexpected RPC response:");
  console.log(JSON.stringify(body, null, 2));
  process.exit(1);
}

if (code === "0x") {
  console.log("");
  console.log("❌ Safe proxy is NOT DEPLOYED on Polygon.");
  console.log("");
  console.log("   This is why `Could not create api key` is failing.");
  console.log("   Polymarket cannot derive credentials for a Safe that doesn't exist.");
  console.log("");
  console.log("   FIX:");
  console.log("     1. Open https://polymarket.com");
  console.log("     2. Connect MetaMask (the wallet whose private key is in .env)");
  console.log("     3. Click 'Deposit' and deposit at least $1 USDC");
  console.log("     4. The deposit transaction deploys the Safe");
  console.log("     5. Re-run `npm run smoke`");
  console.log("");
} else {
  console.log("");
  console.log(`✓ Safe proxy IS DEPLOYED (contract code: ${code.length} bytes).`);
  console.log("");
  console.log("   Code preview:", code.slice(0, 80) + (code.length > 80 ? "..." : ""));
  console.log("");
  console.log("   The 'Could not create api key' error is NOT due to a missing Safe.");
  console.log("   Check next:");
  console.log("     • Is your PRIVATE_KEY's EOA address the OWNER of this Safe?");
  console.log("       (i.e., the same MetaMask account you onboarded with on polymarket.com)");
  console.log("     • Have you completed the trading-setup approvals during onboarding?");
  console.log("");
}
