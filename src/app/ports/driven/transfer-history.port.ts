/**
 * Locally persisted transfer history.
 *
 * This is a cache in front of the Read API, not a source of truth — except for
 * two things the API structurally cannot know and that must never be lost:
 * the Hathor tx id and the Hathor sender address.
 */

/**
 * A stored transfer record.
 *
 * Deliberately loose: records written by earlier builds are still in users'
 * browsers and carry fields this shape does not name. The adapter must preserve
 * unknown fields rather than normalise them away.
 */
export interface StoredTransfer {
  /** The bridge's own id. Present only on records that came from the Read API. */
  readonly transactionId?: string | null
  /** EVM-side transaction hash. */
  readonly transactionHash?: string | null
  /** Legacy alias of transactionHash, kept because stored records match on it. */
  readonly backendTxHash?: string | null
  /** Hathor tx id, bare hex. The API only reports it on some records. */
  readonly hathorTxId?: string | null
  readonly displayedTxHash?: string | null
  readonly sender?: string | null
  readonly token?: string | null
  readonly amount?: string | null
  readonly status?: string | null
  readonly votes?: number | null
  readonly signatures?: number | null
  readonly blockNumber?: number | null
  readonly [key: string]: unknown
}

export interface TransferHistoryPort {
  /**
   * Records for an address on a network, newest block first.
   * Records with no block number sort first — they are the freshly submitted ones.
   */
  list(accountAddress: string, networkName: string): StoredTransfer[]

  /** Append an EVM-origin transfer. No de-duplication: each send is distinct. */
  addEvmTransfer(accountAddress: string, networkName: string, transfer: StoredTransfer): void

  /**
   * Insert or update a Hathor-origin transfer, collapsing every stored copy of
   * the same transfer into one.
   */
  upsertHathorTransfer(accountAddress: string, networkName: string, transfer: StoredTransfer): void

  /** Whether persistence is usable at all. */
  isAvailable(): boolean
}
