/**
 * Pure price math.
 *
 * Two operations:
 *   - `applySlippage(price, side, bps)` — widens the price away from the caller's favor.
 *   - `roundPriceToTick(price, tickSize, side)` — BUY ceils (more conservative), SELL floors.
 *
 * INVARIANT: rounding never *improves* the worst-price relative to the slippage band.
 * BUY's rounded price is ≥ unrounded; SELL's is ≤ unrounded. Otherwise a naive round-to-nearest
 * could silently let the order go through at a price worse than the slippage cap implies.
 */

export function applySlippage(price: number, side: "BUY" | "SELL", bps: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(bps)) {
    throw new RangeError(`applySlippage: non-finite input (price=${price}, bps=${bps})`);
  }
  if (bps < 0) throw new RangeError(`applySlippage: negative bps (${bps})`);
  const factor = bps / 10_000;
  return side === "BUY" ? price * (1 + factor) : price * (1 - factor);
}

export function roundPriceToTick(
  price: number,
  tickSize: number,
  side: "BUY" | "SELL",
): number {
  if (!Number.isFinite(price) || !Number.isFinite(tickSize)) {
    throw new RangeError(
      `roundPriceToTick: non-finite input (price=${price}, tickSize=${tickSize})`,
    );
  }
  if (tickSize <= 0 || tickSize > 1) {
    throw new RangeError(`roundPriceToTick: tickSize out of range (${tickSize})`);
  }

  // Scale by 10^decimals(tickSize) to avoid accumulated FP error from price * (1/tickSize).
  const scale = tickScale(tickSize);
  const scaled = price * scale;
  const tickAtScale = tickSize * scale; // typically 1; we recompute defensively for non-power-of-10 ticks.

  let rounded: number;
  if (side === "BUY") {
    // Ceil to the next multiple of tickAtScale.
    rounded = Math.ceil(scaled / tickAtScale) * tickAtScale;
  } else {
    rounded = Math.floor(scaled / tickAtScale) * tickAtScale;
  }
  const result = rounded / scale;

  // Clamp to [tickSize, 1]. Polymarket prices are bounded probabilities.
  if (result < tickSize) return tickSize;
  if (result > 1) {
    // BUY ceiling could push above 1.0 — Polymarket caps at 1.0.
    // Snap to the largest tick-multiple ≤ 1.0.
    return Math.floor(scale / tickAtScale) * tickAtScale / scale;
  }
  return result;
}

/** Number of decimal places implied by a tick size, e.g. 0.01 → 2. */
function tickScale(tickSize: number): number {
  // tickSize is one of {0.1, 0.01, 0.001, 0.0001} per Polymarket but we
  // accept any positive ≤ 1 value defensively.
  const str = tickSize.toString();
  if (str.includes("e")) {
    // Handle scientific notation defensively.
    const exp = Number(str.split("e")[1] ?? "0");
    return 10 ** Math.abs(exp);
  }
  const decimals = str.includes(".") ? str.split(".")[1]?.length ?? 0 : 0;
  return 10 ** decimals;
}
