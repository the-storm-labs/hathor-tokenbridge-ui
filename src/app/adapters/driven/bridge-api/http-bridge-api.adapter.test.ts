import { describe, it, expect, vi } from 'vitest'
import { HttpBridgeApiAdapter } from './http-bridge-api.adapter'
import { TransferDirection } from '../../../ports/driven/bridge-api.port'

const BASE = 'https://api.example.test'

/** A real mainnet record, kept verbatim so the mapping is pinned to real data. */
const REAL_RECORD = {
  transactionId: '0x3649d02e31bc8ec0e0ca27c2968a38c49e3ab49ff19b8f36ef453a4c1c1441dd',
  transactionHash: '0x3649d02e31bc8ec0e0ca27c2968a38c49e3ab49ff19b8f36ef453a4c1c1441dd',
  originalTokenAddress: '0xE3f0Ae350EE09657933CD8202A4dd563c5af941F',
  amount: '2000000000000000000',
  sender: '0x89612c955624281a4B3aa41b8b2994A77EDAcEaD',
  receiver: '0x4359217fD9761AC1308E905c8b596777Efb20a1B',
  signatures: 0,
  votes: 2,
  hathorFederationStatus: null,
  updatedAt: '2026-08-11T21:08:18.619Z',
  blockNumber: 493546013,
  blockHash: '0x289a0c69e8ccdb445018b43293ff03609cb05633c2590cb6c7753003f59d24ff',
  logIndex: 129,
  originChainId: 31,
  destinationChainId: 42161,
  direction: 'hathor_to_evm',
  originTransactionHash: null,
  status: 'evm_voting',
}

const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response

const fetchReturning = (body: unknown) =>
  vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body))

describe('listByReceiver', () => {
  it('builds the request URL from the configured base', async () => {
    const fetchFn = fetchReturning([])
    const api = new HttpBridgeApiAdapter(BASE, fetchFn as unknown as typeof fetch)

    await api.listByReceiver('0xabc', { limit: 50, direction: TransferDirection.HathorToEvm })

    expect(fetchFn.mock.calls[0]![0]).toBe(
      `${BASE}/transactions-by-receiver?receiver=0xabc&limit=50&direction=hathor_to_evm`,
    )
  })

  it('strips a trailing slash from the base url', async () => {
    const fetchFn = fetchReturning([])
    const api = new HttpBridgeApiAdapter(`${BASE}///`, fetchFn as unknown as typeof fetch)

    await api.listByReceiver('0xabc')
    expect(fetchFn.mock.calls[0]![0]).toBe(`${BASE}/transactions-by-receiver?receiver=0xabc`)
  })

  it('omits absent optional parameters', async () => {
    const fetchFn = fetchReturning([])
    const api = new HttpBridgeApiAdapter(BASE, fetchFn as unknown as typeof fetch)

    await api.listByReceiver('0xabc')
    expect(fetchFn.mock.calls[0]![0]).toBe(`${BASE}/transactions-by-receiver?receiver=0xabc`)
  })

  it('short-circuits without a receiver', async () => {
    const fetchFn = fetchReturning([])
    const api = new HttpBridgeApiAdapter(BASE, fetchFn as unknown as typeof fetch)

    expect(await api.listByReceiver('')).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('maps a real record faithfully', async () => {
    const api = new HttpBridgeApiAdapter(
      BASE,
      fetchReturning([REAL_RECORD]) as unknown as typeof fetch,
    )
    const [transfer] = await api.listByReceiver('0xabc')

    expect(transfer!.transactionId).toBe(REAL_RECORD.transactionId)
    expect(transfer!.blockHash).toBe(REAL_RECORD.blockHash)
    expect(transfer!.originTransactionHash).toBeNull()
    expect(transfer!.votes).toBe(2)
    expect(transfer!.signatures).toBe(0)
  })

  it('aliases backendTxHash to transactionHash', async () => {
    const api = new HttpBridgeApiAdapter(
      BASE,
      fetchReturning([REAL_RECORD]) as unknown as typeof fetch,
    )
    const [transfer] = await api.listByReceiver('0xabc')

    expect(transfer!.backendTxHash).toBe(transfer!.transactionHash)
  })

  it('keeps amount as an exact string', async () => {
    // 2000000000000000000 does not survive a round trip through a JS number.
    const api = new HttpBridgeApiAdapter(
      BASE,
      fetchReturning([REAL_RECORD]) as unknown as typeof fetch,
    )
    const [transfer] = await api.listByReceiver('0xabc')

    expect(transfer!.amount).toBe('2000000000000000000')
    expect(typeof transfer!.amount).toBe('string')
  })

  it('defaults missing fields instead of producing undefined', async () => {
    const api = new HttpBridgeApiAdapter(BASE, fetchReturning([{}]) as unknown as typeof fetch)
    const [transfer] = await api.listByReceiver('0xabc')

    expect(transfer!.amount).toBe('0')
    expect(transfer!.votes).toBe(0)
    expect(transfer!.signatures).toBe(0)
    expect(transfer!.transactionId).toBeNull()
    expect(transfer!.blockHash).toBeNull()
  })

  it('returns an empty list when the payload is not an array', async () => {
    const api = new HttpBridgeApiAdapter(
      BASE,
      fetchReturning({ error: 'nope' }) as unknown as typeof fetch,
    )
    expect(await api.listByReceiver('0xabc')).toEqual([])
  })

  it('surfaces the plain-text error body on failure', async () => {
    const fetchFn = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        ({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () => "Missing 'receiver' parameter",
        }) as Response,
    )
    const api = new HttpBridgeApiAdapter(BASE, fetchFn as unknown as typeof fetch)

    await expect(api.listByReceiver('0xabc')).rejects.toThrow(/400 Bad Request.*Missing 'receiver'/)
  })

  it('fails loudly when the base url is not configured', async () => {
    const api = new HttpBridgeApiAdapter('', fetchReturning([]) as unknown as typeof fetch)
    await expect(api.listByReceiver('0xabc')).rejects.toThrow(/VITE_BRIDGE_API_URL/)
  })
})

describe('the default fetch', () => {
  it('is bound, so calling it as a method does not throw Illegal invocation', async () => {
    // Regression: the default parameter used to be a bare `fetch`, which loses
    // its binding to the window once stored on an instance. Every injected-mock
    // test passed while the real browser threw on the first request.
    const calls: string[] = []
    const original = globalThis.fetch
    globalThis.fetch = function (this: unknown, url: unknown) {
      // A bare reference would arrive here with `this` set to the adapter.
      if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation')
      calls.push(String(url))
      return Promise.resolve(jsonResponse([]))
    } as unknown as typeof fetch

    try {
      await new HttpBridgeApiAdapter(BASE).listByReceiver('0xabc')
      expect(calls).toHaveLength(1)
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('ping', () => {
  it('is true when /hello answers ok', async () => {
    const api = new HttpBridgeApiAdapter(BASE, fetchReturning('ok') as unknown as typeof fetch)
    expect(await api.ping()).toBe(true)
  })

  it('is false when the request throws', async () => {
    const fetchFn = vi.fn(async (_url: string) => {
      throw new Error('offline')
    })
    const api = new HttpBridgeApiAdapter(BASE, fetchFn as unknown as typeof fetch)
    expect(await api.ping()).toBe(false)
  })

  it('is false when unconfigured, without making a request', async () => {
    const fetchFn = fetchReturning('ok')
    const api = new HttpBridgeApiAdapter('', fetchFn as unknown as typeof fetch)

    expect(await api.ping()).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
