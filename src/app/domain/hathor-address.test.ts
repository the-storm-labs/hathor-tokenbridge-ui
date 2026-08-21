import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { validateHathorAddress, type AddressCrypto } from './hathor-address'

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Test-only base58 decoder. Reimplementing it here keeps the domain test free
 * of the library the adapter uses, so this exercises the algorithm rather than
 * @scure/base — see address-crypto.adapter.test.ts for the pairing that ships.
 */
function decodeBase58(value: string): Uint8Array {
  const bytes: number[] = [0]

  for (const char of value) {
    const digit = BASE58_ALPHABET.indexOf(char)
    if (digit === -1) throw new Error(`invalid base58 character: ${char}`)

    let carry = digit
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58
      bytes[i] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Each leading '1' encodes one leading zero byte.
  for (const char of value) {
    if (char !== '1') break
    bytes.push(0)
  }

  return Uint8Array.from(bytes.reverse())
}

const crypto: AddressCrypto = {
  decodeBase58,
  sha256: (bytes) => Uint8Array.from(createHash('sha256').update(bytes).digest()),
}

// Real addresses, taken from live Hathor transactions on each network.
const MAINNET_ADDRESSES = [
  'HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM',
  'HNgHyjsUsvFYSbkbYrnCZdZTj84SGyasdZ',
  'H9aaXD76XWvqejpSfiBfnGXsTVXY3EyQFV',
  'hQj6skwZY9RT3bRvFuRjioJP5ZbLSRYeuD', // the bridge deposit address
]
const TESTNET_ADDRESSES = [
  'WewDeXWyvHP7jJTs7tjLoQfoB72LLxJQqN',
  'wYr7GUqHFDCan2WBN1f6JPJYUWPtpVhb22', // the bridge deposit address
]

describe('validateHathorAddress', () => {
  it('accepts real mainnet addresses on mainnet', () => {
    for (const address of MAINNET_ADDRESSES) {
      expect(validateHathorAddress(address, 'mainnet', crypto), address).toBe(true)
    }
  })

  it('accepts real testnet addresses on testnet', () => {
    for (const address of TESTNET_ADDRESSES) {
      expect(validateHathorAddress(address, 'testnet', crypto), address).toBe(true)
    }
  })

  it('rejects an address from the other network', () => {
    // The checksum is valid but the prefix belongs to the other network. This is
    // the check that stops funds being sent into the void.
    for (const address of MAINNET_ADDRESSES) {
      expect(validateHathorAddress(address, 'testnet', crypto), address).toBe(false)
    }
    for (const address of TESTNET_ADDRESSES) {
      expect(validateHathorAddress(address, 'mainnet', crypto), address).toBe(false)
    }
  })

  it('rejects an address with a corrupted checksum', () => {
    const [valid] = MAINNET_ADDRESSES
    const corrupted = valid!.slice(0, -1) + (valid!.endsWith('M') ? 'N' : 'M')
    expect(validateHathorAddress(corrupted, 'mainnet', crypto)).toBe(false)
  })

  it('rejects malformed input instead of throwing', () => {
    for (const bad of ['', 'not-an-address', '0OIl', 'H', 'HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4N']) {
      expect(validateHathorAddress(bad, 'mainnet', crypto), bad).toBe(false)
    }
  })

  it('rejects an EVM address', () => {
    expect(
      validateHathorAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', 'mainnet', crypto),
    ).toBe(false)
  })
})
