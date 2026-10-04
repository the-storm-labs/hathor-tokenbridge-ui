import type { Container } from './container'
import type { UseCases } from './use-cases'
import { tokensFor } from '../config/tokens'
import { bindToasts, TOAST, type Toasts } from '../adapters/driving/ui/toasts'
import { mountTokenList } from '../adapters/driving/ui/components/token-list.component'
import { mountTokenSelect } from '../adapters/driving/ui/components/token-select.component'
import { bindButtonGroup } from '../adapters/driving/ui/button-group'
import { bindModalDismiss } from '../adapters/driving/ui/modal'
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
import {
  mountCrossTransferForm,
  CROSS_FORM_EVENT,
  type CrossTransferForm,
} from '../adapters/driving/ui/components/cross-transfer-form.component'
import {
  mountWalletHeader,
  WALLET_EVENT,
  type WalletHeader,
} from '../adapters/driving/ui/components/wallet-header.component'
import { mountPageChrome } from '../adapters/driving/ui/components/page-chrome.component'
import { mountThemeToggle } from '../adapters/driving/ui/components/theme-toggle.component'
import { routeForChainId } from '../config/networks'
import { validateHathorAddress } from '../domain/hathor-address'
import { AddressCryptoAdapter } from '../adapters/driven/crypto/address-crypto.adapter'

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
  readonly crossForm: CrossTransferForm
  readonly walletHeader: WalletHeader
  /** Shows a failure in the shared error toast. */
  readonly reportError: (message: string) => void
}

export function mountUi(container: Container, useCases: UseCases, root: Document): MountedUi {
  const { store, deployment, route } = container
  const tokens = tokensFor(deployment)
  const getEvmAddress = () => store.getState().evmAddress

  const toasts = bindToasts(root, container.scheduler)

  // The two icon dropdowns, built over the native selects that stay
  // authoritative. They replace bootstrap-select, and with it the last reason
  // jQuery, Popper and Bootstrap's JS were on the page.
  const crossTokenSelect = mountTokenSelect(root, 'tokenAddress', 'Select token')
  const hathorTokenSelect = mountTokenSelect(root, 'htrTokenSelect', 'Select token')

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
    tokenSelect: hathorTokenSelect,
    refreshBalance: useCases.refreshHathorBalance,
    sendTransfer: useCases.sendHathorTransfer,
    getEvmAddress,

    // The port is deployment-scoped; the form should not have to carry that.
    wallet: {
      connect: () => container.hathorWallet.connect(deployment),
      disconnect: () => container.hathorWallet.disconnect(),
      getAddress: () => container.hathorWallet.getAddress(),
      isConnected: () => container.hathorWallet.isConnected(),
      onSessionLost: (listener) => container.hathorWallet.onSessionLost(listener),
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

  const crossForm = mountCrossTransferForm(root, {
    tokens,
    route,
    toasts,
    reportError,
    getEvmAddress,
    tokenSelect: crossTokenSelect,
    getParameters: () => store.getState(),
    getTokenBalance: useCases.getTokenBalance,
    getMaxTransferable: useCases.getMaxTransferable,
    isApproved: useCases.checkAllowance,
    loadParameters: (tokenAddress) => infoPanel.refresh(tokenAddress),
    approve: useCases.approveSpend,
    cross: useCases.crossToken,
    isValidHathorAddress: (address) =>
      validateHathorAddress(address, deployment, new AddressCryptoAdapter()),
  })

  // Same reason as above, from the other direction: the record is written
  // locally before the bridge indexes it, and it is keyed by the account that
  // sent it.
  root.defaultView?.addEventListener(CROSS_FORM_EVENT.transferSent, () => {
    history.showStored()
    history.showTab('evm', { reveal: true })
  })

  const walletHeader = mountWalletHeader(root, {
    route,
    discoveredWallets: useCases.discoveredWallets,
    connect: useCases.connectEvmWallet,
    reconnect: useCases.reconnectEvmWallet,
    forget: useCases.forgetEvmWallet,
    walletEvents: useCases.walletEvents,
    adoptProvider: container.setProvider,
    routeForChainId: (chainId) => routeForChainId(chainId, deployment),
    setAccount: (evmAddress) => store.patch({ evmAddress }),
    setRoute: (connectedRoute) => store.patch({ route: connectedRoute }),
  })

  // What connecting means to the rest of the page. Each of these used to be a
  // line in a promise chain in index.js that named five functions across four
  // concerns; here every reaction sits next to the component it belongs to.
  root.defaultView?.addEventListener(WALLET_EVENT.connected, () => {
    crossForm.setEnabled(true)
    crossForm.populateTokens()
    // From storage first, so something is on screen before the poll resolves.
    history.showStored()
    history.start()
  })

  root.defaultView?.addEventListener(WALLET_EVENT.accountChanged, () => {
    // Straight from storage, so the table stops showing the previous account's
    // transfers before the next poll resolves the new one's.
    history.showStored()
  })

  root.defaultView?.addEventListener(WALLET_EVENT.disconnected, () => {
    crossForm.setEnabled(false)
    // The original left the poller running against a wallet that was gone.
    history.stop()
  })

  mountPageChrome(root, deployment)
  mountThemeToggle(root)

  // The two behaviours Bootstrap's JS provided beyond the dropdown: the active
  // class on the direction toggle, and the ways a modal closes.
  const directionToggle = root.getElementById('directionToggle')
  if (directionToggle) bindButtonGroup(directionToggle)

  const modal = root.getElementById('myModal')
  if (modal) bindModalDismiss(modal)

  return { toasts, infoPanel, hathorForm, history, crossForm, walletHeader, reportError }
}
