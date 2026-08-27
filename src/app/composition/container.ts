import { resolveDeployment } from '../config/env'
import { ROUTES } from '../config/networks'
import type { Deployment } from '../domain/model/deployment'
import type { BridgeRoute } from '../domain/model/network'
import { createStore, type Store } from '../application/state/store'
import { initialAppState, type AppState } from '../application/state/app-state'

import { HttpBridgeApiAdapter } from '../adapters/driven/bridge-api/http-bridge-api.adapter'
import { HathorNodeBalanceAdapter } from '../adapters/driven/hathor/node-balance.adapter'
import { HathorWalletConnectAdapter } from '../adapters/driven/hathor/walletconnect.adapter'
import { LocalPreferencesAdapter } from '../adapters/driven/storage/local-preferences.adapter'
import { LocalTransferHistoryAdapter } from '../adapters/driven/storage/local-transfer-history.adapter'
import { WindowSchedulerAdapter } from '../adapters/driven/scheduler/window-scheduler.adapter'
import { ViemChainAdapter } from '../adapters/driven/evm/chain.adapter'
import { Eip6963WalletAdapter } from '../adapters/driven/evm/eip6963-wallet.adapter'
import { ViemEip7702Adapter } from '../adapters/driven/evm/eip7702-delegation.adapter'
import { createEvmClients, type EvmClients } from '../adapters/driven/evm/clients'
import { createPublicClient, http } from 'viem'
import type { Eip1193Provider } from '../ports/driven/evm-wallet.port'
import {
  ViemAllowTokensAdapter,
  ViemBridgeAdapter,
  ViemErc20Adapter,
  ViemFederationAdapter,
} from '../adapters/driven/evm/contracts.adapter'

/**
 * Composition root: the one place that knows which adapter implements which
 * port. Everything else receives what it needs.
 *
 * Deliberately synchronous. ABIs are static imports, so nothing has to be
 * awaited before contracts can be built — the initialisation race that let a
 * contract be constructed with an undefined ABI is gone by construction.
 */

/** Reown project id, from cloud.reown.com. */
const REOWN_PROJECT_ID = '290d89689d2588c921b6ef184ae8ee55'

export interface Container {
  readonly deployment: Deployment
  readonly route: BridgeRoute
  /** The single source of mutable app state. */
  readonly store: Store<AppState>
  readonly bridgeApi: HttpBridgeApiAdapter
  readonly transferHistory: LocalTransferHistoryAdapter
  readonly preferences: LocalPreferencesAdapter
  readonly hathorWallet: HathorWalletConnectAdapter
  readonly evmWallet: Eip6963WalletAdapter
  readonly chain: ViemChainAdapter
  readonly eip7702: ViemEip7702Adapter
  readonly scheduler: WindowSchedulerAdapter
  readonly erc20: ViemErc20Adapter
  readonly bridge: ViemBridgeAdapter
  readonly allowTokens: ViemAllowTokensAdapter
  readonly federation: ViemFederationAdapter

  /**
   * Adopts the provider of a newly connected wallet, or `null` on disconnect.
   *
   * The clients live here rather than on `window`, which is where the legacy
   * script built its web3 instance and every adapter read it back from. They
   * are rebuilt on each wallet or network switch, so the adapters are handed a
   * getter and read them per call.
   */
  setProvider(provider: Eip1193Provider | null): void
}

export interface ContainerOptions {
  /** Reown's UniversalConnector, injected because it arrives via a global. */
  readonly universalConnector: { init(options: unknown): Promise<never> }
}

export function createContainer(options: ContainerOptions): Container {
  const deployment = resolveDeployment(window.location, window.document)
  const route = ROUTES[deployment]

  let clients: EvmClients | null = null
  const getClients = () => clients

  const store = createStore<AppState>(initialAppState())
  const scheduler = new WindowSchedulerAdapter()
  const preferences = new LocalPreferencesAdapter(window.localStorage)
  const transferHistory = new LocalTransferHistoryAdapter(window.localStorage)

  return {
    deployment,
    route,
    store,
    setProvider: (provider) => {
      clients = provider ? createEvmClients(provider) : null
    },
    scheduler,
    preferences,
    transferHistory,

    // Inlined by Vite at build time. It used to travel through a
    // `window.__ENV__` object filled by an inline script with `%VITE_*%`
    // placeholders, because the classic scripts could not see import.meta —
    // and a page served without a build then shipped the literal placeholder.
    bridgeApi: new HttpBridgeApiAdapter(import.meta.env['VITE_BRIDGE_API_URL'] ?? ''),

    hathorWallet: new HathorWalletConnectAdapter(
      options.universalConnector,
      {
        projectId: REOWN_PROJECT_ID,
        appUrl: window.location.origin,
        appIcon: `${window.location.origin}/assets/storm-labs-reduced-logo.png`,
      },
      preferences,
      new HathorNodeBalanceAdapter(),
    ),

    evmWallet: new Eip6963WalletAdapter(),
    chain: new ViemChainAdapter(getClients),
    // The one reader of VITE_EVM_HOST_MAINNET/TESTNET: a plain RPC, not the
    // connected wallet's provider, because the HTR→ARB EIP-7702 check has to
    // work with no EVM wallet connected at all. See eip7702-delegation.adapter.
    eip7702: new ViemEip7702Adapter(
      createPublicClient({
        transport: http(
          import.meta.env[
            deployment === 'testnet' ? 'VITE_EVM_HOST_TESTNET' : 'VITE_EVM_HOST_MAINNET'
          ] ?? '',
        ),
      }),
    ),

    erc20: new ViemErc20Adapter(getClients),
    bridge: new ViemBridgeAdapter(getClients, route.evm.bridge),
    allowTokens: new ViemAllowTokensAdapter(getClients, route.evm.allowTokens),
    federation: new ViemFederationAdapter(getClients, route.evm.federation),
  }
}
