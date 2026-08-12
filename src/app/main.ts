import { UniversalConnector } from '@reown/appkit-universal-connector'
import { createContainer } from './composition/container'
import { installLegacyBridge } from './composition/legacy-bridge'
import { mountUi } from './composition/ui'
import { createUseCases } from './composition/use-cases'

/**
 * Entry point of the module graph, shared by index.html and testnet.html.
 *
 * Reown is imported here rather than assigned to `window.ReownAppKit` by a
 * separate script. That indirection existed only so a classic script could reach
 * it, and it was fragile: js/main.js statically imported this module, and static
 * imports are hoisted — so this ran *before* the assignment it depended on. Now
 * there is nothing to order.
 *
 * During the migration this runs alongside js/index.js: it publishes the
 * migrated pieces onto `window` so the legacy script keeps working, and that
 * shim shrinks with each phase until index.js is gone.
 *
 * Being a `type="module"` script guarantees this runs after every classic script
 * but before DOMContentLoaded — that is, before index.js's `$(document).ready`.
 */
const container = createContainer({
  // web3 is created by the wallet-connect flow in index.js and replaced on every
  // wallet or network switch, so the adapters read it per call.
  getWeb3: () => (window as unknown as { web3?: Web3Instance }).web3 ?? null,
  universalConnector: UniversalConnector as unknown as { init(options: unknown): Promise<never> },
})

// One set of use cases, driven by both halves of the app: the components
// mounted here and the legacy script that still owns the rest of the page.
const useCases = createUseCases(container)

const ui = mountUi(container, useCases, window.document)
installLegacyBridge(container, useCases, ui)

/**
 * Reattach to a persisted Hathor session and tell index.js about it.
 *
 * This used to be an IIFE inside the wallet module, which meant importing that
 * module had the side effect of opening a session. Driving it from the
 * composition root keeps the adapter inert until someone asks it for something.
 */
void (async () => {
  const session = await container.hathorWallet.restore(container.deployment)
  if (session?.address) {
    window.dispatchEvent(new CustomEvent('hathorWalletRestored', { detail: session }))
  }
})()
