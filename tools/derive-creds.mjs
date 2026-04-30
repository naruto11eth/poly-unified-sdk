// Derive (read) the EXISTING CLOB API credentials for this wallet.
//
// Why this matters:
//   - Polymarket's `/auth/api-key` endpoint CREATES a new key. If one already exists
//     for your wallet at the requested nonce, it returns "Could not create api key".
//   - `deriveApiKey()` READS the existing one without trying to create.
//
// If this script succeeds, paste the printed CLOB_* values into .env and re-run
// `npm run smoke`. The SDK will then skip credential derivation entirely.
//
// Run:  npm run diag:creds

import { ClobClient, Chain, SignatureTypeV2 } from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FUNDER = process.env.FUNDER_ADDRESS;

if (!PRIVATE_KEY || !FUNDER) {
  console.error("Missing PRIVATE_KEY or FUNDER_ADDRESS in .env");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const wallet = createWalletClient({
  account,
  chain: polygon,
  transport: http(),
});

const clob = new ClobClient({
  host: "https://clob.polymarket.com",
  chain: Chain.POLYGON,
  signer: wallet,
  signatureType: SignatureTypeV2.POLY_GNOSIS_SAFE,
  funderAddress: FUNDER,
  throwOnError: true,
});

console.log("=".repeat(60));
console.log("Signer EOA:    ", account.address);
console.log("Funder (Safe): ", FUNDER);
console.log("=".repeat(60));
console.log("");

// Try to DERIVE (read) the existing creds at default nonce 0.
try {
  console.log("Attempting deriveApiKey(0) (read existing)...");
  const creds = await clob.deriveApiKey(0);
  console.log("");
  console.log("✓ Found existing credentials at nonce 0:");
  console.log("");
  console.log("Add these to your .env (uncomment the CLOB_* lines first):");
  console.log("");
  console.log("  CLOB_API_KEY=" + creds.key);
  console.log("  CLOB_SECRET=" + creds.secret);
  console.log("  CLOB_PASSPHRASE=" + creds.passphrase);
  console.log("");
  console.log("Then re-run `npm run smoke` — it'll use these directly and skip create.");
  process.exit(0);
} catch (err) {
  const msg = err?.message ?? String(err);
  console.log("");
  console.log("✗ deriveApiKey failed:");
  console.log("  ", msg.slice(0, 200));
  console.log("");

  // Try createApiKey at a different nonce (1) — sometimes nonce 0 is in a weird state.
  console.log("Falling back to createApiKey(1) (try a different nonce)...");
  try {
    const creds = await clob.createApiKey(1);
    console.log("");
    console.log("✓ Created new credentials at nonce 1:");
    console.log("");
    console.log("Add these to your .env:");
    console.log("");
    console.log("  CLOB_API_KEY=" + creds.key);
    console.log("  CLOB_SECRET=" + creds.secret);
    console.log("  CLOB_PASSPHRASE=" + creds.passphrase);
    console.log("");
    console.log("Then re-run `npm run smoke`.");
    process.exit(0);
  } catch (err2) {
    const msg2 = err2?.message ?? String(err2);
    console.log("");
    console.log("✗ createApiKey(1) also failed:");
    console.log("  ", msg2.slice(0, 200));
    console.log("");
    console.log("This is unusual. Possibilities:");
    console.log("  • The signer EOA in your PRIVATE_KEY doesn't actually own the funder Safe");
    console.log("    (run check-owner.mjs to verify)");
    console.log("  • Polymarket has flagged this account");
    console.log("  • Some transient API issue — try again in a few minutes");
    process.exit(1);
  }
}
