/**
 * The bridge Read API (docs/bridge-api.yaml).
 *
 * Read-only and unauthenticated. Only `/transactions-by-receiver` is consumed:
 * it already carries vote counts and executed-event fields, which makes
 * `/voted-counts` and `/executed-events` redundant.
 */

export const TransferDirection = {
  HathorToEvm: 'hathor_to_evm',
  EvmToHathor: 'evm_to_hathor',
} as const
export type TransferDirection = (typeof TransferDirection)[keyof typeof TransferDirection]

export const TransferStatus = {
  HathorVoting: 'hathor_voting',
  EvmVoting: 'evm_voting',
  AwaitingClaim: 'awaiting_claim',
  Claimed: 'claimed',
} as const
export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus]

/**
 * A transfer as the API reports it.
 *
 * Three fields carry traps documented where they are consumed:
 *  - `amount` is always scaled to **18 decimals on the wire**, whatever the
 *    token's own decimals are (USDC is 6 on Arbitrum, 2 on Hathor).
 *  - `originTransactionHash` is the Hathor tx id **0x-prefixed**, and is null on
 *    records the Hathor federation did not report. When it is null the origin is
 *    identified by `blockHash`, which holds `keccak256(hathorTxId)`.
 *  - `status: 'awaiting_claim'` is **not authoritative** — a transfer already
 *    claimed on-chain still reports it, so it must be re-checked against the
 *    bridge contract before a Claim button is offered.
 */
export interface ApiTransfer {
  readonly transactionId: string | null
  readonly transactionHash: string | null
  /** Legacy alias of transactionHash, kept because stored records match on it. */
  readonly backendTxHash: string | null
  readonly originTransactionHash: string | null
  readonly originalTokenAddress: string | null
  /** May be the federation relayer's EVM address rather than the real sender. */
  readonly sender: string | null
  readonly receiver: string | null
  /** Raw integer string, 18-decimal scaled. Never parse it as a float. */
  readonly amount: string
  readonly votes: number
  readonly signatures: number
  readonly status: string | null
  readonly direction: string | null
  readonly hathorFederationStatus: string | null
  readonly blockNumber: number | null
  /** For Hathor-origin transfers this is `keccak256(hathorTxId)`, not a block. */
  readonly blockHash: string | null
  readonly logIndex: number | null
  readonly originChainId: number | null
  readonly destinationChainId: number | null
  readonly updatedAt: string | null
  /**
   * evm_to_hathor, `listBySender` only: the Hathor transaction went out. That
   * direction's `status` never moves past hathor_voting, so this is the only
   * sign of delivery. Null where the API does not report it.
   */
  readonly delivered: boolean | null
  /** The delivering Hathor tx id, bare hex, once delivered. */
  readonly deliveryTxId: string | null
}

export interface ListTransfersOptions {
  readonly limit?: number
  readonly direction?: TransferDirection
}

export interface BridgeApiPort {
  /** Transfers for an EVM receiver, newest first. Empty when unavailable. */
  listByReceiver(receiver: string, options?: ListTransfersOptions): Promise<ApiTransfer[]>
  /**
   * Transfers an EVM account sent, newest first: the ARB→HTR history, whose
   * receiver is a Hathor address. Empty when unavailable.
   */
  listBySender(sender: string, options?: ListTransfersOptions): Promise<ApiTransfer[]>
  /** Liveness probe. */
  ping(): Promise<boolean>
}
