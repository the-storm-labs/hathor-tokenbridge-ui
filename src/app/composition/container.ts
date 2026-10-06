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
import { createPublicClient, createWalletClient, http } from 'viem'
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
  /**
   * The same AllowTokens contract over the plain RPC rather than the wallet:
   * the HTR→ARB form has to check limits with no EVM wallet connected.
   */
  readonly rpcAllowTokens: ViemAllowTokensAdapter
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
  // VITE_DASHBOARD_URL points the history's "Track" links at another dashboard (local, staging).
  const dashboardOverride = import.meta.env['VITE_DASHBOARD_URL']
  const route: BridgeRoute = dashboardOverride
    ? { ...ROUTES[deployment], dashboardUrl: dashboardOverride }
    : ROUTES[deployment]

  let clients: EvmClients | null = null
  const getClients = () => clients

  // The one reader of VITE_EVM_HOST_*: a plain RPC, not the connected wallet's
  // provider, for the HTR→ARB reads that have to work with no EVM wallet
  // connected at all — the EIP-7702 check and the transfer limits.
  const rpcTransport = http(evmHostFor(deployment))
  // Only `reader` is ever used; the writer exists because the adapters take the
  // pair, and with no account it cannot sign anything.
  const rpcClients: EvmClients = {
    reader: createPublicClient({ transport: rpcTransport }),
    writer: createWalletClient({ transport: rpcTransport }),
  }

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
    bridgeApi: new HttpBridgeApiAdapter(bridgeApiUrlFor(deployment)),

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
    // See eip7702-delegation.adapter for why this reads over the plain RPC.
    eip7702: new ViemEip7702Adapter(rpcClients.reader),

    erc20: new ViemErc20Adapter(getClients),
    bridge: new ViemBridgeAdapter(getClients, route.evm.bridge),
    allowTokens: new ViemAllowTokensAdapter(getClients, route.evm.allowTokens),
    rpcAllowTokens: new ViemAllowTokensAdapter(() => rpcClients, route.evm.allowTokens),
    federation: new ViemFederationAdapter(getClients, route.evm.federation),
  }
}

/**
 * `testnet-arb` has its own Read API: the one in `VITE_BRIDGE_API_URL` indexes
 * a different Bridge and Federation, so its records would never match this
 * deployment's. Empty means none — the history then shows only what this
 * browser sent, as it did before.
 */
function bridgeApiUrlFor(deployment: Deployment): string {
  const env = import.meta.env
  return deployment === 'testnet-arb'
    ? (env['VITE_BRIDGE_API_URL_TESTNET_ARB'] ?? '')
    : (env['VITE_BRIDGE_API_URL'] ?? '')
}

/**
 * The public Arbitrum Sepolia RPC, used when `VITE_EVM_HOST_TESTNET_ARB` is
 * unset. The rollup's own `sepolia-rollup.arbitrum.io` does not answer
 * `eth_syncing`; this one does, and needs no key.
 */
const ARBITRUM_SEPOLIA_PUBLIC_RPC = 'https://arbitrum-sepolia-rpc.publicnode.com'

/**
 * One variable per deployment: the two testnets bridge different EVM chains, so
 * pointing `VITE_EVM_HOST_TESTNET` at Arbitrum Sepolia would break the Sepolia
 * page's check.
 */
function evmHostFor(deployment: Deployment): string {
  const env = import.meta.env
  switch (deployment) {
    case 'mainnet':
      return env['VITE_EVM_HOST_MAINNET'] ?? ''
    case 'testnet':
      return env['VITE_EVM_HOST_TESTNET'] ?? ''
    case 'testnet-arb':
      return env['VITE_EVM_HOST_TESTNET_ARB'] || ARBITRUM_SEPOLIA_PUBLIC_RPC
  }
}
