import type { AddressCrypto } from '../../../domain/hathor-address'

/**
 * The two primitives Hathor address validation needs, taken from the CDN
 * globals `bs58` and `CryptoJS`.
 *
 * CryptoJS speaks in its own word-array type, so bytes go in and out as hex —
 * that translation is the only reason this adapter exists, and it is exactly the
 * kind of thing that should not be sitting in a use case. It lived in
 * legacy-bridge.ts until the write use cases needed address validation too.
 */
export class CdnCryptoAdapter implements AddressCrypto {
  decodeBase58(value: string): Uint8Array {
    return bs58.decode(value)
  }

  sha256(bytes: Uint8Array): Uint8Array {
    const digest = CryptoJS.enc.Hex.stringify(
      CryptoJS.SHA256(CryptoJS.enc.Hex.parse(toHex(bytes))),
    )

    return fromHex(digest)
  }
}

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16))
