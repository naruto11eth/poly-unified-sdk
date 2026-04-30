// Diagnostic: does PRIVATE_KEY belong to the EOA that owns the Polymarket Safe at FUNDER_ADDRESS?
//
// Run:  npm run diag:owner
//
// Three outcomes:
//   ✓ Owner matches  -> private key + funder are correctly paired; problem is elsewhere
//   ❌ Owner differs -> wrong PRIVATE_KEY in .env (you onboarded with a different MetaMask account)
//   ⚠ owner() call reverts -> proxy uses a non-standard interface; fall back to manual check

import { privateKeyToAccount } from "viem/accounts";

const FUNDER = process.env.FUNDER_ADDRESS;
const PK = process.env.PRIVATE_KEY;
const RPC = "https://polygon.drpc.org";

if (!FUNDER || !PK) {
  console.error("Missing FUNDER_ADDRESS or PRIVATE_KEY in .env");
  process.exit(1);
}

// 1. Derive EOA from PRIVATE_KEY
const account = privateKeyToAccount(PK);
const signerEoa = account.address.toLowerCase();

console.log("=".repeat(60));
console.log("Funder address (Safe proxy):", FUNDER);
console.log("Signer EOA (from PRIVATE_KEY):", account.address);
console.log("=".repeat(60));

// 2. Call owner() on the Safe proxy.
// owner() selector = 0x8da5cb5b, returns address (32-byte left-padded).
const callData = "0x8da5cb5b";

const response = await fetch(RPC, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_call",
    params: [{ to: FUNDER, data: callData }, "latest"],
    id: 1,
  }),
});

const body = await response.json();
const result = body?.result;

if (typeof result !== "string" || result === "0x" || body.error) {
  console.log("");
  console.log("⚠ Safe's owner() call reverted or returned nothing.");
  console.log("   Either the proxy uses a non-standard interface, or it's not initialised.");
  console.log("   RPC response:", JSON.stringify(body, null, 2));
  console.log("");
  console.log("   FALLBACK: verify manually.");
  console.log(`     1. Open https://polymarket.com (with the wallet whose key is in .env)`);
  console.log(`     2. Top-right: does it show ${FUNDER}?`);
  console.log("       If yes -> ownership is correct, problem is something else");
  console.log("       If no  -> you logged in with the wrong MetaMask account");
  process.exit(0);
}

// owner() returns a 32-byte-padded address; last 20 bytes = address.
const ownerHex = "0x" + result.slice(-40);
const owner = ownerHex.toLowerCase();

console.log("");
console.log("Safe's owner() returned:", ownerHex);
console.log("");

if (owner === signerEoa) {
  console.log("✓ MATCH — your PRIVATE_KEY does own this Safe.");
  console.log("");
  console.log("  The 'Could not create api key' error is NOT a wallet mismatch.");
  console.log("  Likely remaining causes:");
  console.log("    • Account hasn't completed full trading setup on polymarket.com");
  console.log("      (deposited USDC AND clicked through approval transactions)");
  console.log("    • Polymarket has a stale API key cached at nonce 0 — try nonce 1");
  console.log("    • Account-level flag (rare; would need to contact Polymarket support)");
} else {
  console.log("❌ MISMATCH — your PRIVATE_KEY does NOT own this Safe.");
  console.log("");
  console.log(`   Signer EOA:    ${account.address}`);
  console.log(`   Safe's owner:  ${ownerHex}`);
  console.log("");
  console.log("   You onboarded on polymarket.com with a different MetaMask account.");
  console.log("");
  console.log("   FIX (one of these):");
  console.log("     A. Switch MetaMask to the account that owns this Safe,");
  console.log("        export THAT account's private key, replace PRIVATE_KEY in .env.");
  console.log("");
  console.log("     B. OR change FUNDER_ADDRESS to whatever address polymarket.com");
  console.log(`        shows in the top-right when you log in with EOA ${account.address}.`);
}
