import { describe, it, expect } from 'vitest'
import {
  toHathorTxId,
  truncateMiddle,
  matchLocalHathorTransfer,
  resolveOriginSender,
  isEvmSideAddress,
} from './tx-id'

describe('isEvmSideAddress', () => {
  it('distinguishes the two sides by the 0x prefix', () => {
    expect(isEvmSideAddress('0x89612c955624281a4B3aa41b8b2994A77EDAcEaD')).toBe(true)
    expect(isEvmSideAddress('HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM')).toBe(false)
  })

  it('treats missing input as not EVM', () => {
    expect(isEvmSideAddress(null)).toBe(false)
    expect(isEvmSideAddress(undefined)).toBe(false)
    expect(isEvmSideAddress('')).toBe(false)
  })
})

describe('resolveOriginSender', () => {
  const HATHOR = 'HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM'
  const RELAYER = '0x89612c955624281a4B3aa41b8b2994A77EDAcEaD'

  it('prefers a Hathor sender reported by the API', () => {
    expect(resolveOriginSender({ sender: HATHOR }, { sender: 'other' })).toBe(HATHOR)
  })

  it('prefers the locally captured sender over the relayer address', () => {
    // The regression this exists for: the API's relayer address is truthy, so
    // `remote.sender || local.sender` always won and the real sender was lost.
    expect(resolveOriginSender({ sender: RELAYER }, { sender: HATHOR })).toBe(HATHOR)
  })

  it('keeps the local sender across repeated polls', () => {
    // After the first merge the stored record carries the Hathor sender, and
    // the next poll must not undo that.
    const merged = { sender: resolveOriginSender({ sender: RELAYER }, { sender: HATHOR }) }
    expect(resolveOriginSender({ sender: RELAYER }, merged)).toBe(HATHOR)
  })

  it('falls back to the relayer address when nothing local exists', () => {
    // Transfers made before local history existed: there is genuinely nothing
    // better, and the table renders "Not available".
    expect(resolveOriginSender({ sender: RELAYER }, null)).toBe(RELAYER)
    expect(resolveOriginSender({ sender: RELAYER }, { sender: null })).toBe(RELAYER)
  })

  it('returns null when neither side has a sender', () => {
    expect(resolveOriginSender({}, null)).toBeNull()
    expect(resolveOriginSender({ sender: null }, { sender: null })).toBeNull()
  })
})

describe('toHathorTxId', () => {
  it('strips the API 0x prefix', () => {
    expect(toHathorTxId('0x00003b17e8d656e4612926d5d2c5a4d5b3e4536e')).toBe(
      '00003b17e8d656e4612926d5d2c5a4d5b3e4536e',
    )
  })

  it('leaves a bare id alone', () => {
    expect(toHathorTxId('00003b17')).toBe('00003b17')
  })

  it('only strips a leading prefix', () => {
    expect(toHathorTxId('ab0xcd')).toBe('ab0xcd')
  })

  it('returns null for missing input', () => {
    expect(toHathorTxId(null)).toBeNull()
    expect(toHathorTxId(undefined)).toBeNull()
    expect(toHathorTxId('')).toBeNull()
  })
})

describe('truncateMiddle', () => {
  it('shortens a long hash', () => {
    expect(truncateMiddle('0x1234567890abcdef1234567890abcdef')).toBe('0x123456...abcdef')
  })

  it('leaves short strings untouched', () => {
    expect(truncateMiddle('0x1234')).toBe('0x1234')
    // Exactly at the threshold (start + end + 3) it is not worth truncating.
    expect(truncateMiddle('12345678901234567')).toBe('12345678901234567')
  })

  it('honours custom lengths', () => {
    expect(truncateMiddle('0x1234567890abcdef1234567890abcdef', 4, 4)).toBe('0x12...cdef')
  })

  it('passes empty input through', () => {
    expect(truncateMiddle('')).toBe('')
  })
})

describe('matchLocalHathorTransfer', () => {
  // Stand-in for keccak256 — the real hasher is injected by the adapter.
  const hash = (v: string) => `hashed(${v})`

  it('matches on the bare origin id', () => {
    const local = [{ hathorTxId: 'abc123' }]
    expect(matchLocalHathorTransfer(local, { originTransactionHash: '0xabc123' }, hash)).toBe(
      local[0],
    )
  })

  it('matches on the hashed id in blockHash', () => {
    // The common case: the API omits originTransactionHash and identifies the
    // Hathor origin by keccak256(txId) in the blockHash slot. Before this was
    // handled, every such record became a duplicate row in the history table.
    const local = [{ hathorTxId: 'abc123' }]
    expect(matchLocalHathorTransfer(local, { blockHash: 'hashed(abc123)' }, hash)).toBe(local[0])
  })

  it('matches real mainnet data on blockHash', () => {
    // Verified against the live bridge: this Hathor transfer arrived with
    // originTransactionHash null, and keccak256 of its id equals the record's
    // blockHash. transactionHash is a different value entirely — matching on it
    // was the bug.
    const hathorTxId = '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532'
    const keccak = '0x289a0c69e8ccdb445018b43293ff03609cb05633c2590cb6c7753003f59d24ff'
    const local = [{ hathorTxId }]
    const remote = {
      originTransactionHash: null,
      transactionHash: '0x3649d02e31bc8ec0e0ca27c2968a38c49e3ab49ff19b8f36ef453a4c1c1441dd',
      backendTxHash: '0x3649d02e31bc8ec0e0ca27c2968a38c49e3ab49ff19b8f36ef453a4c1c1441dd',
      blockHash: keccak,
    }

    expect(matchLocalHathorTransfer(local, remote, () => keccak)).toBe(local[0])
  })

  it('still matches on the hashed id in backendTxHash', () => {
    const local = [{ hathorTxId: 'abc123' }]
    expect(matchLocalHathorTransfer(local, { backendTxHash: 'hashed(abc123)' }, hash)).toBe(
      local[0],
    )
  })

  it('matches on the hashed id in originTransactionHash', () => {
    const local = [{ hathorTxId: 'abc123' }]
    expect(matchLocalHathorTransfer(local, { originTransactionHash: 'hashed(abc123)' }, hash)).toBe(
      local[0],
    )
  })

  it('skips local records with no hathor id', () => {
    const local = [{ hathorTxId: null }, { hathorTxId: 'abc123' }]
    expect(matchLocalHathorTransfer(local, { originTransactionHash: '0xabc123' }, hash)).toBe(
      local[1],
    )
  })

  it('returns null when nothing matches', () => {
    expect(
      matchLocalHathorTransfer(
        [{ hathorTxId: 'abc123' }],
        { originTransactionHash: '0xdef' },
        hash,
      ),
    ).toBeNull()
    expect(matchLocalHathorTransfer([], { originTransactionHash: '0xabc' }, hash)).toBeNull()
  })

  it('does not match a local record against an empty remote', () => {
    expect(matchLocalHathorTransfer([{ hathorTxId: 'abc' }], {}, hash)).toBeNull()
  })
})
