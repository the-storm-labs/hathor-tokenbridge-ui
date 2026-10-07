import type {
  ApiTransfer,
  BridgeApiPort,
  ListTransfersOptions,
} from '../../../ports/driven/bridge-api.port'

/**
 * HTTP client for the bridge Read API. Ported from js/bridge-api.js.
 *
 * The base URL is injected rather than read from `window.__ENV__` at call time,
 * so this class is drivable from a test with no globals at all.
 */
export class HttpBridgeApiAdapter implements BridgeApiPort {
  private readonly baseUrl: string

  constructor(
    baseUrl: string,
    // Bound on purpose: `fetch` throws "Illegal invocation" when called with a
    // `this` other than the window, and storing it on an instance does exactly
    // that. A unit test passing an injected mock never sees this.
    private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    // Callers configure this by hand in an env file; a trailing slash would
    // produce '//transactions-by-receiver'.
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async listByReceiver(
    receiver: string,
    options: ListTransfersOptions = {},
  ): Promise<ApiTransfer[]> {
    if (!receiver) return []

    const payload = await this.request('/transactions-by-receiver', {
      receiver,
      limit: options.limit,
      direction: options.direction,
    })

    return Array.isArray(payload) ? payload.map(normalizeTransfer) : []
  }

  async listBySender(sender: string, options: ListTransfersOptions = {}): Promise<ApiTransfer[]> {
    if (!sender) return []

    const payload = await this.request('/transactions-by-sender', {
      sender,
      limit: options.limit,
      direction: options.direction,
    })

    return Array.isArray(payload) ? payload.map(normalizeTransfer) : []
  }

  async ping(): Promise<boolean> {
    if (!this.baseUrl) return false
    try {
      const response = await this.fetchFn(`${this.baseUrl}/hello`)
      return response.ok
    } catch {
      return false
    }
  }

  private async request(
    path: string,
    params: Record<string, string | number | undefined>,
  ): Promise<unknown> {
    if (!this.baseUrl) {
      throw new Error('Bridge API url is not configured (VITE_BRIDGE_API_URL)')
    }

    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value))
      }
    }

    const queryString = query.toString()
    const response = await this.fetchFn(
      `${this.baseUrl}${path}${queryString ? `?${queryString}` : ''}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    )

    if (!response.ok) {
      // The API answers errors as text/plain ("Missing 'receiver' parameter").
      const detail = await response.text().catch(() => '')
      throw new Error(
        `Bridge API ${path} failed: ${response.status} ${response.statusText}` +
          (detail ? ` — ${detail}` : ''),
      )
    }

    return response.json()
  }
}

/**
 * Normalise one API record.
 *
 * `amount` stays a raw integer string: parsing it as a number would lose
 * precision on an 18-decimal value long before it reached the contract.
 */
function normalizeTransfer(raw: unknown): ApiTransfer {
  const tx = (raw ?? {}) as Record<string, unknown>
  const str = (value: unknown): string | null => (value == null ? null : String(value))
  const num = (value: unknown): number | null => (value == null ? null : Number(value))

  return {
    transactionId: str(tx['transactionId']),
    transactionHash: str(tx['transactionHash']),
    // The UI matches stored records on `backendTxHash`; it is the same value.
    backendTxHash: str(tx['transactionHash']),
    originTransactionHash: str(tx['originTransactionHash']),
    originalTokenAddress: str(tx['originalTokenAddress']),
    sender: str(tx['sender']),
    receiver: str(tx['receiver']),
    amount: tx['amount'] == null ? '0' : String(tx['amount']),
    votes: Number(tx['votes']) || 0,
    signatures: Number(tx['signatures']) || 0,
    status: str(tx['status']),
    direction: str(tx['direction']),
    hathorFederationStatus: str(tx['hathorFederationStatus']),
    blockNumber: num(tx['blockNumber']),
    blockHash: str(tx['blockHash']),
    logIndex: num(tx['logIndex']),
    originChainId: num(tx['originChainId']),
    destinationChainId: num(tx['destinationChainId']),
    updatedAt: str(tx['updatedAt']),
    delivered: tx['delivered'] == null ? null : tx['delivered'] === true,
    deliveryTxId: str(tx['deliveryTxId']),
    chainTimestamp: str(tx['chainTimestamp']),
  }
}
