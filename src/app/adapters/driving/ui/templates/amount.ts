import BigNumber from 'bignumber.js'

/**
 * Formats an amount for a history row, at the token's Hathor precision.
 *
 * Both directions of this bridge settle on Hathor, so every amount in the
 * history is capped by what Hathor can represent; showing more places implies a
 * resolution that does not exist.
 *
 * Two input shapes are accepted on purpose:
 *
 *  - a **raw** integer string plus the scale it is expressed in, which is what
 *    the mapper now produces;
 *  - an **already-formatted** decimal string, which is what records written by
 *    earlier builds contain. A claimed transfer is never rewritten, so those
 *    rows would otherwise keep whatever precision the build that wrote them used.
 *
 * @param amountDecimals scale of `amount`, or `null` for a legacy formatted value
 */
export function formatRowAmount(
  amount: string | null | undefined,
  amountDecimals: number | null,
  displayDecimals: number,
): string {
  // Values written by toFormat carry thousands separators, which BigNumber
  // cannot parse back — strip them before re-reading.
  const cleaned = String(amount ?? '').replace(/,/g, '')
  const parsed = new BigNumber(cleaned || 0)
  if (parsed.isNaN()) return String(amount ?? '')

  const scaled = amountDecimals === null ? parsed : parsed.shiftedBy(-amountDecimals)
  return scaled.toFormat(displayDecimals, BigNumber.ROUND_DOWN)
}
