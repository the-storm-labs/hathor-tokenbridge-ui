import type {
  DiscoveredWallet,
  EvmConnection,
  EvmWalletPort,
} from '../../ports/driven/evm-wallet.port'
import type { PreferencesPort } from '../../ports/driven/preferences.port'

/**
 * Connecting an injected EVM wallet, and reconnecting it on the next visit.
 *
 * The reconnect used to poll a mutable array every 100ms, up to ten times, and
 * give up silently — so a wallet that injected on the eleventh tick left the user
 * looking at a disconnected page for no stated reason. Discovery now resolves the
 * wait itself (see the EIP-6963 adapter), which is both faster and correct.
 */

export interface ConnectEvmWalletDeps {
  readonly wallet: EvmWalletPort
  readonly preferences: PreferencesPort
}

export interface ReconnectedWallet {
  readonly wallet: DiscoveredWallet
  readonly connection: EvmConnection
}

export function createConnectEvmWallet(deps: ConnectEvmWalletDeps) {
  /**
   * Connects the wallet with this rdns and remembers it for next time.
   *
   * @throws if the wallet is unavailable or the user rejects the request. The
   *         choice is *not* remembered in that case.
   */
  return async function connectEvmWallet(rdns: string): Promise<EvmConnection> {
    const connection = await deps.wallet.connect(rdns)
    deps.preferences.setLastConnectedWallet(rdns)

    return connection
  }
}

export function createReconnectEvmWallet(deps: ConnectEvmWalletDeps) {
  /**
   * Reconnects the wallet used last, if it is still installed.
   *
   * @returns null when there is nothing to reconnect to — no stored choice, the
   *          wallet is gone, or it refused. Never throws: an auto-reconnect that
   *          breaks page load is worse than one that does not happen.
   */
  return async function reconnectEvmWallet(): Promise<ReconnectedWallet | null> {
    const remembered = deps.preferences.getLastConnectedWallet()
    if (!remembered) return null

    const available = await deps.wallet.waitForWallets()
    const wallet = matchRemembered(available, remembered)
    if (!wallet) return null

    try {
      const connection = await deps.wallet.connect(wallet.rdns)
      // Rewrites the preference as an rdns, migrating a name stored by an
      // earlier build.
      deps.preferences.setLastConnectedWallet(wallet.rdns)

      return { wallet, connection }
    } catch (error) {
      console.warn('Could not reconnect the last used wallet', error)
      return null
    }
  }
}

/**
 * Earlier builds stored the wallet's display name ("MetaMask"), not its rdns.
 * Matching on either keeps returning users connected across this change; the
 * preference is rewritten as an rdns on success.
 */
function matchRemembered(
  available: readonly DiscoveredWallet[],
  remembered: string,
): DiscoveredWallet | null {
  return (
    available.find((candidate) => candidate.rdns === remembered) ??
    available.find((candidate) => candidate.name === remembered) ??
    null
  )
}

export function createForgetEvmWallet(deps: Pick<ConnectEvmWalletDeps, 'preferences'>) {
  /** Stops the automatic reconnect: called on disconnect and on connection loss. */
  return function forgetEvmWallet(): void {
    deps.preferences.clearLastConnectedWallet()
  }
}
