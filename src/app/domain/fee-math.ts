import BigNumber from 'bignumber.js'

/**
 * Bridge fee arithmetic.
 *
 * The same two lines were written three times in index.js (checkAllowance,
 * isAmountOk, and inverted inside getMaxBalance). The fee is charged *on top of*
 * the amount the user wants to receive, so the total is `amount / (1 - rate)`,
 * not `amount * (1 + rate)`.
 */

export interface TransferQuote {
  /** What the user typed — the amount they want to arrive on the other side. */
  readonly amount: BigNumber
  /** Amount plus the bridge fee: what actually leaves the wallet. */
  readonly totalCost: BigNumber
  /** The fee portion of `totalCost`. */
  readonly serviceFee: BigNumber
}

/**
 * @param amount   Amount to transfer. A blank input is treated as 0, matching
 *                 `new BigNumber(amount || 0)` in the original.
 * @param feeRate  Fractional rate (0.002 = 0.2%), i.e. the global `fee`.
 */
export function quote(amount: string | BigNumber, feeRate: number): TransferQuote {
  const parsedAmount = BigNumber.isBigNumber(amount)
    ? amount
    : new BigNumber(amount || 0)

  // The `feeRate === 0` short-circuit is preserved: dividing by (1 - 0) would
  // give the same value, but keeping it avoids introducing any division at all
  // on the overwhelmingly common zero-fee path.
  const totalCost = feeRate === 0 ? parsedAmount : parsedAmount.dividedBy(1 - feeRate)
  const serviceFee = totalCost.times(feeRate)

  return { amount: parsedAmount, totalCost, serviceFee }
}

/**
 * Format a quoted value for the fee / total-cost fields.
 *
 * `toFormat` (not `toFixed`) — it applies BigNumber's group separator, so
 * `1234.5` renders as `1,234.500000`. This reproduces the current display
 * exactly; switching to `toFixed` would silently drop the thousands separator.
 */
export function formatQuoteValue(value: BigNumber): string {
  return value.toFormat(DISPLAY_DECIMALS, BigNumber.ROUND_DOWN)
}

const DISPLAY_DECIMALS = 6

/**
 * Largest amount transferable given a balance and the bridge's own withdraw cap.
 *
 * Mirrors getMaxBalance: take the lower of balance and cap, then subtract the
 * fee computed on that value, then truncate at the token's decimals.
 *
 * Note this applies the fee as `max * rate` rather than the inverse formula used
 * by {@link quote}. That asymmetry is in the original and is preserved here
 * deliberately — changing it would change the number shown by the Max button.
 */
export function maxTransferable(
  balance: BigNumber,
  maxWithdraw: BigNumber,
  feeRate: number,
  decimals: number,
): string {
  const maxValue = balance.isGreaterThan(maxWithdraw) ? maxWithdraw : balance
  const serviceFee = maxValue.times(feeRate)

  return maxValue.minus(serviceFee).toFixed(decimals, BigNumber.ROUND_DOWN)
}
