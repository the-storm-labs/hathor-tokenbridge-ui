// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountPageChrome } from './page-chrome.component'

const FOOTER = `
  <h1 id="title"></h1>
  <ul>
    <li><a id="network-navlink" href="./index.html?testnet">Use Testnet (Sepolia)</a></li>
    <li><a id="network-navlink-alt" href="./testnet-arb.html">Use Testnet (Arbitrum Sepolia)</a></li>
  </ul>
`

const link = (id: string) => document.getElementById(id) as HTMLAnchorElement
const shown = (id: string) => link(id).closest('li')!.style.display !== 'none'

describe('mountPageChrome footer links', () => {
  beforeEach(() => {
    document.body.innerHTML = FOOTER
    // jsdom's user agent is neither Chrome nor Firefox.
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('offers both testnets from mainnet', () => {
    mountPageChrome(document, 'mainnet')
    expect(link('network-navlink').getAttribute('href')).toBe('./index.html?testnet')
    expect(link('network-navlink-alt').getAttribute('href')).toBe('./testnet-arb.html')
    expect(shown('network-navlink-alt')).toBe(true)
  })

  it('does not link the Sepolia testnet to itself', () => {
    // ?testnet reuses index.html, so it inherits mainnet's markup.
    mountPageChrome(document, 'testnet')
    expect(link('network-navlink').textContent).toBe('Use Mainnet')
    expect(link('network-navlink').getAttribute('href')).toBe('./index.html')
    expect(link('network-navlink-alt').getAttribute('href')).toBe('./testnet-arb.html')
  })

  it('hides the second link on testnet-arb', () => {
    mountPageChrome(document, 'testnet-arb')
    expect(link('network-navlink').getAttribute('href')).toBe('./index.html')
    expect(shown('network-navlink-alt')).toBe(false)
  })

  it('tolerates a page without the second link', () => {
    document.getElementById('network-navlink-alt')!.closest('li')!.remove()
    expect(() => mountPageChrome(document, 'mainnet')).not.toThrow()
  })
})
