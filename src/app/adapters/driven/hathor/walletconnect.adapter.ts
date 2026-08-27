import type { Deployment } from '../../../domain/model/deployment'
import {
  UserRejectedError,
  type HathorSession,
  type HathorWalletPort,
  type SendBridgeTransferParams,
  type TokenBalance,
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

/**
 * Margin on the expiry check.
 *
 * A session with a minute left is not worth restoring: it survives the page load
 * and then dies in the middle of the next transfer, which is exactly the failure
 * the check exists to prevent.
 */
const EXPIRY_SKEW_MS = 60_000

/**
 * Renew a session that has less than this left.
 *
 * WalletConnect sessions live seven days — `SESSION_EXPIRY` in
 * @walletconnect/sign-client — and nothing renews them: not this app, not
 * Reown's UniversalConnector. So a wallet connected on a Monday is silently dead
 * the next Monday. Extending on restore means anyone who opens the page inside
 * the window never reaches that point.
 */
const EXTEND_WHEN_UNDER_MS = 2 * 24 * 60 * 60 * 1000

const SESSION_EXPIRED_MESSAGE =
  'Your Hathor wallet session expired. Reconnect your wallet and try again.'

export interface WalletConnectConfig {
  readonly projectId: string
  readonly appUrl: string
  readonly appIcon: string
}

/** The slice of Reown's UniversalConnector this adapter actually uses. */
interface UniversalConnectorLike {
  connect(): Promise<{ session: WalletConnectSession }>
  disconnect(): Promise<void>
  provider?: ProviderLike
}

interface ProviderLike {
  session?: WalletConnectSession
  client?: SignClientLike
  on?(event: string, listener: (payload?: unknown) => void): void
}

/** Everything optional but `request`: a stub in a test provides only that. */
interface SignClientLike {
  request(args: unknown): Promise<unknown>
  extend?(params: { topic: string }): Promise<unknown>
  on?(event: string, listener: (payload: { topic?: string }) => void): void
}

interface WalletConnectSession {
  readonly topic: string
  /**
   * Unix **seconds**, per `SessionTypes.Struct` — not milliseconds. Seven days
   * out from when the session was opened, unless something extends it.
   */
  readonly expiry?: number
  readonly namespaces?: { hathor?: { accounts?: string[] } }
}

/**
 * Whether a stored session is still worth using.
 *
 * A missing `expiry` counts as live on purpose: it means a shape this adapter
 * does not recognise, and signing the user out over a field we failed to read is
 * worse than the failure this guards against. Every real session carries one.
 */
function isLive(session: WalletConnectSession | null | undefined): boolean {
  if (!session) return false
  if (typeof session.expiry !== 'number') return true

  return session.expiry * 1000 - EXPIRY_SKEW_MS > Date.now()
}

/**
 * Whether a request's rejection was the user declining it in their wallet.
 *
 * `@walletconnect/jsonrpc-provider` rejects a request with the bare JSON-RPC
 * error object off the wire, not an `Error` — `isJsonRpcError(n) ? o(n.error)
 * : ...`. A decline is WalletConnect's own standard error
 * (`getSdkError('USER_REJECTED')`): `{ code: 5000, message: 'User
 * rejected.' }`. The message is checked too, in case a wallet's own RPC
 * handler answers a decline with a different code but still says so in words —
 * better to catch that than to show it as a bug on our side.
 */
function isUserRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false

  const { code, message } = error as { code?: unknown; message?: unknown }
  if (code === 5000) return true

  return typeof message === 'string' && /reject/i.test(message)
}

interface UniversalConnectorFactory {
  init(options: unknown): Promise<UniversalConnectorLike>
}

export class HathorWalletConnectAdapter implements HathorWalletPort {
  private connector: UniversalConnectorLike | null = null
  private session: WalletConnectSession | null = null
  private address: string | null = null
  private rpcRequestId = 0
  private readonly sessionLostListeners: Array<() => void> = []

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

  onSessionLost(listener: () => void): void {
    this.sessionLostListeners.push(listener)
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

  /**
   * Reattaches to a persisted session, or reports there is none.
   *
   * The stored address is checked **before** the connector is built, and that
   * ordering is the whole point. Initialising Reown opens a relay connection,
   * boots Lit and the AppKit modal, and replays whatever WalletConnect has
   * queued — so the previous version did all of that on every page load, for
   * every visitor, including the ones who only ever use the ARB→HTR form and
   * have never seen a Hathor wallet.
   *
   * Safe because `connect()` stores the address whenever the session has one,
   * and every operation here needs an address to be useful: a session without
   * one can neither show a balance nor name a sender.
   */
  async restore(deployment: Deployment): Promise<HathorSession | null> {
    if (!this.preferences.getHathorAddress()) return null

    try {
      const connector = await this.ensureConnector(deployment)
      // UniversalProvider reattaches to the last session during init.
      const session = connector.provider?.session
      if (!session) {
        this.preferences.clearHathorAddress()
        return null
      }

      if (!isLive(session)) {
        // The SDK does prune expired sessions, but only on a heartbeat pulse and
        // only while the relay is connected — and UniversalProvider reads the
        // store before the first pulse. So a session days past its expiry is
        // still sitting there, and adopting it is what made the page look
        // connected while every transfer hung for the five minutes a session
        // request waits before the relay gives up on it.
        console.info('Hathor WalletConnect session expired; reconnect required')
        this.preferences.clearHathorAddress()
        return { address: null, expired: true }
      }

      this.adoptSession(session)
      // A session with no accounts still means "connected"; fall back to the
      // address we stored so the UI is not blank.
      if (!this.address) this.address = this.preferences.getHathorAddress()

      this.extendIfExpiringSoon(connector, session)

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

    this.watchSessionLifecycle(this.connector)
    return this.connector
  }

  /**
   * Subscribes to the three ways a session ends without this page being touched:
   * the expirer reaping it, the wallet deleting it, the provider dropping the
   * connection.
   *
   * Without these the header goes on claiming a session that no longer exists,
   * and the first thing the user learns is a transfer that fails. Every call is
   * optional-chained and wrapped, because a provider that emits none of them — a
   * stub in a test, a future SDK — must not take the connection down with it.
   */
  private watchSessionLifecycle(connector: UniversalConnectorLike): void {
    const provider = connector.provider
    if (!provider) return

    try {
      provider.on?.('session_delete', () => this.handleSessionLost())
      provider.on?.('disconnect', () => this.handleSessionLost())
      // The expirer reports on the SignClient, not on the provider.
      provider.client?.on?.('session_expire', ({ topic }) => {
        if (!topic || topic === this.session?.topic) this.handleSessionLost()
      })
    } catch (error) {
      console.warn('Could not subscribe to WalletConnect session events:', error)
    }
  }

  /**
   * Drops the session and tells whoever is listening.
   *
   * Guarded on there being one, because the SDK can report a single death twice
   * — a `session_expire` and a `session_delete` for the same topic — and the
   * page must not announce a disconnect it has already announced.
   */
  private handleSessionLost(): void {
    if (!this.session) return

    this.session = null
    this.address = null
    this.preferences.clearHathorAddress()
    for (const listener of this.sessionLostListeners) listener()
  }

  /**
   * Pushes a nearly-spent session back out to a full term.
   *
   * Deliberately not awaited: `wc_sessionExtend` is a relay round trip that
   * needs the wallet reachable, and a restore must neither wait on nor fail
   * because of a phone that is asleep. Worst case the renewal does not happen
   * and the session expires exactly as it would have.
   */
  private extendIfExpiringSoon(
    connector: UniversalConnectorLike,
    session: WalletConnectSession,
  ): void {
    if (typeof session.expiry !== 'number') return
    if (session.expiry * 1000 - Date.now() > EXTEND_WHEN_UNDER_MS) return

    try {
      const extended = connector.provider?.client?.extend?.({ topic: session.topic })
      void Promise.resolve(extended).catch((error: unknown) =>
        console.warn('Could not extend the Hathor session:', error),
      )
    } catch (error) {
      console.warn('Could not extend the Hathor session:', error)
    }
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

    // Checked here as well as on restore, because a session can reach its expiry
    // while the page is open. Without this the request goes to the relay and
    // sits there for the five minutes `wc_sessionRequest` waits before
    // rejecting — behind a pending toast that is deliberately sticky, so the
    // user watches a spinner for five minutes and then gets "Request expired".
    if (!isLive(session)) {
      this.handleSessionLost()
      throw new Error(SESSION_EXPIRED_MESSAGE)
    }

    try {
      return await provider.client!.request({
        topic: session.topic,
        chainId: `hathor:${deployment}`,
        request: { jsonrpc: '2.0', id: ++this.rpcRequestId, method, params },
      })
    } catch (error) {
      if (isUserRejection(error)) throw new UserRejectedError()
      throw error
    }
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
    const balances = Array.isArray(result) ? result : (result as { response?: unknown })?.response
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
