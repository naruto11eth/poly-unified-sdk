// Public entry point. Keep this surface deliberate.
//
//   - PolymarketClient is the facade — Stripe-style resource namespace over
//     `client.markets`, `client.orders`, `client.positions`, plus `runWorkflow`.
//
//   - GammaClient, ClobAdapter, DataApiClient are escape-hatch sub-clients
//     for off-journey use (cancel, getOpenOrders, list events, etc.).
//
//   - Everything from errors.ts and types.ts is re-exported.

export { PolymarketClient } from "./client.js";
export { GammaClient } from "./clients/gamma.js";
export { ClobAdapter, validateFokOrderResponse, resolveOutcome } from "./clients/clob-adapter.js";
export { DataApiClient } from "./clients/data-api.js";

export * from "./errors.js";
export * from "./types.js";

// Pure helpers — exported for advanced callers who want to reproduce our math.
export { applySlippage, roundPriceToTick } from "./price.js";
export {
  extractMarketsPayload,
  filterMarkets,
  normalizeMarket,
  resolveSingleMarket,
} from "./normalize.js";
