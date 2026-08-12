/** An injected browser wallet, as announced over EIP-6963. */
export interface DiscoveredWallet {
  /** Reverse-DNS id, stable across sessions — the key for auto-reconnect. */
  readonly rdns: string
  readonly name: string
  readonly icon: string
}

export interface EvmConnection {
  readonly accounts: readonly string[]
  readonly chainId: number
  /** The EIP-1193 provider, for building a web3 instance. */
  readonly provider: unknown
}

export interface EvmWalletEvents {
  onChainChanged(handler: (chainId: string) => void): void
  onAccountsChanged(handler: (accounts: string[]) => void): void
  onDisconnect(handler: () => void): void
}

export interface EvmWalletPort {
  /** Wallets announced so far. Discovery is asynchronous; see waitForWallets. */
  discovered(): readonly DiscoveredWallet[]

  /**
   * Resolves once at least one wallet has announced itself, or after the
   * timeout. Replaces polling every 100ms ten times.
   */
  waitForWallets(timeoutMs?: number): Promise<readonly DiscoveredWallet[]>

  connect(rdns: string): Promise<EvmConnection>

  /** Subscribes to provider events for the connected wallet. */
  events(rdns: string): EvmWalletEvents | null
}
