import type { Container } from './container'
import type { UseCases } from './use-cases'
import { tokensFor } from '../config/tokens'
import { bindToasts, type Toasts } from '../adapters/driving/ui/toasts'
import { refreshSelectpicker } from '../adapters/driving/ui/bootstrap-plugins'
import { mountTokenList } from '../adapters/driving/ui/components/token-list.component'
import {
  mountInfoPanel,
  type InfoPanel,
} from '../adapters/driving/ui/components/info-panel.component'
import {
  mountHathorTransferForm,
  type HathorTransferForm,
} from '../adapters/driving/ui/components/hathor-transfer-form.component'

/**
 * Mounts the driving adapters — the components that own a piece of the page.
 *
 * The counterpart of container.ts: that one decides which adapter satisfies
 * which driven port, this one decides which component owns which part of the
 * DOM. It grows as phase 8 moves markup out of js/index.js, and when the last
 * component lands here the legacy script and its shim are deleted.
 *
 * Called from a `type="module"` script, which runs after the document is parsed
 * and before `DOMContentLoaded` — so every element already exists, and every
 * component is mounted before jQuery's ready block runs.
 */
export interface MountedUi {
  readonly toasts: Toasts
  readonly infoPanel: InfoPanel
  readonly hathorForm: HathorTransferForm
}

export function mountUi(container: Container, useCases: UseCases, root: Document): MountedUi {
  const { store, deployment, route } = container
  const tokens = tokensFor(deployment)

  const toasts = bindToasts(root, container.scheduler)

  mountTokenList(root, tokens, route)

  const infoPanel = mountInfoPanel(root, {
    route,
    loadParameters: useCases.loadBridgeParameters,
  })

  const hathorForm = mountHathorTransferForm(root, {
    tokens,
    toasts,
    refreshSelect: refreshSelectpicker,
    refreshBalance: useCases.refreshHathorBalance,
    sendTransfer: useCases.sendHathorTransfer,
    getEvmAddress: () => store.getState().evmAddress,

    // The port is deployment-scoped; the form should not have to carry that.
    wallet: {
      connect: () => container.hathorWallet.connect(deployment),
      disconnect: () => container.hathorWallet.disconnect(),
      getAddress: () => container.hathorWallet.getAddress(),
      isConnected: () => container.hathorWallet.isConnected(),
    },

    // Reading the limits needs contracts, so it needs a wallet on a supported
    // chain. `route` in the store is null until then. The legacy handler did
    // not check and threw a TypeError on `config.networkId` whenever a Hathor
    // token was selected without an EVM wallet.
    showTokenInfo: (token) => {
      if (token.evm && store.getState().route) void infoPanel.refresh(token.evm.address)
    },
  })

  return { toasts, infoPanel, hathorForm }
}
