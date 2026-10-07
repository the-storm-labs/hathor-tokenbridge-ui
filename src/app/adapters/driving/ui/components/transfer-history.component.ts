import { paginate, type Page } from '../../../../domain/pagination'
import { messageOf } from '../messages'
import type { BridgeRoute } from '../../../../domain/model/network'
import type { BridgeTransfer } from '../../../../domain/model/transfer'
import type { ClaimRequest } from '../../../../ports/driven/contracts.port'
import type { StoredTransfer } from '../../../../ports/driven/transfer-history.port'
import {
  fromStored,
  type EvmToHathorTransfer,
  type TransferHistory as LoadedHistory,
} from '../../../../application/use-cases/load-transfer-history'
import { hathorTransferRow } from '../templates/hathor-transfer-row'
import { transferStatusCell } from '../templates/transfer-status'
import { evmTransferRow } from '../templates/evm-transfer-row'

/**
 * The two transaction history tables, their pagination, and claiming.
 *
 * This is the component that most needed to exist. The render function it
 * replaces was 145 lines that read seven globals, defined two row templates
 * inside itself, and rebuilt the claim handlers on every repaint by querying
 * `.claim-button` and calling addEventListener again — so a row that survived
 * ten repaints carried ten handlers, and clicking it fired ten claims.
 *
 * The claim parameters no longer travel through the DOM either. A button
 * carries its index; the typed ClaimRequest stays here, in the array the use
 * case returned.
 *
 * ## Which table is which
 *
 * The ids are inverted with respect to their contents and have misled every
 * reader of this code, so they are never used as names here:
 *
 *  - `#eth-htr-tbody`, under the tab labelled **HTR → ARB**, holds
 *    **Hathor-origin** transfers — the ones that can be claimed;
 *  - `#htr-eth-tbody`, under the tab labelled **ARB → HTR**, holds
 *    **EVM-origin** transfers.
 */

/** Rows per page, as the original paginated. */
export const ROWS_PER_PAGE = 6

/** Which origin a tab shows. */
export type Origin = 'hathor' | 'evm'

const TAB = {
  hathor: { link: 'nav-eth-htr-tab', pane: 'nav-eth-htr', body: 'eth-htr-tbody' },
  evm: { link: 'nav-htr-eth-tab', pane: 'nav-htr-eth', body: 'htr-eth-tbody' },
} as const

export interface TransferHistoryDeps {
  readonly route: BridgeRoute
  /** The connected EVM account, or `''`. */
  readonly getEvmAddress: () => string
  /** Resolves the history from the Read API and the bridge contract. */
  readonly loadHistory: (evmAddress: string) => Promise<LoadedHistory>
  /** Reads one side of the history straight from local storage. */
  readonly listStored: (address: string, networkName: string) => StoredTransfer[]
  readonly claim: (request: ClaimRequest) => Promise<unknown>
  /** Starts the chain-head poll; the returned function stops it. */
  readonly watchBlockNumber: (onBlock: (blockNumber: number) => void) => () => void
  /** Shows a failure to the user, in the shared error toast. */
  readonly reportError: (message: string) => void
  readonly rowsPerPage?: number
}

export class TransferHistory {
  private hathorOrigin: readonly BridgeTransfer[] = []
  private evmOrigin: readonly EvmToHathorTransfer[] = []
  private hathorPage = 1
  private evmPage = 1
  private blockNumber = 0
  private active: Origin = 'evm'
  private stopWatching: (() => void) | null = null
  private readonly rowsPerPage: number

  constructor(
    private readonly root: Document,
    private readonly deps: TransferHistoryDeps,
  ) {
    this.rowsPerPage = deps.rowsPerPage ?? ROWS_PER_PAGE
  }

  mount(): void {
    this.root.getElementById('txn-previous')?.addEventListener('click', () => this.turnPage(-1))
    this.root.getElementById('txn-next')?.addEventListener('click', () => this.turnPage(1))

    // Which tab starts in front is markup, and both pages ship the same one;
    // reading it rather than assuming keeps the two in step.
    this.active = this.isMarkedActive('hathor') ? 'hathor' : 'evm'

    for (const origin of ['hathor', 'evm'] as const) {
      this.root.getElementById(TAB[origin].link)?.addEventListener('click', (event) => {
        // The switch itself is this component's now. It used to be Bootstrap's
        // tab plugin, whose `shown.bs.tab` is a jQuery event that never reaches
        // addEventListener — so this had to guess when to repaint.
        event.preventDefault()
        this.showTab(origin)
      })
    }

    // Delegated once, rather than re-bound per row on every repaint. This is
    // what stops a long-lived row from accumulating handlers.
    this.root.getElementById(TAB.hathor.body)?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement | null)?.closest('.claim-button')
      if (!(button instanceof HTMLButtonElement) || button.disabled) return

      event.preventDefault()
      void this.claim(button)
    })
  }

  // --- loading -------------------------------------------------------------

  /**
   * Begins following the chain head, reloading the history on each new block.
   *
   * Idempotent: calling it while already watching does nothing, where the
   * original left the previous interval running and doubled the request rate
   * every time the network changed.
   */
  start(): void {
    if (this.stopWatching) return

    this.stopWatching = this.deps.watchBlockNumber((blockNumber) => {
      this.blockNumber = blockNumber
      void this.refresh()
    })
  }

  stop(): void {
    this.stopWatching?.()
    this.stopWatching = null
  }

  /** Whether the poller is running, which is what makes the table live. */
  get watching(): boolean {
    return this.stopWatching !== null
  }

  /** Reloads both lists from the API and the chain, then repaints. */
  async refresh(): Promise<void> {
    const address = this.deps.getEvmAddress()
    // '0x123456789' was the placeholder the disconnected page used to carry.
    if (!address || address === '0x123456789') return

    const { hathorToEvm, evmToHathor } = await this.deps.loadHistory(address)
    this.hathorOrigin = hathorToEvm
    this.evmOrigin = evmToHathor
    this.render()
  }

  /**
   * Reloads both lists straight from local storage and repaints.
   *
   * Used when the account changes, and after a Hathor-origin send, where the
   * transfer has to appear before the next poll resolves it. Stored records
   * carry no claim request — that is resolved against the chain by the use
   * case — so no Claim button is rendered until then. Deliberate: a button
   * built from unresolved data could point at a transfer already claimed.
   *
   * @param hathorReceiver the address Hathor-origin transfers are keyed by,
   *        which is the destination of the transfer and not necessarily the
   *        connected account — that form works without an EVM wallet.
   */
  showStored(hathorReceiver?: string): void {
    const account = this.deps.getEvmAddress()
    const receiver = hathorReceiver || account

    if (receiver) {
      this.hathorOrigin = this.deps
        .listStored(receiver, this.deps.route.hathor.name)
        .map(fromStored)
    }
    if (account) {
      this.evmOrigin = this.deps.listStored(account, this.deps.route.evm.name)
    }

    this.render()
  }

  // --- tabs and pagination -------------------------------------------------

  /**
   * Brings one origin's tab to the front.
   *
   * @param options.reveal scroll the table into view, for when the user has
   *        just submitted something and the tables are below the fold. The
   *        original did this by assigning `location.hash` twice, which left a
   *        stale fragment in the URL and an entry in the back history.
   */
  showTab(origin: Origin, options: { readonly reveal?: boolean } = {}): void {
    const shown = TAB[origin]
    const hidden = TAB[origin === 'hathor' ? 'evm' : 'hathor']

    this.active = origin
    this.setTabActive(shown, true)
    this.setTabActive(hidden, false)
    this.render()

    // Optional call: jsdom has no layout, so it does not implement this.
    if (options.reveal) {
      this.root
        .getElementById(shown.link)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
    }
  }

  private setTabActive(tab: (typeof TAB)[Origin], active: boolean): void {
    const link = this.root.getElementById(tab.link)
    link?.classList.toggle('active', active)
    link?.setAttribute('aria-selected', String(active))

    const pane = this.root.getElementById(tab.pane)
    pane?.classList.toggle('active', active)
    pane?.classList.toggle('show', active)
  }

  private isMarkedActive(origin: Origin): boolean {
    return this.root.getElementById(TAB[origin].link)?.classList.contains('active') ?? false
  }

  private turnPage(delta: number): void {
    if (this.active === 'hathor') this.hathorPage += delta
    else this.evmPage += delta

    this.render()
  }

  // --- claiming ------------------------------------------------------------

  private async claim(button: HTMLButtonElement): Promise<void> {
    // Stop the poll first: a repaint mid-claim would replace the button under
    // the user, and the reload competes with the wallet for the RPC.
    this.stop()
    button.disabled = true

    const transfer = this.hathorOrigin[Number(button.getAttribute('data-claim-index'))]
    if (!transfer?.claim) {
      this.deps.reportError('This transfer can no longer be claimed. Reload and try again.')
      this.start()
      return
    }

    try {
      await this.deps.claim(transfer.claim)
    } catch (error) {
      // A reverted claim used to look like a successful one: the send promise
      // was awaited and the receipt status never checked, so the row simply
      // never changed and the user was left guessing.
      console.error(error)
      this.deps.reportError(`Couldn't claim the tokens. ${messageOf(error)}`)
    } finally {
      this.start()
    }
  }

  // --- rendering -----------------------------------------------------------

  render(): void {
    const empty = this.root.getElementById('previousTxnsEmptyTab')
    const table = this.root.getElementById('previousTxnsTab')

    // Nothing to show and nothing driving updates: leave the page as it is
    // rather than flashing the empty state. Hathor-origin rows can arrive
    // without an EVM wallet, and therefore without a poller.
    if (!this.watching && this.hathorOrigin.length === 0) return

    // Explicit 'block', not '': both containers are `display: none` in
    // customStyles.css, so clearing the inline value would leave them hidden.
    if (this.hathorOrigin.length === 0 && this.evmOrigin.length === 0) {
      if (empty) {
        empty.style.marginBottom = '6em'
        empty.style.display = 'block'
      }
      if (table) table.style.display = 'none'
      return
    }

    if (empty) {
      empty.style.marginBottom = '0em'
      empty.style.display = 'none'
    }
    if (table) {
      table.style.display = 'block'
      table.style.marginBottom = '6em'
    }

    const hathorPage = paginate(this.hathorOrigin, this.hathorPage, this.rowsPerPage)
    const evmPage = paginate(this.evmOrigin, this.evmPage, this.rowsPerPage)

    this.write(
      TAB.hathor.body,
      hathorPage.data.map((transfer) => this.hathorRow(transfer)),
    )
    this.write(
      TAB.evm.body,
      evmPage.data.map((transfer) => this.evmRow(transfer)),
    )

    this.renderPager(this.active === 'hathor' ? hathorPage : evmPage)
  }

  private hathorRow(transfer: BridgeTransfer): string {
    // Identity: these are the very objects the use case returned, so the index
    // the button carries resolves back to this transfer's typed claim request.
    const claimIndex = transfer.claim ? this.hathorOrigin.indexOf(transfer) : -1
    const action = transferStatusCell(transfer.status, claimIndex >= 0 ? claimIndex : null)

    return hathorTransferRow(
      { ...transfer, action },
      this.deps.route.hathor.explorer,
      this.deps.route.signaturesRequired,
      this.deps.route.dashboardUrl ?? null,
    )
  }

  private evmRow(transfer: EvmToHathorTransfer): string {
    return evmTransferRow(transfer, {
      currentBlock: this.blockNumber,
      confirmations: this.deps.route.evm.confirmations,
      secondsPerBlock: this.deps.route.evm.secondsPerBlock,
      explorer: this.deps.route.evm.explorer,
      dashboardUrl: this.deps.route.dashboardUrl ?? null,
      signaturesRequired: this.deps.route.signaturesRequired,
      hathorExplorer: this.deps.route.hathor.explorer,
    })
  }

  private renderPager(page: Page<unknown>): void {
    const toolbar = this.root.querySelector<HTMLElement>('.btn-toolbar')
    const previous = this.root.getElementById('txn-previous') as HTMLButtonElement | null
    const next = this.root.getElementById('txn-next') as HTMLButtonElement | null

    // '' rather than 'block' here: .btn-toolbar is display:flex from
    // Bootstrap, and naming a value would flatten the layout.
    if (toolbar) toolbar.style.display = page.total_pages > 1 ? '' : 'none'
    if (previous) previous.disabled = page.pre_page === null
    if (next) next.disabled = page.next_page === null
  }

  private write(bodyId: string, rows: readonly string[]): void {
    const body = this.root.getElementById(bodyId)
    if (body) body.innerHTML = rows.join('')
  }
}

export function mountTransferHistory(root: Document, deps: TransferHistoryDeps): TransferHistory {
  const history = new TransferHistory(root, deps)
  history.mount()
  return history
}
