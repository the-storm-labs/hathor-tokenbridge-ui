import { describe, it, expect, beforeEach } from 'vitest'
import { LocalTransferHistoryAdapter, storageKey } from './local-transfer-history.adapter'

/** Minimal in-memory Storage, so these tests need no DOM. */
function fakeStorage(): Storage & { raw: Map<string, string> } {
  const raw = new Map<string, string>()
  return {
    raw,
    get length() {
      return raw.size
    },
    key: (i: number) => [...raw.keys()][i] ?? null,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => void raw.set(k, v),
    removeItem: (k: string) => void raw.delete(k),
    clear: () => raw.clear(),
  } as Storage & { raw: Map<string, string> }
}

const ADDRESS = '0x4359217fD9761AC1308E905c8b596777Efb20a1B'
const NETWORK = 'Hathor Mainnet'

let storage: ReturnType<typeof fakeStorage>
let history: LocalTransferHistoryAdapter

beforeEach(() => {
  storage = fakeStorage()
  history = new LocalTransferHistoryAdapter(storage)
})

describe('storageKey — a compatibility contract with data already in browsers', () => {
  it('matches the key the previous implementation produced', () => {
    expect(storageKey(ADDRESS, NETWORK)).toBe(
      '0x4359217fd9761ac1308e905c8b596777efb20a1b-hathor-mainnet',
    )
  })

  it('lowercases so address casing does not split a history in two', () => {
    expect(storageKey(ADDRESS.toLowerCase(), NETWORK)).toBe(
      storageKey(ADDRESS.toUpperCase(), NETWORK),
    )
  })

  it('replaces only the FIRST space, as the original did', () => {
    // Not a typo to fix: making the replace global would change the key and
    // orphan existing records.
    expect(storageKey('0xabc', 'Hathor Main Net')).toBe('0xabc-hathor-main net')
  })

  it('handles a network name with no space', () => {
    expect(storageKey('0xabc', 'Golf')).toBe('0xabc-golf')
  })
})

describe('list', () => {
  it('returns an empty array when nothing is stored', () => {
    expect(history.list(ADDRESS, NETWORK)).toEqual([])
  })

  it('sorts newest block first, with unconfirmed transfers on top', () => {
    for (const t of [
      { transactionHash: 'a', blockNumber: 100 },
      { transactionHash: 'b', blockNumber: 300 },
      { transactionHash: 'c', blockNumber: null },
      { transactionHash: 'd', blockNumber: 200 },
    ]) {
      history.upsertHathorTransfer(ADDRESS, NETWORK, t)
    }

    expect(history.list(ADDRESS, NETWORK).map((t) => t.transactionHash)).toEqual([
      'c',
      'b',
      'd',
      'a',
    ])
  })

  it('survives corrupt stored JSON instead of throwing', () => {
    storage.setItem(storageKey(ADDRESS, NETWORK), '{not json')
    expect(history.list(ADDRESS, NETWORK)).toEqual([])
  })

  it('keeps histories for different networks apart', () => {
    history.upsertHathorTransfer(ADDRESS, NETWORK, { transactionHash: 'main' })
    history.upsertHathorTransfer(ADDRESS, 'Golf', { transactionHash: 'test' })

    expect(history.list(ADDRESS, NETWORK).map((t) => t.transactionHash)).toEqual(['main'])
    expect(history.list(ADDRESS, 'Golf').map((t) => t.transactionHash)).toEqual(['test'])
  })
})

describe('upsertHathorTransfer', () => {
  const HATHOR_TX = '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532'
  const EVM_TX = '0x3649d02e31bc8ec0e0ca27c2968a38c49e3ab49ff19b8f36ef453a4c1c1441dd'

  it('inserts a new transfer', () => {
    history.upsertHathorTransfer(ADDRESS, NETWORK, { hathorTxId: HATHOR_TX, votes: 0 })
    expect(history.list(ADDRESS, NETWORK)).toHaveLength(1)
  })

  it('updates in place rather than appending', () => {
    history.upsertHathorTransfer(ADDRESS, NETWORK, { hathorTxId: HATHOR_TX, votes: 0 })
    history.upsertHathorTransfer(ADDRESS, NETWORK, { hathorTxId: HATHOR_TX, votes: 3 })

    const stored = history.list(ADDRESS, NETWORK)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.votes).toBe(3)
  })

  it('skips the write when nothing changed', () => {
    const transfer = { hathorTxId: HATHOR_TX, status: 'claimed', votes: 4, blockNumber: 1 }
    history.upsertHathorTransfer(ADDRESS, NETWORK, transfer)
    const afterFirst = storage.getItem(storageKey(ADDRESS, NETWORK))

    history.upsertHathorTransfer(ADDRESS, NETWORK, { ...transfer })
    expect(storage.getItem(storageKey(ADDRESS, NETWORK))).toBe(afterFirst)
  })

  it('persists a newly learned EVM hash even when nothing else moved', () => {
    history.upsertHathorTransfer(ADDRESS, NETWORK, { hathorTxId: HATHOR_TX, status: 'claimed' })
    history.upsertHathorTransfer(ADDRESS, NETWORK, {
      hathorTxId: HATHOR_TX,
      status: 'claimed',
      backendTxHash: EVM_TX,
    })

    expect(history.list(ADDRESS, NETWORK)[0]!.backendTxHash).toBe(EVM_TX)
  })

  it('matches on any shared identifier, not just the most specific one', () => {
    for (const [seed, incoming] of [
      [{ transactionId: 'id-1' }, { transactionId: 'id-1', votes: 1 }],
      [{ hathorTxId: HATHOR_TX }, { hathorTxId: HATHOR_TX, votes: 1 }],
      [{ backendTxHash: EVM_TX }, { backendTxHash: EVM_TX, votes: 1 }],
      [{ transactionHash: EVM_TX }, { transactionHash: EVM_TX, votes: 1 }],
    ] as const) {
      const fresh = new LocalTransferHistoryAdapter(fakeStorage())
      fresh.upsertHathorTransfer(ADDRESS, NETWORK, seed)
      fresh.upsertHathorTransfer(ADDRESS, NETWORK, incoming)
      expect(fresh.list(ADDRESS, NETWORK)).toHaveLength(1)
    }
  })

  it('collapses a duplicate pair that already exists in storage', () => {
    // The exact regression seen in production: the local record (no
    // transactionId) and the API record (with one) coexisted, and every later
    // poll re-found only the API copy by transactionId. Both are the same
    // transfer, so a poll that knows the hathorTxId must merge them.
    history.upsertHathorTransfer(ADDRESS, NETWORK, {
      hathorTxId: HATHOR_TX,
      transactionHash: HATHOR_TX,
      status: 'hathor_voting',
      votes: 0,
    })
    history.upsertHathorTransfer(ADDRESS, NETWORK, {
      transactionId: EVM_TX,
      transactionHash: EVM_TX,
      backendTxHash: EVM_TX,
      hathorTxId: null,
      status: 'evm_voting',
      votes: 3,
    })
    expect(history.list(ADDRESS, NETWORK)).toHaveLength(2)

    // Next poll, now able to resolve the Hathor id.
    history.upsertHathorTransfer(ADDRESS, NETWORK, {
      transactionId: EVM_TX,
      transactionHash: EVM_TX,
      backendTxHash: EVM_TX,
      hathorTxId: HATHOR_TX,
      status: 'awaiting_claim',
      votes: 4,
    })

    const stored = history.list(ADDRESS, NETWORK)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.hathorTxId).toBe(HATHOR_TX)
    expect(stored[0]!.votes).toBe(4)
  })

  it('is idempotent once collapsed', () => {
    const merged = {
      transactionId: EVM_TX,
      transactionHash: EVM_TX,
      backendTxHash: EVM_TX,
      hathorTxId: HATHOR_TX,
      status: 'claimed',
      votes: 4,
    }
    history.upsertHathorTransfer(ADDRESS, NETWORK, merged)
    for (let i = 0; i < 5; i++) history.upsertHathorTransfer(ADDRESS, NETWORK, { ...merged })

    expect(history.list(ADDRESS, NETWORK)).toHaveLength(1)
  })

  it('keeps unrelated transfers apart', () => {
    history.upsertHathorTransfer(ADDRESS, NETWORK, { hathorTxId: 'aaa', transactionId: 'id-a' })
    history.upsertHathorTransfer(ADDRESS, NETWORK, { hathorTxId: 'bbb', transactionId: 'id-b' })
    expect(history.list(ADDRESS, NETWORK)).toHaveLength(2)
  })

  it('does not treat two records as the same just because both lack ids', () => {
    history.upsertHathorTransfer(ADDRESS, NETWORK, { amount: '1.00' })
    history.upsertHathorTransfer(ADDRESS, NETWORK, { amount: '2.00' })
    expect(history.list(ADDRESS, NETWORK)).toHaveLength(2)
  })

  it('preserves fields written by older builds', () => {
    history.upsertHathorTransfer(ADDRESS, NETWORK, {
      hathorTxId: HATHOR_TX,
      legacyFieldFromAnOlderBuild: 'keep me',
    })
    expect(history.list(ADDRESS, NETWORK)[0]!['legacyFieldFromAnOlderBuild']).toBe('keep me')
  })
})

describe('addEvmTransfer', () => {
  it('appends without de-duplicating — each send is its own transfer', () => {
    history.addEvmTransfer(ADDRESS, NETWORK, { transactionHash: '0xaaa', amount: '1' })
    history.addEvmTransfer(ADDRESS, NETWORK, { transactionHash: '0xaaa', amount: '1' })
    expect(history.list(ADDRESS, NETWORK)).toHaveLength(2)
  })

  it('strips the bulky receipt fields', () => {
    history.addEvmTransfer(ADDRESS, NETWORK, {
      transactionHash: '0xaaa',
      amount: '1',
      logs: ['huge'],
      logsBloom: '0x00',
      gasUsed: 21000,
      cumulativeGasUsed: 21000,
      transactionIndex: 0,
      contractAddress: null,
      to: '0xdef',
      root: '0x0',
    })

    const stored = history.list(ADDRESS, NETWORK)[0]!
    for (const field of ['logs', 'logsBloom', 'gasUsed', 'to', 'root']) {
      expect(stored[field], field).toBeUndefined()
    }
    expect(stored.amount).toBe('1')
  })

  it('does not mutate the caller object', () => {
    // The original used `delete` on its argument.
    const receipt = { transactionHash: '0xaaa', logs: ['x'] }
    history.addEvmTransfer(ADDRESS, NETWORK, receipt)
    expect(receipt.logs).toEqual(['x'])
  })

  it('strips effectiveGasPrice, another bigint field viem reports', () => {
    history.addEvmTransfer(ADDRESS, NETWORK, {
      transactionHash: '0xaaa',
      amount: '1',
      effectiveGasPrice: 1_000_000_000n,
    })

    expect(history.list(ADDRESS, NETWORK)[0]!.effectiveGasPrice).toBeUndefined()
  })

  it('survives a bigint field the noise list does not know by name', () => {
    // viem's TransactionReceipt can carry other bigint fields beyond the ones
    // RECEIPT_NOISE strips by name, and JSON.stringify cannot serialize a
    // bigint at all -- this used to crash the write right after the wallet
    // had already mined the transaction, with "Do not know how to serialize
    // a BigInt". Whatever slips past the strip list must degrade to a string
    // instead of taking the write down.
    expect(() =>
      history.addEvmTransfer(ADDRESS, NETWORK, {
        transactionHash: '0xaaa',
        amount: '1',
        someFutureBigintField: 42n,
      }),
    ).not.toThrow()

    expect(history.list(ADDRESS, NETWORK)[0]!.someFutureBigintField).toBe('42')
  })
})

describe('isAvailable', () => {
  it('is true for working storage', () => {
    expect(history.isAvailable()).toBe(true)
  })

  it('returns false rather than throwing when storage rejects writes', () => {
    // The original threw a ReferenceError here: its quota branch referenced an
    // undeclared `storage` variable.
    const failing = {
      ...fakeStorage(),
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
    } as unknown as Storage

    expect(new LocalTransferHistoryAdapter(failing).isAvailable()).toBe(false)
  })
})
