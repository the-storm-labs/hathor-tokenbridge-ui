import { UniversalConnector } from '@reown/appkit-universal-connector'
import { createContainer } from './composition/container'
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
 * Being a `type="module"` script, this runs after the document is parsed and
 * after every classic script — jQuery, Bootstrap and Web3 are all on the page —
 * but before DOMContentLoaded. So every element a component looks for already
 * exists, and nothing has to wait for a ready callback.
 */
const container = createContainer({
  universalConnector: UniversalConnector as unknown as { init(options: unknown): Promise<never> },
})

const ui = mountUi(container, createUseCases(container), window.document)

// Reconnect after mounting, so every component is listening before the first
// connection event is published.
void ui.walletHeader.reconnect()

/**
 * Reattach to a persisted Hathor session and show the form as connected.
 *
 * This used to be an IIFE inside the wallet module, which meant importing that
 * module had the side effect of opening a session. Driving it from the
 * composition root keeps the adapter inert until someone asks it for something.
 *
 * The result used to travel as a `hathorWalletRestored` window event that
 * index.js re-implemented the whole connected state from. The form owns that
 * state now, so this hands it the address and the form announces it.
 */
void (async () => {
  const session = await container.hathorWallet.restore(container.deployment)
  if (session?.address) ui.hathorForm.showConnected(session.address)
})()
