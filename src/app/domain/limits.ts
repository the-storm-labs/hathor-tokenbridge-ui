import type BigNumber from 'bignumber.js'

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

  // The messages quote the limit net of fee, and use plain float arithmetic so
  // the rendered number matches the original character for character.
  if (totalCost.isLessThan(limits.min)) {
    return {
      kind: 'below-minimum',
      message: `Minimum amount ${limits.min - limits.min * limits.feeRate} token`,
    }
  }

  if (totalCost.isGreaterThan(limits.max)) {
    return {
      kind: 'above-maximum',
      message: `Max amount ${limits.max - limits.max * limits.feeRate} tokens`,
    }
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
      return rejection.message
  }
}
