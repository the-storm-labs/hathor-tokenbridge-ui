import { truncateMiddle } from '../../../../domain/tx-id'
import type { BridgeRoute } from '../../../../domain/model/network'
import type {
  DiscoveredWallet,
  Eip1193Provider,
  EvmConnection,
  EvmWalletEvents,
} from '../../../../ports/driven/evm-wallet.port'
import type { ReconnectedWallet } from '../../../../application/use-cases/connect-evm-wallet'
import { hideModal, showModal } from '../modal'

/**
 * The EVM wallet: the connect button, the wallet picker, the address and
 * network readout, and the network check.
 *
 * The last component of phase 8, and the one that lets js/index.js go. It owns
 * the whole connection lifecycle — pick, connect, reconnect on the next visit,
 * account switch, chain switch, disconnect — and reports each outcome as an
 * event. Nothing else has to know how a wallet is reached.
 *
 * The web3 instance is no longer built here and left on `window` for adapters to
 * read back: the provider is handed to the container, which owns it.
 */

/** Events this component publishes on the window. */
export const WALLET_EVENT = {
  /** detail: `{ address, route }` — connected on a chain this deployment bridges. */
  connected: 'evmwallet:connected',
  /** detail: `{ address }` — the account changed while staying connected. */
  accountChanged: 'evmwallet:accountchanged',
  /** No detail. Disconnected, refused, or on a chain we do not bridge. */
  disconnected: 'evmwallet:disconnected',
} as const

export interface WalletHeaderDeps {
  /** The chain this deployment expects, for the "wrong network" message. */
  readonly route: BridgeRoute
  readonly discoveredWallets: () => readonly DiscoveredWallet[]
  readonly connect: (rdns: string) => Promise<EvmConnection>
  readonly reconnect: () => Promise<ReconnectedWallet | null>
  readonly forget: () => void
  readonly walletEvents: (rdns: string) => EvmWalletEvents | null
  /** Hands the provider to the container, or clears it. */
  readonly adoptProvider: (provider: Eip1193Provider | null) => void
  /** The route for a chain id, or null when this deployment does not bridge it. */
  readonly routeForChainId: (chainId: number) => BridgeRoute | null
  /** Records the connected account in the store. */
  readonly setAccount: (address: string) => void
  /** Records the connected route in the store; null means wrong or no network. */
  readonly setRoute: (route: BridgeRoute | null) => void
}

export class WalletHeader {
  private readonly logIn: HTMLElement | null
  private readonly disconnectButton: HTMLElement | null
  private readonly address: HTMLElement | null
  private readonly network: HTMLElement | null
  private readonly status: NodeListOf<HTMLElement>
  private readonly transferTab: HTMLElement | null
  private readonly modal: HTMLElement | null
  private readonly walletList: HTMLElement | null
  /** The connected account, so a chain switch can re-announce it. */
  private account = ''

  constructor(
    private readonly root: Document,
    private readonly deps: WalletHeaderDeps,
  ) {
    this.logIn = root.getElementById('logIn')
    this.disconnectButton = root.getElementById('disconnectEvmWallet')
    this.address = root.getElementById('address')
    this.network = root.getElementById('evmNetwork')
    this.status = root.querySelectorAll<HTMLElement>('.wallet-status')
    this.transferTab = root.getElementById('transferTab')
    this.modal = root.getElementById('myModal')
    this.walletList = root.getElementById('wallet-list')
  }

  mount(): void {
    this.logIn?.addEventListener('click', () => this.openWalletPicker())
    this.disconnectButton?.addEventListener('click', () => this.disconnect())

    this.showDisconnected()
  }

  /**
   * Reconnects the wallet used last, if it is still installed.
   *
   * Never throws: a failed auto-reconnect leaves the page as it loaded, which is
   * the state it is already in.
   */
  async reconnect(): Promise<void> {
    const reconnected = await this.deps.reconnect()
    if (reconnected) await this.adopt(reconnected.wallet, reconnected.connection)
  }

  // --- picking a wallet ----------------------------------------------------

  private openWalletPicker(): void {
    const wallets = this.deps.discoveredWallets()
    if (wallets.length === 0) {
      this.showMessage('No Wallets Found', 'Please install a wallet extension like MetaMask.')
      return
    }

    if (this.walletList) {
      this.walletList.innerHTML = wallets.map(walletRow).join('')
      // Delegated, and assigned rather than added: re-opening the picker
      // replaces this handler instead of stacking another one on top, which is
      // what addEventListener would do every time the modal is opened.
      this.walletList.onclick = (event) => {
        const item = (event.target as HTMLElement | null)?.closest('[data-rdns]')
        const rdns = item?.getAttribute('data-rdns')
        const wallet = wallets.find((candidate) => candidate.rdns === rdns)
        if (wallet) void this.connect(wallet)
      }
    }

    this.showPicker()
  }

  private async connect(wallet: DiscoveredWallet): Promise<void> {
    try {
      const connection = await this.deps.connect(wallet.rdns)
      await this.adopt(wallet, connection)
      if (this.modal) hideModal(this.modal)
    } catch (error) {
      console.error(`Connection failed for ${wallet.name}:`, error)
      this.fail(`Connection failed: ${messageOf(error)}`)
    }
  }

  // --- the connection lifecycle -------------------------------------------

  private async adopt(wallet: DiscoveredWallet, connection: EvmConnection): Promise<void> {
    this.deps.adoptProvider(connection.provider)

    if (!this.applyChain(connection.chainId)) return
    this.applyAccount(connection.accounts[0] ?? '')

    const events = this.deps.walletEvents(wallet.rdns)
    if (!events) return

    events.onChainChanged((chainId) => {
      // These handlers outlive the connection: dropping a wallet does not
      // detach them from its provider. Without this guard, a chain event
      // arriving after a wrong-network disconnect would repaint the header as
      // connected while there is no account and no provider behind it.
      if (!this.account) return

      // Wallets report this as a hex string; the port leaves it as sent.
      this.applyChain(Number(chainId))
    })
    events.onAccountsChanged((accounts) => {
      if (accounts.length === 0) {
        this.fail('Wallet disconnected. Please connect again.')
        return
      }
      const address = accounts[0] ?? ''
      this.applyAccount(address)
      this.emit(WALLET_EVENT.accountChanged, { address })
    })
    events.onDisconnect(() => {
      this.fail('Wallet connection lost. Please reload the page and connect again.')
    })
  }

  /**
   * Adopts a chain, or reports that this deployment does not bridge it.
   *
   * @returns whether the chain is usable.
   */
  private applyChain(chainId: number): boolean {
    const route = this.deps.routeForChainId(chainId)
    this.deps.setRoute(route)

    if (!route) {
      this.showWrongNetwork()
      this.fail(`Wrong Network. Please connect your wallet to ${this.deps.route.evm.name}.`)
      return false
    }

    this.showNetwork(route)
    if (this.modal) hideModal(this.modal)
    return true
  }

  private applyAccount(address: string): void {
    this.account = address
    this.deps.setAccount(address)

    if (this.address) this.address.textContent = truncateMiddle(address)
    if (this.network) this.network.textContent = this.deps.route.evm.name
    if (this.logIn) this.logIn.style.display = 'none'
    for (const element of this.status) element.style.display = 'flex'
    this.transferTab?.classList.remove('disabled')

    this.emit(WALLET_EVENT.connected, { address, route: this.deps.route })
  }

  private disconnect(): void {
    this.account = ''
    this.deps.forget()
    this.deps.adoptProvider(null)
    this.deps.setAccount('')
    this.deps.setRoute(null)
    this.showDisconnected()
    this.emit(WALLET_EVENT.disconnected, {})
  }

  /** Disconnects and says why, in the modal. */
  private fail(message: string): void {
    this.account = ''
    this.deps.forget()
    this.deps.adoptProvider(null)
    this.deps.setAccount('')
    this.deps.setRoute(null)
    this.showDisconnected()
    this.emit(WALLET_EVENT.disconnected, {})
    this.showMessage('Connect wallet', message)
  }

  // --- painting ------------------------------------------------------------

  private showDisconnected(): void {
    if (this.logIn) {
      this.logIn.style.display = ''
      this.logIn.textContent = 'Connect EVM'
    }
    if (this.address) this.address.textContent = '0x00000...'
    for (const element of this.status) element.style.display = 'none'
    this.transferTab?.classList.add('disabled')
  }

  private showNetwork(route: BridgeRoute): void {
    this.setText('.fromNetwork', route.evm.name)
    this.setText('.toNetwork', route.hathor.name)

    for (const indicator of this.root.querySelectorAll('.indicator')) {
      indicator.classList.remove('btn-outline-danger')
      indicator.classList.add('btn-outline-success')
    }
  }

  private showWrongNetwork(): void {
    this.setText('.fromNetwork', 'From Network')
    this.setText('.toNetwork', 'To Network')
    this.setText('.indicator span', 'Unknown Network')

    for (const indicator of this.root.querySelectorAll('.indicator')) {
      indicator.classList.remove('btn-outline-success')
      indicator.classList.add('btn-outline-danger')
    }
  }

  private setText(selector: string, value: string): void {
    for (const element of this.root.querySelectorAll(selector)) element.textContent = value
  }

  private showMessage(title: string, message: string): void {
    this.setModalTitle(title)
    const content = this.root.getElementById('modal-message-content')
    if (content) {
      content.textContent = message
      content.style.display = 'block'
    }
    if (this.walletList) this.walletList.style.display = 'none'
    if (this.modal) showModal(this.modal)
  }

  private showPicker(): void {
    this.setModalTitle('Select a Wallet')
    const content = this.root.getElementById('modal-message-content')
    if (content) {
      content.textContent = ''
      content.style.display = 'none'
    }
    if (this.walletList) this.walletList.style.display = ''
    if (this.modal) showModal(this.modal)
  }

  private setModalTitle(title: string): void {
    const element = this.modal?.querySelector('.modal-title')
    if (element) element.textContent = title
  }

  private emit(type: string, detail: unknown): void {
    this.root.defaultView?.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

export function mountWalletHeader(root: Document, deps: WalletHeaderDeps): WalletHeader {
  const header = new WalletHeader(root, deps)
  header.mount()
  return header
}

function walletRow(wallet: DiscoveredWallet): string {
  return `<li class="list-group-item d-flex justify-content-between align-items-center" data-rdns="${wallet.rdns}">
        <div>
          <img src="${wallet.icon}" alt="${wallet.name}" width="30" height="30" class="mr-2">
          ${wallet.name}
        </div>
        <button class="btn btn-primary btn-sm">Connect</button>
      </li>`
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
