import type { Deployment } from '../../../../domain/model/deployment'

/**
 * The bits of the page that only depend on which deployment is loaded: the
 * title and the link to the other network.
 *
 * Small enough to be a function, kept as a component because it is the last
 * thing js/index.js's ready block did that belongs to nobody else. The
 * deployment is passed in rather than sniffed: the original read
 * `href.includes("testnet")`, which matched the word anywhere in the URL, so a
 * host or path containing it silently switched the whole app to testnet
 * contracts.
 */

const TITLES: Record<Deployment, string> = {
  mainnet: 'Hathor EVM bridge',
  testnet: 'Hathor Testnet bridge with Ethereum Sepolia',
}

/** Where the footer link points, and what it says. */
const OTHER_DEPLOYMENT: Record<Deployment, { label: string; href: string }> = {
  mainnet: { label: 'Use Testnet', href: './index.html?testnet' },
  testnet: { label: 'Use Mainnet', href: './index.html' },
}

export function mountPageChrome(root: Document, deployment: Deployment): void {
  const title = root.getElementById('title')
  if (title) title.textContent = TITLES[deployment]

  const link = root.getElementById('network-navlink')
  if (link) {
    const other = OTHER_DEPLOYMENT[deployment]
    link.textContent = other.label
    link.setAttribute('href', other.href)
  }

  warnOnUnsupportedBrowser(root.defaultView)
}

/** Preserved from the ready block; the wallet flows are only tested on these. */
function warnOnUnsupportedBrowser(view: Window | null): void {
  const agent = view?.navigator.userAgent ?? ''
  if (/chrom(e|ium)/i.test(agent) || agent.includes('Firefox')) return

  view?.alert('This site will only work correctly under chrome, chromium or firefox')
}
