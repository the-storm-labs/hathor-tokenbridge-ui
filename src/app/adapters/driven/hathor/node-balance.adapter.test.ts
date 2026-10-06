import { describe, it, expect, vi } from 'vitest'
import { HathorNodeBalanceAdapter, sumUnspentOutputs } from './node-balance.adapter'

const ADDRESS = 'HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM'
const OTHER = 'HNgHyjsUsvFYSbkbYrnCZdZTj84SGyasdZ'
const HTR = '00'
const NOW = 1_800_000_000

const output = (over: Record<string, unknown> = {}) => ({
  value: 100,
  token: HTR,
  token_data: 0,
  spent_by: null,
  decoded: { address: ADDRESS, timelock: null },
  ...over,
})

describe('sumUnspentOutputs', () => {
  it('sums unspent outputs belonging to the address', () => {
    const history = [{ outputs: [output({ value: 200 }), output({ value: 50 })] }]
    expect(sumUnspentOutputs(history, ADDRESS, HTR, NOW)).toEqual({ available: 250, locked: 0 })
  })

  it('ignores outputs already spent', () => {
    const history = [
      { outputs: [output({ value: 200, spent_by: '0xabc' }), output({ value: 50 })] },
    ]
    expect(sumUnspentOutputs(history, ADDRESS, HTR, NOW).available).toBe(50)
  })

  it('ignores voided transactions entirely', () => {
    const history = [{ is_voided: true, outputs: [output({ value: 999 })] }]
    expect(sumUnspentOutputs(history, ADDRESS, HTR, NOW).available).toBe(0)
  })

  it("ignores counterparties' outputs", () => {
    // History returns whole transactions, so most outputs are not ours. Without
    // this filter a balance is wildly overstated.
    const history = [
      { outputs: [output({ value: 200, decoded: { address: OTHER } }), output({ value: 50 })] },
    ]
    expect(sumUnspentOutputs(history, ADDRESS, HTR, NOW).available).toBe(50)
  })

  it('ignores other tokens', () => {
    const history = [{ outputs: [output({ value: 200, token: 'abcd' }), output({ value: 50 })] }]
    expect(sumUnspentOutputs(history, ADDRESS, HTR, NOW).available).toBe(50)
  })

  it('ignores authority outputs, which carry no value', () => {
    const history = [
      { outputs: [output({ value: 200, token_data: 0b1000_0001 }), output({ value: 50 })] },
    ]
    expect(sumUnspentOutputs(history, ADDRESS, HTR, NOW).available).toBe(50)
  })

  it('counts a live timelock as locked, not available', () => {
    const history = [
      { outputs: [output({ value: 200, decoded: { address: ADDRESS, timelock: NOW + 3600 } })] },
    ]
    expect(sumUnspentOutputs(history, ADDRESS, HTR, NOW)).toEqual({ available: 0, locked: 200 })
  })

  it('counts an expired timelock as available', () => {
    const history = [
      { outputs: [output({ value: 200, decoded: { address: ADDRESS, timelock: NOW - 1 } })] },
    ]
    expect(sumUnspentOutputs(history, ADDRESS, HTR, NOW)).toEqual({ available: 200, locked: 0 })
  })

  it('handles an empty history and transactions with no outputs', () => {
    expect(sumUnspentOutputs([], ADDRESS, HTR, NOW)).toEqual({ available: 0, locked: 0 })
    expect(sumUnspentOutputs([{}], ADDRESS, HTR, NOW)).toEqual({ available: 0, locked: 0 })
  })
})

describe('HathorNodeBalanceAdapter', () => {
  const page = (body: Record<string, unknown>) =>
    ({ ok: true, status: 200, json: async () => body }) as Response

  it('queries the node for the deployment', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      page({ success: true, history: [], has_more: false }),
    )
    const adapter = new HathorNodeBalanceAdapter(
      fetchFn as unknown as typeof fetch,
      () => NOW * 1000,
    )

    await adapter.getBalance(ADDRESS, HTR, 'mainnet')
    expect(fetchFn.mock.calls[0]![0]).toContain('node1.mainnet.hathor.network')

    await adapter.getBalance(ADDRESS, HTR, 'testnet')
    expect(fetchFn.mock.calls[1]![0]).toContain('node1.testnet.hathor.network')

    // Both testnets bridge the same Hathor network.
    await adapter.getBalance(ADDRESS, HTR, 'testnet-arb')
    expect(fetchFn.mock.calls[2]![0]).toContain('node1.testnet.hathor.network')
  })

  it('follows pagination and accumulates across pages', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        page({
          success: true,
          history: [{ outputs: [output({ value: 100 })] }],
          has_more: true,
          first_hash: 'HASH1',
          first_address: ADDRESS,
        }),
      )
      .mockResolvedValueOnce(
        page({ success: true, history: [{ outputs: [output({ value: 23 })] }], has_more: false }),
      )

    const adapter = new HathorNodeBalanceAdapter(
      fetchFn as unknown as typeof fetch,
      () => NOW * 1000,
    )
    expect(await adapter.getBalance(ADDRESS, HTR, 'mainnet')).toEqual({ available: 123, locked: 0 })

    expect(fetchFn.mock.calls[1]![0]).toContain('hash=HASH1')
    expect(fetchFn.mock.calls[1]![0]).toContain(`address=${ADDRESS}`)
  })

  it('errors rather than returning an undercount on a runaway walk', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      page({ success: true, history: [], has_more: true, first_hash: 'x' }),
    )
    const adapter = new HathorNodeBalanceAdapter(
      fetchFn as unknown as typeof fetch,
      () => NOW * 1000,
    )

    await expect(adapter.getBalance(ADDRESS, HTR, 'mainnet')).rejects.toThrow(/incomplete/)
  })

  it('reports an HTTP failure', async () => {
    const fetchFn = vi.fn(async (_url: string) => ({ ok: false, status: 403 }) as Response)
    const adapter = new HathorNodeBalanceAdapter(fetchFn as unknown as typeof fetch)

    // 403 is exactly what the retired address_balance endpoint returns.
    await expect(adapter.getBalance(ADDRESS, HTR, 'mainnet')).rejects.toThrow(/403/)
  })

  it('reports a node-level failure', async () => {
    const fetchFn = vi.fn(async (_url: string) => page({ success: false }))
    const adapter = new HathorNodeBalanceAdapter(fetchFn as unknown as typeof fetch)

    await expect(adapter.getBalance(ADDRESS, HTR, 'mainnet')).rejects.toThrow(/success:false/)
  })
})
