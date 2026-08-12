import type { Deployment } from './model/deployment'

/**
 * Hathor address validation: base58 decode, double-SHA256 checksum, and the
 * network prefix.
 *
 * The original read the global `isTestnet` and reached for the `bs58` and
 * `CryptoJS` CDN globals directly, which made it both untestable and silently
 * coupled to script load order. Both are parameters now.
 */

/**
 * The two primitives this needs from outside. Supplied by
 * AddressCryptoAdapter in the browser and by node:crypto in tests — the
 * algorithm itself is what matters and it lives here.
 */
export interface AddressCrypto {
  /** Throws or returns a short array for malformed input; both are handled. */
  decodeBase58(value: string): Uint8Array | number[]
  sha256(bytes: Uint8Array): Uint8Array
}

/** Hathor addresses are 21 payload bytes followed by a 4-byte checksum. */
const ADDRESS_BYTE_LENGTH = 25
const CHECKSUM_BYTE_LENGTH = 4

const VALID_PREFIXES: Record<Deployment, readonly string[]> = {
  mainnet: ['H', 'h'],
  testnet: ['W', 'w'],
}

export function validateHathorAddress(
  address: string,
  deployment: Deployment,
  crypto: AddressCrypto,
): boolean {
  try {
    const bytes = Uint8Array.from(crypto.decodeBase58(address))
    if (bytes.length !== ADDRESS_BYTE_LENGTH) return false

    const payload = bytes.slice(0, -CHECKSUM_BYTE_LENGTH)
    const checksum = bytes.slice(-CHECKSUM_BYTE_LENGTH)
    const expected = crypto.sha256(crypto.sha256(payload)).slice(0, CHECKSUM_BYTE_LENGTH)

    for (let i = 0; i < CHECKSUM_BYTE_LENGTH; i++) {
      if (checksum[i] !== expected[i]) return false
    }

    return VALID_PREFIXES[deployment].includes(address.charAt(0))
  } catch {
    // Invalid base58 characters make the decoder throw.
    return false
  }
}
