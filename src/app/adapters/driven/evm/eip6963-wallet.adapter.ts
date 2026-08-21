import type {
  DiscoveredWallet,
  EvmConnection,
  EvmWalletEvents,
  EvmWalletPort,
} from '../../../ports/driven/evm-wallet.port'

/**
 * Wallet discovery and connection over EIP-6963.
 *
 * Wallets announce themselves in response to a request event, so discovery is
 * inherently asynchronous. The original waited by polling an array every 100ms,
 * ten times, and gave up silently; here the announcement itself resolves the
 * wait, which is both faster and correct when a wallet is slow to inject.
 */

interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, handler: (...args: never[]) => void): void
}

interface AnnouncedProvider {
  readonly info: { rdns: string; name: string; icon: string }
  readonly provider: Eip1193Provider
}

export class Eip6963WalletAdapter implements EvmWalletPort {
  private readonly wallets = new Map<string, AnnouncedProvider>()
  private readonly waiters = new Set<() => void>()

  constructor(private readonly target: Window = window) {
    this.target.addEventListener('eip6963:announceProvider', (event) => {
      const detail = (event as CustomEvent<AnnouncedProvider>).detail
      if (!detail?.info?.rdns) return

      this.wallets.set(detail.info.rdns, detail)
      // Copied before iterating: a waiter resolves and removes itself.
      // oxlint-disable-next-line no-useless-spread -- the copy is the point
      for (const notify of [...this.waiters]) notify()
    })

    this.target.dispatchEvent(new Event('eip6963:requestProvider'))
  }

  discovered(): readonly DiscoveredWallet[] {
    return [...this.wallets.values()].map((w) => ({ ...w.info }))
  }

  waitForWallets(timeoutMs = 1_000): Promise<readonly DiscoveredWallet[]> {
    if (this.wallets.size > 0) return Promise.resolve(this.discovered())

    return new Promise((resolve) => {
      const finish = () => {
        this.waiters.delete(finish)
        clearTimeout(timer)
        resolve(this.discovered())
      }
      const timer = setTimeout(finish, timeoutMs)
      this.waiters.add(finish)
    })
  }

  async connect(rdns: string): Promise<EvmConnection> {
    const wallet = this.wallets.get(rdns)
    if (!wallet) throw new Error(`Wallet ${rdns} is not available`)

    const accounts = (await wallet.provider.request({
      method: 'eth_requestAccounts',
    })) as string[]

    const chainId = (await wallet.provider.request({ method: 'eth_chainId' })) as string

    return { accounts, chainId: Number(chainId), provider: wallet.provider }
  }

  events(rdns: string): EvmWalletEvents | null {
    const provider = this.wallets.get(rdns)?.provider
    if (!provider?.on) return null

    return {
      onChainChanged: (handler) =>
        provider.on!('chainChanged', handler as (...args: never[]) => void),
      onAccountsChanged: (handler) =>
        provider.on!('accountsChanged', handler as (...args: never[]) => void),
      onDisconnect: (handler) => provider.on!('disconnect', handler as (...args: never[]) => void),
    }
  }
}
