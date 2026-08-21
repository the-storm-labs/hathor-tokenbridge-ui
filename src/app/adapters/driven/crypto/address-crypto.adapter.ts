import { sha256 } from '@noble/hashes/sha2.js'
import { base58 } from '@scure/base'
import type { AddressCrypto } from '../../../domain/hathor-address'

/**
 * The two primitives Hathor address validation needs.
 *
 * Both used to come from CDN globals — `bs58` from a vendored script and SHA-256
 * from CryptoJS — which made this adapter mostly a translation layer: CryptoJS
 * speaks in its own word-array type, so bytes went out as hex and came back as
 * hex on every call. These libraries speak `Uint8Array`, so the translation is
 * gone and what is left is the mapping itself.
 *
 * Same libraries viem already depends on, so they add nothing to the bundle that
 * was not there.
 */
export class AddressCryptoAdapter implements AddressCrypto {
  /** Throws on characters outside the alphabet; the domain treats that as invalid. */
  decodeBase58(value: string): Uint8Array {
    return base58.decode(value)
  }

  sha256(bytes: Uint8Array): Uint8Array {
    return sha256(bytes)
  }
}
