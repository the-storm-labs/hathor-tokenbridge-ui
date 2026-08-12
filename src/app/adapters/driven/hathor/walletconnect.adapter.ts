import type { Deployment } from '../../../domain/model/deployment'
import type {
  HathorSession,
  HathorWalletPort,
  SendBridgeTransferParams,
  TokenBalance,
} from '../../../ports/driven/hathor-wallet.port'
import type { PreferencesPort } from '../../../ports/driven/preferences.port'
import { HathorNodeBalanceAdapter } from './node-balance.adapter'

/**
 * Hathor wallet over WalletConnect, via Reown's UniversalConnector.
 *
 * Ported from js/hathor-wallet.js. Two things that lived there deliberately do
 * not live here: the `window.HathorWallet` assignment (the legacy shim does it)
 * and the auto-restore IIFE (the composition root drives it). An adapter that
 * runs work on import cannot be composed or tested.
 */

const NETWORKS: Record<Deployment, Record<string, unknown>> = {
  mainnet: {
    id: 1,
    chainNamespace: 'hathor',
    caipNetworkId: 'hathor:mainnet',
    name: 'Hathor Mainnet',
    nativeCurrency: { name: 'HTR', symbol: 'HTR', decimals: 2 },
    rpcUrls: { default: { http: ['https://node1.mainnet.hathor.network/v1a/'] } },
  },
  testnet: {
    id: 2,
    chainNamespace: 'hathor',
    caipNetworkId: 'hathor:testnet',
    name: 'Hathor Testnet',
    nativeCurrency: { name: 'HTR', symbol: 'HTR', decimals: 2 },
    rpcUrls: { default: { http: ['https://node1.testnet.hathor.network/v1a/'] } },
  },
}

/** Per HathorNetwork/rfcs rpc-protocol.md. */
const HATHOR_METHODS = [
  'htr_sendTransaction',
  'htr_getBalance',
  'htr_getAddress',
  'htr_getConnectedNetwork',
  'htr_getUtxos',
  'htr_createToken',
  'htr_signWithAddress',
  'htr_sendNanoContractTx',
  'htr_getOperationStatus',
]

/**
 * `htr_getBalance` only became prompt-free in @hathor/hathor-rpc-handler 5.0.0
 * (npm, 2026-07-01). Every released wallet still ships a version that pops a
 * confirmation dialog on **every** call — desktop v0.35.0 pins 4.4.0, mobile
 * v0.39.0 pins 4.3.0 — which is unusable for a balance the UI refreshes. So the
 * balance is derived from the full node instead.
 *
 * Both wallets already pin 5.0.0 on master. When those ship, flip this and the
 * RPC becomes primary, with the node as fallback.
 */
const PREFER_WALLET_RPC_BALANCE = false

export interface WalletConnectConfig {
  readonly projectId: string
  readonly appUrl: string
  readonly appIcon: string
}

/** The slice of Reown's UniversalConnector this adapter actually uses. */
interface UniversalConnectorLike {
  connect(): Promise<{ session: WalletConnectSession }>
  disconnect(): Promise<void>
  provider?: {
    session?: WalletConnectSession
    client?: { request(args: unknown): Promise<unknown> }
  }
}

interface WalletConnectSession {
  readonly topic: string
  readonly namespaces?: { hathor?: { accounts?: string[] } }
}

interface UniversalConnectorFactory {
  init(options: unknown): Promise<UniversalConnectorLike>
}

export class HathorWalletConnectAdapter implements HathorWalletPort {
  private connector: UniversalConnectorLike | null = null
  private session: WalletConnectSession | null = null
  private address: string | null = null
  private rpcRequestId = 0

  constructor(
    private readonly connectorFactory: UniversalConnectorFactory,
    private readonly config: WalletConnectConfig,
    private readonly preferences: PreferencesPort,
    private readonly nodeBalance: HathorNodeBalanceAdapter = new HathorNodeBalanceAdapter(),
  ) {}

  getAddress(): string | null {
    return this.address
  }

  isConnected(): boolean {
    return this.session !== null
  }

  async connect(deployment: Deployment): Promise<HathorSession> {
    const connector = await this.ensureConnector(deployment)
    const { session } = await connector.connect()

    this.adoptSession(session)
    if (this.address) this.preferences.setHathorAddress(this.address)

    return { address: this.address }
  }

  async disconnect(): Promise<void> {
    try {
      await this.connector?.disconnect()
    } catch {
      // A failed disconnect must not leave the UI stuck as "connected".
    }
    this.session = null
    this.address = null
    this.preferences.clearHathorAddress()
  }

  async restore(deployment: Deployment): Promise<HathorSession | null> {
    try {
      const connector = await this.ensureConnector(deployment)
      // UniversalProvider reattaches to the last session during init.
      const session = connector.provider?.session
      if (!session) {
        this.preferences.clearHathorAddress()
        return null
      }

      this.adoptSession(session)
      // A session with no accounts still means "connected"; fall back to the
      // address we stored so the UI is not blank.
      if (!this.address) this.address = this.preferences.getHathorAddress()

      return { address: this.address }
    } catch (error) {
      console.warn('Hathor session restore failed:', error)
      return null
    }
  }

  async getBalance(tokenUid: string, deployment: Deployment): Promise<TokenBalance> {
    if (!this.address) throw new Error('Hathor wallet not connected')

    if (PREFER_WALLET_RPC_BALANCE) {
      try {
        return await this.balanceViaRpc(tokenUid, deployment)
      } catch (error) {
        console.warn('htr_getBalance failed, falling back to the full node:', error)
      }
    }

    return this.nodeBalance.getBalance(this.address, tokenUid, deployment)
  }

  /**
   * Two outputs: the token transfer to the bridge deposit address, and a data
   * output carrying the EVM destination for the bridge to read.
   */
  async sendBridgeTransfer(
    params: SendBridgeTransferParams,
    deployment: Deployment,
  ): Promise<{ hash: string }> {
    const result = await this.rpcRequest(
      'htr_sendTransaction',
      {
        network: deployment,
        outputs: [
          {
            address: params.bridgeAddress,
            value: params.amountUnits,
            token: params.tokenUid,
          },
          { type: 'data', data: params.evmDestination },
        ],
      },
      deployment,
    )

    const response = (result as { response?: { hash?: string } })?.response
    if (!response?.hash) {
      throw new Error('Transaction sent but the wallet returned no transaction id')
    }
    return { hash: response.hash }
  }

  private async ensureConnector(deployment: Deployment): Promise<UniversalConnectorLike> {
    if (this.connector) return this.connector

    this.connector = await this.connectorFactory.init({
      projectId: this.config.projectId,
      metadata: {
        name: 'Hathor Bridge',
        description: 'Token bridge between Hathor and Arbitrum',
        url: this.config.appUrl,
        icons: [this.config.appIcon],
      },
      networks: [
        {
          methods: HATHOR_METHODS,
          chains: [NETWORKS[deployment]],
          events: [],
          namespace: 'hathor',
        },
      ],
    })

    return this.connector
  }

  /** Session accounts look like `hathor:mainnet:H<address>`. */
  private adoptSession(session: WalletConnectSession): void {
    this.session = session
    const accounts = session.namespaces?.hathor?.accounts ?? []
    this.address = accounts.length > 0 ? (accounts[0]!.split(':')[2] ?? null) : null
  }

  private async rpcRequest(
    method: string,
    params: unknown,
    deployment: Deployment,
  ): Promise<unknown> {
    const provider = this.connector?.provider
    const session = provider?.session
    if (!provider || !session) throw new Error('No active WalletConnect session')

    return provider.client!.request({
      topic: session.topic,
      chainId: `hathor:${deployment}`,
      request: { jsonrpc: '2.0', id: ++this.rpcRequestId, method, params },
    })
  }

  private async balanceViaRpc(tokenUid: string, deployment: Deployment): Promise<TokenBalance> {
    const result = await this.rpcRequest(
      'htr_getBalance',
      // Never send addressIndexes — the wallet answers NotImplementedError.
      { network: deployment, tokens: [tokenUid] },
      deployment,
    )

    // Wallets wrap handler results as { type, response }; tolerate a bare array
    // from an older build.
    const balances = Array.isArray(result)
      ? result
      : (result as { response?: unknown })?.response
    if (!Array.isArray(balances)) {
      throw new Error('htr_getBalance returned an unexpected payload')
    }

    // The wallet returns an entry per requested token even when it holds none,
    // so a missing entry means something is off — fall back rather than report a
    // zero balance the user does not have.
    const entry = balances.find(
      (item) => (item as { token?: { id?: string } })?.token?.id === tokenUid,
    ) as { balance?: { unlocked?: number; locked?: number } } | undefined

    if (!entry) throw new Error(`htr_getBalance returned no entry for token ${tokenUid}`)

    return {
      available: Number(entry.balance?.unlocked ?? 0),
      locked: Number(entry.balance?.locked ?? 0),
    }
  }
}
