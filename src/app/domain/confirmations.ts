/**
 * Block-confirmation progress and the human ETA shown on each EVM transfer row.
 *
 * Extracted from the processTxn row template, where it was tangled with HTML
 * generation and read `currentBlockNumber` off a global.
 */

export interface ConfirmationInputs {
  /** Block the transaction landed in. */
  readonly transactionBlock: number
  /** Latest block seen by the poller. */
  readonly currentBlock: number
  /** Blocks required by this network's config. */
  readonly required: number
  /** Network block time; fractional on fast chains (Arbitrum is 0.25). */
  readonly secondsPerBlock: number
}

export interface ConfirmationProgress {
  readonly elapsedBlocks: number
  readonly remainingBlocks: number
  readonly confirmed: boolean
  /** `''` once confirmed, else e.g. `'| ~ 1hs  5mins'`. */
  readonly humanTimeRemaining: string
}

export function confirmationProgress(inputs: ConfirmationInputs): ConfirmationProgress {
  const { transactionBlock, currentBlock, required, secondsPerBlock } = inputs

  const elapsedBlocks = currentBlock - transactionBlock
  const remainingBlocks = required - elapsedBlocks
  const confirmed = elapsedBlocks >= required

  const secondsRemaining = remainingBlocks > 0 ? remainingBlocks * secondsPerBlock : 0

  const hours = Math.floor(secondsRemaining / 60 / 60)
  const hoursPart = hours > 0 ? `${hours}hs ` : ''
  const minutes = Math.ceil(secondsRemaining / 60) - hours * 60

  return {
    elapsedBlocks,
    remainingBlocks,
    confirmed,
    // The double space between the hours and minutes parts is in the original
    // template. Kept so the rendered row is unchanged.
    humanTimeRemaining: confirmed ? '' : `| ~ ${hoursPart} ${minutes}mins`,
  }
}
