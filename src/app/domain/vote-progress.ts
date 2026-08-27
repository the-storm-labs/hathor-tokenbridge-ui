/**
 * Federation approval progress for a Hathor→EVM transfer.
 *
 * A transfer is signed by the Hathor federation first and voted on the EVM side
 * afterwards, so the row shows whichever counter it is currently waiting on.
 */

export type ApprovalPhase = 'hathor-signatures' | 'evm-votes'

export interface ApprovalProgress {
  readonly phase: ApprovalPhase
  /** Approvals collected, clamped to `required`. */
  readonly count: number
  readonly required: number
  /** `'signature'` or `'vote'`, for the accessible label on each segment. */
  readonly label: string
  /** Tooltip describing which federation is being waited on. */
  readonly title: string
}

export interface ApprovalCounts {
  readonly signatures?: number | string | null
  readonly votes?: number | string | null
}

/**
 * @param isHathorPhase True while the transfer is still awaiting Hathor
 *                      federation signatures (API status `hathor_voting`).
 * @param required Federators required on this route — the same threshold for
 *                 both phases (see BridgeRoute.signaturesRequired). Mainnet
 *                 and testnet run federations of different sizes, so this
 *                 comes from the caller rather than a shared constant.
 */
export function approvalProgress(
  counts: ApprovalCounts,
  isHathorPhase: boolean,
  required: number,
): ApprovalProgress {
  const raw = isHathorPhase ? counts.signatures : counts.votes

  // `Number(x) || 0` in the original: null, undefined and NaN all become 0.
  const count = Math.min(Number(raw) || 0, required)

  return {
    phase: isHathorPhase ? 'hathor-signatures' : 'evm-votes',
    count,
    required,
    label: isHathorPhase ? 'signature' : 'vote',
    title: isHathorPhase ? 'Hathor federation signatures' : 'Arbitrum federation votes',
  }
}
