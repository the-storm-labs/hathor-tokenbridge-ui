import { describe, it, expect } from 'vitest'
import { AddressCryptoAdapter } from './address-crypto.adapter'
import { validateHathorAddress } from '../../../domain/hathor-address'

const crypto = new AddressCryptoAdapter()

/** Real addresses off the Hathor mainnet, including the bridge's own deposit. */
const MAINNET = [
  'hQj6skwZY9RT3bRvFuRjioJP5ZbLSRYeuD',
  'HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM',
  'HRzDMfYveGWuKXT4EQ1q2Yy2chC4eQoPLp',
]

describe('the real adapter against real addresses', () => {
  it('accepts every mainnet address', () => {
    // The domain test drives a hand-written decoder; this is the pairing that
    // actually ships, so it is the one that proves the libraries agree with
    // Hathor about the alphabet and the double-SHA256 checksum.
    for (const address of MAINNET) {
      expect(validateHathorAddress(address, 'mainnet', crypto), address).toBe(true)
    }
  })

  it('rejects a mainnet address on testnet, and the reverse', () => {
    expect(validateHathorAddress(MAINNET[0]!, 'testnet', crypto)).toBe(false)
    expect(validateHathorAddress('wYr7GUqHFDCan2WBN1f6JPJYUWPtpVhb22', 'mainnet', crypto)).toBe(
      false,
    )
  })

  it('rejects an address with a corrupted checksum', () => {
    const tampered = `${MAINNET[1]!.slice(0, -1)}X`
    expect(validateHathorAddress(tampered, 'mainnet', crypto)).toBe(false)
  })

  it('treats characters outside the base58 alphabet as invalid', () => {
    // The decoder throws on these; the domain catches, so a typo cannot take
    // down the form that validates as you type.
    expect(validateHathorAddress('H0OIl+not-base58', 'mainnet', crypto)).toBe(false)
    expect(validateHathorAddress('', 'mainnet', crypto)).toBe(false)
  })

  it('decodes to the 25 bytes Hathor uses: 21 of payload plus 4 of checksum', () => {
    expect(crypto.decodeBase58(MAINNET[0]!)).toHaveLength(25)
  })
})
