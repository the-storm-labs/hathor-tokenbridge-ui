import type { Deployment } from '../domain/model/deployment'

/**
 * Resolves which deployment the page is running as.
 *
 * Replaces `window.location.href.includes('testnet')`, which was written out
 * separately in index.js and hathor-wallet.js and matched anything anywhere in
 * the URL — including a host or path that merely contained the word.
 *
 * Precedence deliberately preserves today's reachable entry points:
 *  1. `?testnet` query param — the footer link points at `./index.html?testnet`
 *  2. `<html data-deployment="...">` — set per HTML file (added in Phase 3)
 *  3. the filename `testnet.html`
 *  4. otherwise mainnet
 */
export function resolveDeployment(location: Location, document: Document): Deployment {
  const params = new URLSearchParams(location.search)
  if (params.has('testnet')) return 'testnet'

  const declared = document.documentElement.dataset['deployment']
  if (declared === 'testnet' || declared === 'mainnet') return declared

  if (location.pathname.endsWith('testnet.html')) return 'testnet'

  return 'mainnet'
}
