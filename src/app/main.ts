import { createContainer } from './composition/container'
import { mountUi } from './composition/ui'
import { createUseCases } from './composition/use-cases'

/**
 * Entry point of the module graph, shared by index.html and testnet.html.
 *
 * Being a `type="module"` script, this runs after the document is parsed and
 * after every classic script — jQuery, Bootstrap and Web3 are all on the page —
 * but before DOMContentLoaded. So every element a component looks for already
 * exists, and nothing has to wait for a ready callback.
 */
const container = createContainer({
  /**
   * Reown's AppKit, loaded only when a Hathor wallet is actually connected.
   *
   * It is by far the largest thing this app depends on — the static import put
   * ~600 kB and a whole Lit runtime (which announces itself in the console) into
   * the first byte every visitor downloads, to serve the one flow that needs it.
   * The connector is already reached through an injected `init`, so deferring it
   * costs nothing: the adapter awaits it either way.
   */
  universalConnector: {
    init: async (options) => {
      const { UniversalConnector } = await import('@reown/appkit-universal-connector')
      return (UniversalConnector as unknown as { init(o: unknown): Promise<never> }).init(options)
    },
  },
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
  // A session that ran out is not the same as never having had one: the header
  // was about to show a wallet that cannot sign anything, so say why it did not.
  else if (session?.expired) ui.hathorForm.showDisconnected({ expired: true })
})()
