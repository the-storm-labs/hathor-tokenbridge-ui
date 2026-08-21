import { describe, it, expect } from 'vitest'
import { ROUTES, routeForChainId, expectedChainId } from './networks'

describe('ROUTES', () => {
  it('is acyclic and serialisable', () => {
    // The original config objects had crossToNetwork back-references patched in,
    // making them circular. This is the regression guard.
    expect(() => JSON.stringify(ROUTES)).not.toThrow()
  })

  it('pairs each deployment with the right chains', () => {
    expect(ROUTES.mainnet.evm.chainId).toBe(42161)
    expect(ROUTES.mainnet.evm.name).toBe('Arbitrum One')
    expect(ROUTES.testnet.evm.chainId).toBe(11155111)
    expect(ROUTES.testnet.evm.name).toBe('Sepolia')
  })

  it('gives both deployments a Hathor deposit address', () => {
    // An empty one here would send HTR→ARB transfers into the void.
    expect(ROUTES.mainnet.hathor.bridgeHathorAddress).toBe('hQj6skwZY9RT3bRvFuRjioJP5ZbLSRYeuD')
    expect(ROUTES.testnet.hathor.bridgeHathorAddress).toBe('wYr7GUqHFDCan2WBN1f6JPJYUWPtpVhb22')
  })

  it('uses network-appropriate Hathor address prefixes', () => {
    // Mainnet addresses start with H/h, testnet with W/w. Crossing them would
    // be unrecoverable.
    expect(ROUTES.mainnet.hathor.bridgeHathorAddress[0]).toMatch(/[Hh]/)
    expect(ROUTES.testnet.hathor.bridgeHathorAddress[0]).toMatch(/[Ww]/)
  })

  it('gives every EVM network its three contract addresses', () => {
    for (const route of Object.values(ROUTES)) {
      for (const field of ['bridge', 'allowTokens', 'federation'] as const) {
        expect(route.evm[field], `${route.deployment}.${field}`).toMatch(/^0x[0-9a-fA-F]{40}$/)
      }
    }
  })

  it('keeps the two deployments on distinct contracts', () => {
    expect(ROUTES.mainnet.evm.bridge).not.toBe(ROUTES.testnet.evm.bridge)
    expect(ROUTES.mainnet.hathor.federation).not.toBe(ROUTES.testnet.hathor.federation)
  })
})

describe('routeForChainId', () => {
  it('resolves the deployment chain', () => {
    expect(routeForChainId(42161, 'mainnet')).toBe(ROUTES.mainnet)
    expect(routeForChainId(11155111, 'testnet')).toBe(ROUTES.testnet)
  })

  it('rejects the other deployment chain', () => {
    // Sepolia on the mainnet page must be "Wrong Network", not a silent switch.
    expect(routeForChainId(11155111, 'mainnet')).toBeNull()
    expect(routeForChainId(42161, 'testnet')).toBeNull()
  })

  it('rejects an unknown chain', () => {
    expect(routeForChainId(1, 'mainnet')).toBeNull()
    expect(routeForChainId(137, 'testnet')).toBeNull()
  })
})

describe('expectedChainId', () => {
  it('reports the chain the wallet should be on', () => {
    expect(expectedChainId('mainnet')).toBe(42161)
    expect(expectedChainId('testnet')).toBe(11155111)
  })
})
