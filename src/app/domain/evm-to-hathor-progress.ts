import type { ConfirmationProgress } from './confirmations'

/**
 * Where an ARB→HTR transfer is, from the deposit to the tokens arriving on Hathor.
 *
 * The local record only knows the deposit and its block; everything after the
 * Arbitrum confirmations is the Hathor federation's, and comes from the Read API.
 * An evm_to_hathor transfer's API `status` never moves past `hathor_voting`, so
 * delivery is its own flag (a processed ProposalSent), not a status.
 */

/** What the Read API knows about one ARB→HTR transfer. */
export interface FederationProgress {
  readonly signatures: number
  /** Latest HathorFederation event: TransactionProposed, ProposalSigned, ProposalSent, TransactionFailed. */
  readonly hathorFederationStatus: string | null
  readonly delivered: boolean
  /** The delivering Hathor tx id, bare hex. */
  readonly deliveryTxId: string | null
}

export type EvmToHathorStage =
  /** Waiting for the Arbitrum blocks the federators require before acting. */
  | { readonly kind: 'confirming'; readonly humanTimeRemaining: string }
  /** Confirmed on Arbitrum; no federator has proposed the Hathor transaction yet. */
  | { readonly kind: 'awaiting-federation' }
  | { readonly kind: 'signing'; readonly signatures: number; readonly required: number }
  /** The Hathor push failed and waits for the federation owner to reset it. */
  | { readonly kind: 'delayed' }
  | { readonly kind: 'delivered'; readonly hathorTxId: string | null }

const FAILED = 'TransactionFailed'

/**
 * @param federation null when the API has nothing for this transfer yet — not
 *        indexed, or the API is unreachable. The row then falls back to what the
 *        local record can say on its own.
 * @param required Hathor federation signatures needed on this route.
 */
export function evmToHathorStage(
  confirmation: ConfirmationProgress,
  federation: FederationProgress | null,
  required: number,
): EvmToHathorStage {
  if (federation?.delivered) {
    return { kind: 'delivered', hathorTxId: federation.deliveryTxId }
  }
  if (federation?.hathorFederationStatus === FAILED) return { kind: 'delayed' }

  // Federation activity wins over the local block count: the poller's head can
  // lag, and a federator acting on the deposit is proof it is confirmed.
  if (federation?.hathorFederationStatus) {
    return {
      kind: 'signing',
      signatures: Math.min(federation.signatures, required),
      required,
    }
  }

  if (!confirmation.confirmed) {
    return { kind: 'confirming', humanTimeRemaining: confirmation.humanTimeRemaining }
  }
  return { kind: 'awaiting-federation' }
}
