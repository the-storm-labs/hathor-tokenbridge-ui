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
import { Web3ChainAdapter } from '../adapters/driven/evm/web3-chain.adapter'
import { Eip6963WalletAdapter } from '../adapters/driven/evm/eip6963-wallet.adapter'
import {
  Web3AllowTokensAdapter,
  Web3BridgeAdapter,
  Web3Erc20Adapter,
  Web3FederationAdapter,
} from '../adapters/driven/evm/web3-contracts.adapter'

/**
 * Composition root: the one place that knows which adapter implements which
 * port. Everything else receives what it needs.
 *
 * Deliberately synchronous. ABIs are static imports, so nothing has to be
 * awaited before contracts can be built — the initialisation race that let
 * `new web3.eth.Contract(BRIDGE_ABI, …)` run with an undefined ABI is gone by
 * construction.
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
  readonly chain: Web3ChainAdapter
  readonly scheduler: WindowSchedulerAdapter
  readonly erc20: Web3Erc20Adapter
  readonly bridge: Web3BridgeAdapter
  readonly allowTokens: Web3AllowTokensAdapter
  readonly federation: Web3FederationAdapter

  /**
   * Adopts the provider of a newly connected wallet, or `null` on disconnect.
   *
   * The web3 instance lives here rather than on `window`, which is where the
   * legacy script built it and every adapter read it back from. It is replaced
   * on each wallet or network switch, so the adapters are handed a getter and
   * read it per call.
   */
  setProvider(provider: unknown | null): void
}

export interface ContainerOptions {
  /** Reown's UniversalConnector, injected because it arrives via a global. */
  readonly universalConnector: { init(options: unknown): Promise<never> }
}

export function createContainer(options: ContainerOptions): Container {
  const deployment = resolveDeployment(window.location, window.document)
  const route = ROUTES[deployment]

  let web3: Web3Instance | null = null
  const getWeb3 = () => web3

  const store = createStore<AppState>(initialAppState())
  const scheduler = new WindowSchedulerAdapter()
  const preferences = new LocalPreferencesAdapter(window.localStorage)
  const transferHistory = new LocalTransferHistoryAdapter(window.localStorage)

  return {
    deployment,
    route,
    store,
    setProvider: (provider) => {
      web3 = provider ? new Web3(provider) : null
    },
    scheduler,
    preferences,
    transferHistory,

    bridgeApi: new HttpBridgeApiAdapter(window.__ENV__?.bridgeApiUrl ?? ''),

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
    chain: new Web3ChainAdapter(getWeb3, scheduler),

    erc20: new Web3Erc20Adapter(getWeb3),
    bridge: new Web3BridgeAdapter(getWeb3, route.evm.bridge),
    allowTokens: new Web3AllowTokensAdapter(getWeb3, route.evm.allowTokens),
    federation: new Web3FederationAdapter(getWeb3, route.evm.federation),
  }
}
