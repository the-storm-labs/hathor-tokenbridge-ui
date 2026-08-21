// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { tokenListMarkup, mountTokenList } from './token-list.component'
import { ROUTES } from '../../../../config/networks'
import { tokensFor } from '../../../../config/tokens'
import type { Token } from '../../../../domain/model/token'

const route = ROUTES.mainnet

const onBothSides: Token = {
  key: 'USDC',
  name: 'USDC',
  icon: './assets/img/usdc.png',
  evm: { symbol: 'USDC', address: '0xAF88D065E77C8CC2239327C5EDB3A432268E5831', decimals: 6 },
  hathor: {
    symbol: 'hUSDC',
    address: '0x66981C5a01db0Df1De03A5Af4493437B98F5D49c',
    hathorAddr: '0x00003B17',
    pureHtrAddress: '00003B17',
    decimals: 2,
  },
}

const evmOnly: Token = {
  ...onBothSides,
  key: 'ONLY',
  hathor: { symbol: '', address: '', hathorAddr: '', pureHtrAddress: '', decimals: 0 },
}

const hathorOnly: Token = { ...onBothSides, key: 'HTOG3', evm: null }

describe('tokenListMarkup', () => {
  it('names the EVM network on the left and Hathor on the right', () => {
    const html = tokenListMarkup([], route)
    expect(html.indexOf('Arbitrum One')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('Arbitrum One')).toBeLessThan(html.indexOf('Hathor Mainnet'))
  })

  it('links each side to its own explorer, lowercased', () => {
    const html = tokenListMarkup([onBothSides], route)
    expect(html).toContain('https://arbiscan.io/address/0xaf88d065e77c8cc2239327c5edb3a432268e5831')
    expect(html).toContain('https://explorer.hathor.network/token_detail/00003b17')
  })

  it('shows both symbols for the same token', () => {
    const html = tokenListMarkup([onBothSides], route)
    expect(html).toContain('USDC')
    expect(html).toContain('hUSDC')
  })

  it('skips a token that is not on this deployment EVM chain', () => {
    // The dropdown skips these too; a row linking to a contract that does not
    // exist here would just be a broken link.
    const html = tokenListMarkup([hathorOnly], route)
    expect(html).not.toContain('token_detail')
  })

  it('still lists a token that has no Hathor side', () => {
    // Matches the original filter, which only tested the EVM half.
    const html = tokenListMarkup([evmOnly], route)
    expect(html).toContain('arbiscan.io/address/')
  })
})

describe('mountTokenList', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tokenListTab"></div>'
  })

  it('renders every mainnet token that has an EVM address', () => {
    mountTokenList(document, tokensFor('mainnet'), route)

    const expected = tokensFor('mainnet').filter((token) => token.evm !== null).length
    expect(document.querySelectorAll('#tokenListTab .fa-arrows-alt-h')).toHaveLength(expected)
  })

  it('does nothing when the page has no token list', () => {
    document.body.innerHTML = ''
    expect(() => mountTokenList(document, tokensFor('mainnet'), route)).not.toThrow()
  })
})
