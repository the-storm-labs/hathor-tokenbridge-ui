import type { Deployment } from '../../../domain/model/deployment'
import type { TokenBalance } from '../../../ports/driven/hathor-wallet.port'

/**
 * Token balance derived from the Hathor full node.
 *
 * The node's `address_balance` endpoint would answer this directly, but the
 * public nodes return **403** for it (a Google load-balancer rule, not CORS —
 * curl gets the same). `address_history` is still open, so the balance is summed
 * from unspent outputs instead.
 *
 * Verified against `explorer-service`'s own balance endpoint on four addresses,
 * including one with 198 transactions that exercises pagination, and on both
 * native HTR and a custom token.
 */

const NODE_URLS: Record<Deployment, string> = {
  mainnet: 'https://node1.mainnet.hathor.network/v1a/',
  testnet: 'https://node1.testnet.hathor.network/v1a/',
}

/** An output whose token_data has this bit set is a mint/melt authority. */
const TOKEN_AUTHORITY_MASK = 0b1000_0000

/** The node returns 150 transactions per page; this caps a pathological walk. */
const MAX_HISTORY_PAGES = 50

interface HistoryOutput {
  readonly value: number
  readonly token: string
  readonly token_data: number
  readonly spent_by: string | null
  readonly decoded?: { address?: string; timelock?: number | null }
}

interface HistoryTransaction {
  readonly is_voided?: boolean
  readonly outputs?: readonly HistoryOutput[]
}

interface HistoryPage {
  readonly success: boolean
  readonly history?: readonly HistoryTransaction[]
  readonly has_more?: boolean
  readonly first_hash?: string
  readonly first_address?: string
}

export class HathorNodeBalanceAdapter {
  constructor(
    // Bound: `fetch` throws "Illegal invocation" when invoked with a `this`
    // other than the window, which is what storing it on an instance does.
    private readonly fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly now: () => number = Date.now,
  ) {}

  async getBalance(
    address: string,
    tokenUid: string,
    deployment: Deployment,
  ): Promise<TokenBalance> {
    const nodeUrl = NODE_URLS[deployment]
    const nowSeconds = Math.floor(this.now() / 1000)

    let query = `addresses[]=${encodeURIComponent(address)}`
    let available = 0
    let locked = 0

    for (let page = 0; ; page++) {
      if (page >= MAX_HISTORY_PAGES) {
        // A partial sum is silently wrong; an error is recoverable.
        throw new Error(
          `Address history exceeded ${MAX_HISTORY_PAGES} pages; balance would be incomplete`,
        )
      }

      const response = await this.fetchFn(`${nodeUrl}thin_wallet/address_history?${query}`)
      if (!response.ok) throw new Error(`Node request failed: ${response.status}`)

      const data = (await response.json()) as HistoryPage
      if (!data.success) throw new Error('Node returned success:false')

      const page_ = sumUnspentOutputs(data.history ?? [], address, tokenUid, nowSeconds)
      available += page_.available
      locked += page_.locked

      if (!data.has_more) break

      query = `addresses[]=${encodeURIComponent(address)}&hash=${encodeURIComponent(data.first_hash ?? '')}`
      if (data.first_address) query += `&address=${encodeURIComponent(data.first_address)}`
    }

    return { available, locked }
  }
}

/**
 * Sum the outputs of `address` for `tokenUid` that are still spendable.
 *
 * Four filters, every one of them load-bearing — dropping any produces a balance
 * that is wrong rather than merely imprecise:
 *
 *  1. voided transactions do not exist as far as balances go;
 *  2. an output with `spent_by` set is already gone;
 *  3. **history returns whole transactions**, so most outputs belong to
 *     counterparties and must be filtered down to this address;
 *  4. authority outputs carry mint/melt rights, not value.
 *
 * Exported for testing: this is where a balance bug would live.
 */
export function sumUnspentOutputs(
  history: readonly HistoryTransaction[],
  address: string,
  tokenUid: string,
  nowSeconds: number,
): TokenBalance {
  let available = 0
  let locked = 0

  for (const tx of history) {
    if (tx.is_voided) continue

    for (const output of tx.outputs ?? []) {
      if (output.spent_by) continue
      if (output.token !== tokenUid) continue
      if (output.decoded?.address !== address) continue
      if (output.token_data & TOKEN_AUTHORITY_MASK) continue

      const timelock = output.decoded?.timelock
      if (timelock && timelock > nowSeconds) locked += Number(output.value)
      else available += Number(output.value)
    }
  }

  return { available, locked }
}
