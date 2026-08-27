import { describe, it, expect } from 'vitest'
import { parseEip7702Delegate } from './eip7702'

// 20 bytes, built rather than hand-counted so the fixture can't drift off the
// designator's exact length by a stray or missing zero.
const DELEGATE = `0x${'00'.repeat(19)}ad`

describe('parseEip7702Delegate', () => {
  it('returns null for no code', () => {
    expect(parseEip7702Delegate(null)).toBeNull()
    expect(parseEip7702Delegate(undefined)).toBeNull()
    expect(parseEip7702Delegate('')).toBeNull()
  })

  it('returns null for a plain EOA (bare "0x")', () => {
    expect(parseEip7702Delegate('0x')).toBeNull()
  })

  it('extracts the delegate address from a designator', () => {
    expect(parseEip7702Delegate(`0xef0100${DELEGATE.slice(2)}`)).toBe(DELEGATE)
  })

  it('is case-insensitive on both the prefix and the address', () => {
    expect(parseEip7702Delegate(`0xEF0100${DELEGATE.slice(2).toUpperCase()}`)).toBe(DELEGATE)
  })

  it('returns null for a real contract — right length range, wrong prefix', () => {
    // A minimal but real contract's runtime code, coincidentally not this length,
    // plus a same-length string that just doesn't start with ef0100.
    expect(parseEip7702Delegate(`0xaaaaaa${DELEGATE.slice(2)}`)).toBeNull()
  })

  it('returns null when the prefix matches but the length does not', () => {
    expect(parseEip7702Delegate('0xef0100')).toBeNull()
    expect(parseEip7702Delegate(`0xef0100${DELEGATE.slice(2)}00`)).toBeNull()
  })
})
