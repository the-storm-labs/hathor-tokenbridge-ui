import BigNumber from 'bignumber.js'

/**
 * Validation of a transfer amount against the bridge's configured limits.
 *
 * Extracted from isAmountOk, which used throw/catch for control flow. Here the
 * result is a value, so the UI decides how to present it.
 */

export type AmountRejection =
  | { readonly kind: 'empty' }
  | { readonly kind: 'not-positive' }
  | { readonly kind: 'below-minimum'; readonly message: string }
  | { readonly kind: 'above-maximum'; readonly message: string }
  /** The limits at hand are not the selected token's, so nothing can be checked. */
  | { readonly kind: 'limits-unknown'; readonly message: string }

export interface TransferLimits {
  readonly min: number
  readonly max: number
  readonly feeRate: number
}

/**
 * @param rawAmount The literal input value, so `''` can be distinguished from 0.
 * @param totalCost Amount plus fee, from `quote()`. Limits apply to the total,
 *                  not to the amount the user typed — as in the original.
 * @returns `null` when the amount is acceptable.
 */
export function validateAmount(
  rawAmount: string,
  totalCost: BigNumber,
  limits: TransferLimits,
): AmountRejection | null {
  if (rawAmount === '') return { kind: 'empty' }
  if (totalCost.isLessThanOrEqualTo(0)) return { kind: 'not-positive' }

  // The messages quote the limit as the contract holds it — gross, fee
  // included — the same number the info panel and the HTR→ARB form show. The
  // net figure (4.99 for a 5 minimum) only made the three disagree.
  const shown = (limit: number) => tokens(new BigNumber(limit))

  if (totalCost.isLessThan(limits.min)) {
    return { kind: 'below-minimum', message: `Minimum amount ${shown(limits.min)}` }
  }

  if (totalCost.isGreaterThan(limits.max)) {
    return { kind: 'above-maximum', message: `Max amount ${shown(limits.max)}` }
  }

  return null
}

/** Message shown for a rejection, matching the strings the original produced. */
export function rejectionMessage(rejection: AmountRejection): string {
  switch (rejection.kind) {
    case 'empty':
      return 'Invalid amount'
    case 'not-positive':
      return 'Must be bigger than 0'
    case 'below-minimum':
    case 'above-maximum':
    case 'limits-unknown':
      return rejection.message
  }
}

/** AllowTokens limits as the contract reports them: 18-decimal wei strings. */
export interface WeiLimits {
  readonly min: string
  readonly max: string
}

/** The scale AllowTokens keeps every limit in, whatever the token's own precision. */
const LIMIT_DECIMALS = 18

/**
 * Checks a transfer amount against the token's per-transaction limits, exactly.
 *
 * The bridge contract checks ARB→HTR the same way (gross amount, before fees,
 * scaled to 18 decimals), so this rejects nothing it would have accepted.
 *
 * ## HTR→ARB
 *
 * Nothing on the deposit path enforces these: the Hathor deposit address takes
 * whatever is sent, and the federator only drops a deposit below the minimum —
 * silently, leaving the funds in the multisig — and does not look at the
 * maximum at all. So this check is the only thing between the user and a
 * deposit the bridge will not release.
 *
 * Compared the way the federator does it: the gross amount sent on Hathor,
 * scaled to 18 decimals, against the raw limits. No fee is taken first, and
 * no float or `parseInt` rounding gets in the way — the comparison is exact.
 *
 * @param amount whole tokens, as typed.
 * @returns `null` when the amount is acceptable.
 */
export function checkTransferLimits(amount: string, limits: WeiLimits): AmountRejection | null {
  const scaled = new BigNumber(amount).shiftedBy(LIMIT_DECIMALS)
  const shown = (wei: string) => tokens(new BigNumber(wei).shiftedBy(-LIMIT_DECIMALS))

  if (scaled.isLessThan(limits.min)) {
    return { kind: 'below-minimum', message: `Minimum amount ${shown(limits.min)}` }
  }

  if (scaled.isGreaterThan(limits.max)) {
    return { kind: 'above-maximum', message: `Max amount ${shown(limits.max)}` }
  }

  return null
}

/** `2,500 tokens`, `1 token`. */
function tokens(amount: BigNumber): string {
  return `${amount.toFormat()} ${amount.isEqualTo(1) ? 'token' : 'tokens'}`
}
