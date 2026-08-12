import { describe, it, expect } from 'vitest'
import { tokensFor, findToken } from './tokens'
import { isOnEvm, isOnHathor } from '../domain/model/token'
import type { Deployment } from '../domain/model/deployment'

const DEPLOYMENTS: Deployment[] = ['mainnet', 'testnet']

describe('token table shape', () => {
  it('exposes the same token keys on both deployments', () => {
    expect(tokensFor('mainnet').map((t) => t.key)).toEqual(['USDC', 'SLT7', 'aHTR', 'HTOG3'])
    expect(tokensFor('testnet').map((t) => t.key)).toEqual(['USDC', 'SLT7', 'aHTR', 'HTOG3'])
  })

  it('always provides a Hathor object, even when unavailable', () => {
    // populateHtrTokenDropdown reads token.hathor.pureHtrAddress unguarded, so
    // a null here would throw rather than skip.
    for (const deployment of DEPLOYMENTS) {
      for (const token of tokensFor(deployment)) {
        expect(token.hathor, `${deployment}/${token.key}`).toBeTypeOf('object')
        expect(token.hathor).not.toBeNull()
      }
    }
  })

  it('gives every EVM-available token a valid address and decimals', () => {
    for (const deployment of DEPLOYMENTS) {
      for (const token of tokensFor(deployment)) {
        if (!isOnEvm(token)) continue
        expect(token.evm.address, `${deployment}/${token.key}`).toMatch(/^0x[0-9a-fA-F]{40}$/)
        expect(token.evm.decimals).toBeGreaterThan(0)
        expect(token.evm.symbol).not.toBe('')
      }
    }
  })

  it('gives every Hathor-available token a 64-char UID, or "00" for native HTR', () => {
    for (const deployment of DEPLOYMENTS) {
      for (const token of tokensFor(deployment)) {
        if (!isOnHathor(token)) continue
        const uid = token.hathor.pureHtrAddress
        expect(uid === '00' || /^[0-9a-f]{64}$/.test(uid), `${deployment}/${token.key}: ${uid}`).toBe(
          true,
        )
        // hathorAddr is the same UID, 0x-prefixed — except native HTR, which is
        // '00' in both fields.
        expect(token.hathor.hathorAddr).toBe(uid === '00' ? '00' : `0x${uid}`)
      }
    }
  })
})

describe('per-deployment availability', () => {
  it('exposes only USDC and aHTR on the mainnet EVM chain', () => {
    // SLT7 and HTOG3 never had a 42161 entry, so the mainnet dropdown skips
    // them. This is pre-existing behaviour, pinned here so it cannot change by
    // accident.
    expect(tokensFor('mainnet').filter(isOnEvm).map((t) => t.key)).toEqual(['USDC', 'aHTR'])
  })

  it('exposes all four on the testnet EVM chain', () => {
    expect(tokensFor('testnet').filter(isOnEvm).map((t) => t.key)).toEqual([
      'USDC',
      'SLT7',
      'aHTR',
      'HTOG3',
    ])
  })

  it('offers only USDC and native HTR for HTR→ARB on mainnet', () => {
    expect(tokensFor('mainnet').filter(isOnHathor).map((t) => t.key)).toEqual(['USDC', 'aHTR'])
  })
})

describe('Hathor-side precision', () => {
  it('declares a usable precision for every bridgeable token', () => {
    // This field drives the amount input, the balance display and the value
    // actually sent. A missing or absurd value would corrupt all three.
    for (const deployment of DEPLOYMENTS) {
      for (const token of tokensFor(deployment)) {
        if (!isOnHathor(token)) continue
        const { decimals } = token.hathor
        expect(Number.isInteger(decimals), `${deployment}/${token.key}`).toBe(true)
        expect(decimals).toBeGreaterThan(0)
        expect(decimals).toBeLessThanOrEqual(18)
      }
    }
  })

  it('uses the measured Hathor precision, not the EVM one', () => {
    // Measured on-chain: 5 hUSDC is `value: 500` and 2 HTR is `value: 200`, so
    // Hathor is 2 decimals. USDC is 6 on Arbitrum — the two sides genuinely
    // differ, and copying evm.decimals here (as the original did) is a bug.
    const usdc = findToken('mainnet', 'USDC')!
    expect(usdc.hathor.decimals).toBe(2)
    expect(usdc.evm?.decimals).toBe(6)

    const htr = findToken('mainnet', 'aHTR')!
    expect(htr.hathor.decimals).toBe(2)
    expect(htr.evm?.decimals).toBe(18)
  })

  it('currently reports 2 for every Hathor token', () => {
    // Hathor v1 tokens are all 2-decimal and the node exposes no decimals field.
    // If this ever fails because a token legitimately differs, update the value
    // here — no other code should need to change.
    for (const deployment of DEPLOYMENTS) {
      for (const token of tokensFor(deployment)) {
        if (!isOnHathor(token)) continue
        expect(token.hathor.decimals, `${deployment}/${token.key}`).toBe(2)
      }
    }
  })
})

describe('verified on-chain facts', () => {
  it('keeps the mainnet hUSDC UID that resolves on the Hathor mainnet node', () => {
    // Checked against node1.mainnet.hathor.network: this UID is "Hathor USDC"
    // (hUSDC), and the bridge deposit address holds a real balance of it.
    //
    // In the original, USDC's ternary read `!isTestnet ? A : B` while every
    // other token read `isTestnet ? A : B`. That inconsistent *ordering* looked
    // like an inverted mapping but was not — the values were correct. This test
    // pins the fact so the question does not get re-litigated.
    expect(findToken('mainnet', 'USDC')?.hathor.pureHtrAddress).toBe(
      '00003b17e8d656e4612926d5d2c5a4d5b3e4536e6bebc61c76cb71a65b81986f',
    )
  })

  it('treats native HTR as UID "00" on both deployments', () => {
    for (const deployment of DEPLOYMENTS) {
      expect(findToken(deployment, 'aHTR')?.hathor.pureHtrAddress).toBe('00')
    }
  })
})

describe('findToken', () => {
  it('finds by key', () => {
    expect(findToken('mainnet', 'USDC')?.name).toBe('USDC')
  })

  it('returns null for an unknown key', () => {
    expect(findToken('mainnet', 'NOPE')).toBeNull()
  })
})
