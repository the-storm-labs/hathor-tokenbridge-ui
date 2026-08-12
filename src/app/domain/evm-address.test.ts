import { describe, it, expect } from 'vitest'
import { isEvmAddress } from './evm-address'

describe('isEvmAddress', () => {
  it('accepts a well-formed address', () => {
    expect(isEvmAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')).toBe(true)
  })

  it('accepts all-lowercase and all-uppercase forms', () => {
    // No EIP-55 checksum check, by design — explorers hand out lowercase.
    expect(isEvmAddress('0x1c7d4b196cb0c7b01d743fbc6116a902379c7238')).toBe(true)
    expect(isEvmAddress('0x1C7D4B196CB0C7B01D743FBC6116A902379C7238')).toBe(true)
  })

  it('requires the 0x prefix', () => {
    expect(isEvmAddress('1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')).toBe(false)
  })

  it('requires exactly 40 hex characters', () => {
    expect(isEvmAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C72')).toBe(false)
    expect(isEvmAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238AB')).toBe(false)
  })

  it('rejects non-hex characters', () => {
    expect(isEvmAddress('0xZZ7D4B196Cb0C7B01d743Fbc6116a902379C7238')).toBe(false)
  })

  it('rejects surrounding whitespace', () => {
    // Pasted addresses often carry a trailing space; the form must not accept it.
    expect(isEvmAddress(' 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')).toBe(false)
    expect(isEvmAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 ')).toBe(false)
  })

  it('rejects empty input', () => {
    expect(isEvmAddress('')).toBe(false)
    expect(isEvmAddress(null)).toBe(false)
    expect(isEvmAddress(undefined)).toBe(false)
  })

  it('rejects a Hathor address', () => {
    expect(isEvmAddress('HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM')).toBe(false)
  })
})
