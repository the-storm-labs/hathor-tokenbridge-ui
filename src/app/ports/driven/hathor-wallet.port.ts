import type { Deployment } from '../../domain/model/deployment'

/** Balance of one token, in that token's base units. */
export interface TokenBalance {
  readonly available: number
  readonly locked: number
}

export interface HathorSession {
  readonly address: string | null
  /**
   * Set when a stored session was found but had already run out.
   *
   * It is the difference between "you were never connected" and "you were, and
   * you are not any more" — only the second one is worth telling the user about.
   */
  readonly expired?: boolean
}

/**
 * The user declined the request in their Hathor wallet.
 *
 * Its own type, distinct from a plain `Error`: this is the user's own choice,
 * not something that went wrong — the form renders it as a notice, not a
 * failure. See HathorTransferForm.
 */
export class UserRejectedError extends Error {
  constructor() {
    super('User rejected.')
    this.name = 'UserRejectedError'
  }
}

export interface SendBridgeTransferParams {
  /** Hathor deposit address of the bridge. */
  readonly bridgeAddress: string
  /** Token UID (64-char hex), or `'00'` for native HTR. */
  readonly tokenUid: string
  /** Amount in the token's base units, as a canonical integer string. */
  readonly amountUnits: string
  /** EVM destination, encoded into a data output for the bridge to read. */
  readonly evmDestination: string
}

export interface HathorWalletPort {
  connect(deployment: Deployment): Promise<HathorSession>
  disconnect(): Promise<void>
  /**
   * Reattach to a persisted WalletConnect session.
   *
   * @returns the session, `{ address: null, expired: true }` when there was one
   *          and it had run out, or null when there was never one to reattach to.
   */
  restore(deployment: Deployment): Promise<HathorSession | null>

  /**
   * Called when a live session ends without anyone asking: it reaches its
   * expiry, the wallet deletes it, or the provider drops the connection.
   *
   * A WalletConnect session lives seven days and nothing renews it on its own,
   * so this is not an edge case — it is what happens to every wallet left
   * connected over a week.
   */
  onSessionLost(listener: () => void): void

  /**
   * Balance of a single token. Does not require an active session — it reads the
   * full node directly, so it still works while the wallet is reconnecting.
   */
  getBalance(tokenUid: string, deployment: Deployment): Promise<TokenBalance>

  /**
   * @returns the Hathor transaction id of the submitted transfer.
   * @throws {UserRejectedError} if the user declines it in their wallet.
   */
  sendBridgeTransfer(
    params: SendBridgeTransferParams,
    deployment: Deployment,
  ): Promise<{ hash: string }>

  getAddress(): string | null
  isConnected(): boolean
}
