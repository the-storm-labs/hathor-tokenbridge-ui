import { describe, it, expect } from 'vitest'
import { findTokenByBridgeAddress } from './token-lookup'
import { tokensFor, findToken } from '../config/tokens'

const MAINNET = tokensFor('mainnet')
const USDC = findToken('mainnet', 'USDC')!
const AHTR = findToken('mainnet', 'aHTR')!

describe('findTokenByBridgeAddress', () => {
  it('matches the EVM token address', () => {
    expect(findTokenByBridgeAddress(MAINNET, USDC.evm!.address)).toBe(USDC)
  })

  it('matches the EVM side-token address', () => {
    // What the API reports as originalTokenAddress for a Hathor-origin transfer.
    expect(findTokenByBridgeAddress(MAINNET, AHTR.hathor.address)).toBe(AHTR)
  })

  it('matches the 0x-prefixed Hathor token uid', () => {
    expect(findTokenByBridgeAddress(MAINNET, USDC.hathor.hathorAddr)).toBe(USDC)
  })

  it('is case-insensitive, since addresses arrive in mixed checksums', () => {
    expect(findTokenByBridgeAddress(MAINNET, USDC.evm!.address.toLowerCase())).toBe(USDC)
    expect(findTokenByBridgeAddress(MAINNET, USDC.evm!.address.toUpperCase())).toBe(USDC)
  })

  it('returns null for an unknown address', () => {
    expect(findTokenByBridgeAddress(MAINNET, '0xdead')).toBeNull()
  })

  it('returns null for missing input instead of throwing', () => {
    expect(findTokenByBridgeAddress(MAINNET, null)).toBeNull()
    expect(findTokenByBridgeAddress(MAINNET, undefined)).toBeNull()
    expect(findTokenByBridgeAddress(MAINNET, '')).toBeNull()
  })

  it('skips tokens absent from either side', () => {
    // SLT7 and HTOG3 have no mainnet EVM entry; their empty Hathor placeholders
    // must not match an empty-ish lookup.
    expect(findTokenByBridgeAddress(MAINNET, '')).toBeNull()
    expect(MAINNET.filter((t) => t.evm === null)).toHaveLength(2)
  })
})
