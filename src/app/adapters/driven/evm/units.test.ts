import { describe, it, expect } from 'vitest'
import { fromWei, keccak256Text } from './units'

describe('fromWei', () => {
  it('trims trailing zeros the way web3 did', () => {
    // Callers parseInt or BigNumber the result, so '1.000000000000000000'
    // would still compute correctly and only look wrong once rendered.
    expect(fromWei('1000000000000000000')).toBe('1')
    expect(fromWei('1500000000000000000')).toBe('1.5')
    expect(fromWei('100000000000000000000000')).toBe('100000')
  })

  it('keeps the smallest unit rather than rounding it away', () => {
    expect(fromWei('1')).toBe('0.000000000000000001')
  })

  it('reports zero for a contract read that came back empty', () => {
    // BigInt('') throws, and a thrown conversion here would take down a whole
    // history load over a value nothing can be done with anyway.
    expect(fromWei('')).toBe('0')
    expect(fromWei('0')).toBe('0')
  })
})

describe('keccak256Text', () => {
  it('hashes the id as text, which is the form the bridge used', () => {
    // Verified against live mainnet records: the ones that omit
    // originTransactionHash carry keccak256(utf8(bare id)) in blockHash.
    const id = '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532'
    expect(keccak256Text(id)).toBe(
      '0x289a0c69e8ccdb445018b43293ff03609cb05633c2590cb6c7753003f59d24ff',
    )
  })

  it('is not the same as hashing the id as bytes', () => {
    // The two forms both appear in the wild — the federation uses the bytes
    // form on records it reports with an id — so mixing them up matches
    // nothing and fails silently.
    const id = '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532'
    expect(keccak256Text(id)).not.toBe(keccak256Text(`0x${id}`))
  })
})
