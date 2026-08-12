import type { Container } from './container'
import type { UseCases } from './use-cases'
import { tokensFor } from '../config/tokens'
import { bindToasts, TOAST, type Toasts } from '../adapters/driving/ui/toasts'
import { refreshSelectpicker } from '../adapters/driving/ui/bootstrap-plugins'
import { mountTokenList } from '../adapters/driving/ui/components/token-list.component'
import {
  mountInfoPanel,
  type InfoPanel,
} from '../adapters/driving/ui/components/info-panel.component'
import {
  mountHathorTransferForm,
  HATHOR_FORM_EVENT,
  type HathorTransferForm,
} from '../adapters/driving/ui/components/hathor-transfer-form.component'
import {
  mountTransferHistory,
  type TransferHistory,
} from '../adapters/driving/ui/components/transfer-history.component'

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
  readonly history: TransferHistory
  /** Shows a failure in the shared error toast. */
  readonly reportError: (message: string) => void
}

export function mountUi(container: Container, useCases: UseCases, root: Document): MountedUi {
  const { store, deployment, route } = container
  const tokens = tokensFor(deployment)
  const getEvmAddress = () => store.getState().evmAddress

  const toasts = bindToasts(root, container.scheduler)

  /**
   * The one error channel the transfer flows share.
   *
   * Claim errors used to be written into #claimTab, which is permanently
   * hidden, so users never saw them at all.
   */
  const reportError = (message: string) => {
    const target = root.getElementById('alert-danger-text')
    if (target) target.textContent = message
    toasts.show(TOAST.transferError)
  }

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
    getEvmAddress,

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

  const history = mountTransferHistory(root, {
    route,
    getEvmAddress,
    reportError,
    loadHistory: useCases.loadTransferHistory,
    listStored: (address, network) => container.transferHistory.list(address, network),
    claim: useCases.claimTransfer,
    watchBlockNumber: useCases.watchBlockNumber,
  })

  // A Hathor-origin transfer has to appear before the next poll resolves it,
  // and it is keyed by its EVM destination — which is not necessarily the
  // connected account, since that form works without an EVM wallet.
  root.defaultView?.addEventListener(HATHOR_FORM_EVENT.transferSent, (event) => {
    const { evmDestination } = (event as CustomEvent<{ evmDestination: string }>).detail
    history.showStored(evmDestination)
    history.showTab('hathor', { reveal: true })
  })

  return { toasts, infoPanel, hathorForm, history, reportError }
}
