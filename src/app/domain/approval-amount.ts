import BigNumber from 'bignumber.js'

/**
 * The integer amounts the two EVM write paths actually submit.
 *
 * Distinct from fee-math.ts, which quotes *display* values in whole tokens for
 * the fee and total-cost fields. This is base-unit integer arithmetic on the
 * money path: what goes into `approve()` and `receiveTokensTo()`.
 *
 * The rule is the same one fee-math states — the fee is charged on top of the
 * amount, so the contract must move `amount / (1 - rate)` — but expressed with
 * the contract's own basis: `amount * divider / (divider - feePercentage)`.
 * Keeping it in that form is deliberate: it uses the two values read straight
 * from the bridge contract, with no float ever entering the calculation.
 *
 * All division truncates, matching web3's BN. Truncating is the safe direction
 * here: it can only ever approve or send a hair less than the exact quotient.
 */

/** The bridge's fee, as the contract reports it. */
export interface FeeBasis {
  /** Fee numerator, e.g. 20. */
  readonly feePercentage: number
  /** Fee denominator, e.g. 10000 — so 20/10000 is 0.2%. */
  readonly feePercentageDivider: number
}

/**
 * Grosses an amount up so that, after the bridge takes its fee, the requested
 * amount arrives on the other side.
 *
 * @param amountUnits Amount in the token's base units, as produced by
 *                    {@link toBaseUnits} — leading zeros allowed ('050').
 * @returns Canonical integer string.
 */
export function grossUpForFee(amountUnits: string, fee: FeeBasis): string {
  const divider = new BigNumber(fee.feePercentageDivider)
  const net = divider.minus(fee.feePercentage)

  // A fee of 100% or more would make the gross-up infinite or negative. The
  // contract cannot be configured that way, but reading it as a number from a
  // chain call means the app should not silently submit the result if it ever is.
  if (net.isLessThanOrEqualTo(0)) {
    throw new Error(`Invalid bridge fee: ${fee.feePercentage}/${fee.feePercentageDivider}`)
  }

  return integer(new BigNumber(amountUnits).times(divider).dividedToIntegerBy(net))
}

/**
 * `Number.MAX_SAFE_INTEGER` in wei, the value the "don't ask again" checkbox
 * approves.
 *
 * A literal, not a computation: it is exactly what
 * `web3.utils.toWei(Number.MAX_SAFE_INTEGER.toString(), 'ether')` returned, and
 * writing it out keeps the approval independent of a web3 helper — and visible
 * for review, since an unlimited approval is a real grant to the bridge.
 */
export const UNLIMITED_APPROVAL_UNITS = '9007199254740991000000000000000000'

/** Extra approval headroom, as a percentage of the grossed-up amount. */
const HEADROOM_NUMERATOR = 101
const HEADROOM_DENOMINATOR = 100

/**
 * The value to pass to `approve()`.
 *
 * The 1% headroom is in the original and is preserved: the allowance is checked
 * against a total cost recomputed at transfer time, and a fee that moved between
 * approving and crossing would otherwise leave the transfer to fail at the
 * contract with the approval already spent on gas.
 *
 * Note the headroom applies to the unlimited value too, exactly as before —
 * `MAX_SAFE_INTEGER * 1.01` wei, which is still an effectively unbounded
 * allowance.
 */
export function approvalAmount(
  amountUnits: string,
  fee: FeeBasis,
  options: { readonly unlimited: boolean },
): string {
  const base = options.unlimited ? UNLIMITED_APPROVAL_UNITS : grossUpForFee(amountUnits, fee)

  return integer(
    new BigNumber(base).times(HEADROOM_NUMERATOR).dividedToIntegerBy(HEADROOM_DENOMINATOR),
  )
}

/**
 * `toFixed(0)` rather than `toString()`: BigNumber switches to exponential
 * notation above 1e21, and these values are routinely larger than that. A
 * contract call handed '9.1e+33' reverts, or worse, is coerced.
 */
function integer(value: BigNumber): string {
  return value.toFixed(0)
}
