import type { ClaimRequest } from '../../ports/driven/contracts.port'

/**
 * A bridge transfer as the app understands it, after the API record has been
 * reconciled with whatever we know locally.
 *
 * The amount is kept **raw**, with the scale it arrived at, and formatted only
 * when rendered. Storing a formatted string is what made a display change
 * require a data migration: a claimed transfer is never rewritten, so old rows
 * kept whatever precision the build that wrote them happened to use.
 */
export interface BridgeTransfer {
  /** The bridge's own id. Absent on a record we wrote locally at send time. */
  readonly transactionId: string | null
  /** EVM-side transaction hash. */
  readonly transactionHash: string | null
  /** Legacy alias of transactionHash; stored records are matched on it. */
  readonly backendTxHash: string | null
  /** Hathor tx id, bare hex — recovered even when the API omits it. */
  readonly hathorTxId: string | null
  /** Whichever hash the row should link to. */
  readonly displayedTxHash: string | null

  readonly tokenSymbol: string
  /** Decimals the token uses on Hathor — the display precision for this row. */
  readonly tokenDecimals: number

  /** Raw integer string, exactly as received. Never a formatted value. */
  readonly amount: string
  /**
   * The scale `amount` is expressed in; varies by stage.
   *
   * `null` means the value is **already formatted** — records written by earlier
   * builds stored a display string, and a claimed transfer is never rewritten,
   * so those rows persist. The row template handles both.
   */
  readonly amountDecimals: number | null

  /** Hathor sender when known, else whatever the API reported. */
  readonly sender: string | null

  readonly status: string | null
  readonly votes: number
  readonly signatures: number
  readonly blockNumber: number | null
  /**
   * When the transfer was made, ISO: the moment this browser sent it, or else
   * the API's chain time — its first federation event, a little after the
   * Hathor deposit.
   */
  readonly sentAt: string | null

  /**
   * Everything needed to claim, as a typed object.
   *
   * `null` unless the transfer is claimable. Carrying it here is what lets the
   * UI stop round-tripping claim parameters through `data-*` attributes and
   * re-parsing amounts out of strings.
   */
  readonly claim: ClaimRequest | null
}
