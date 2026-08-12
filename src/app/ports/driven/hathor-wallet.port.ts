import type { Deployment } from '../../domain/model/deployment'

/** Balance of one token, in that token's base units. */
export interface TokenBalance {
  readonly available: number
  readonly locked: number
}

export interface HathorSession {
  readonly address: string | null
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
  /** Reattach to a persisted WalletConnect session, or null if there is none. */
  restore(deployment: Deployment): Promise<HathorSession | null>

  /**
   * Balance of a single token. Does not require an active session — it reads the
   * full node directly, so it still works while the wallet is reconnecting.
   */
  getBalance(tokenUid: string, deployment: Deployment): Promise<TokenBalance>

  /** @returns the Hathor transaction id of the submitted transfer. */
  sendBridgeTransfer(
    params: SendBridgeTransferParams,
    deployment: Deployment,
  ): Promise<{ hash: string }>

  getAddress(): string | null
  isConnected(): boolean
}
