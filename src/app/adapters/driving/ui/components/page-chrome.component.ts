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
  'testnet-arb': 'Hathor Testnet bridge with Arbitrum Sepolia',
}

interface FooterLink {
  readonly label: string
  readonly href: string
}

const MAINNET_LINK: FooterLink = { label: 'Use Mainnet', href: './index.html' }
const TESTNET_LINK: FooterLink = { label: 'Use Testnet (Sepolia)', href: './index.html?testnet' }
const TESTNET_ARB_LINK: FooterLink = {
  label: 'Use Testnet (Arbitrum Sepolia)',
  href: './testnet-arb.html',
}

/**
 * Where the footer links point, and what they say: `#network-navlink` and
 * `#network-navlink-alt`. A `null` hides the second one's `<li>`.
 *
 * `testnet` is not a page of its own — `?testnet` reuses index.html — so it has
 * to set both links, or it would keep mainnet's "Use Testnet (Sepolia)" and
 * link to itself.
 */
const OTHER_DEPLOYMENTS: Record<Deployment, readonly [FooterLink, FooterLink | null]> = {
  mainnet: [TESTNET_LINK, TESTNET_ARB_LINK],
  testnet: [MAINNET_LINK, TESTNET_ARB_LINK],
  'testnet-arb': [MAINNET_LINK, null],
}

export function mountPageChrome(root: Document, deployment: Deployment): void {
  const title = root.getElementById('title')
  if (title) title.textContent = TITLES[deployment]

  const [primary, alternate] = OTHER_DEPLOYMENTS[deployment]
  setFooterLink(root.getElementById('network-navlink'), primary)
  setFooterLink(root.getElementById('network-navlink-alt'), alternate)

  warnOnUnsupportedBrowser(root.defaultView)
}

function setFooterLink(anchor: HTMLElement | null, link: FooterLink | null): void {
  if (!anchor) return
  const item = anchor.closest('li') ?? anchor
  if (!link) {
    item.style.display = 'none'
    return
  }
  item.style.display = ''
  anchor.textContent = link.label
  anchor.setAttribute('href', link.href)
}

/** Preserved from the ready block; the wallet flows are only tested on these. */
function warnOnUnsupportedBrowser(view: Window | null): void {
  const agent = view?.navigator.userAgent ?? ''
  if (/chrom(e|ium)/i.test(agent) || agent.includes('Firefox')) return

  view?.alert('This site will only work correctly under chrome, chromium or firefox')
}
