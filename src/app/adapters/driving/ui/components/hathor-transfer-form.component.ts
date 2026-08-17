import BigNumber from 'bignumber.js'
import { clampDecimals } from '../../../../domain/amount-math'
import { isEvmAddress } from '../../../../domain/evm-address'
import { findTokenByKey } from '../../../../domain/token-lookup'
import { isOnHathor, type Token } from '../../../../domain/model/token'
import { truncateMiddle } from '../../../../domain/tx-id'
import type { SendHathorTransferParams } from '../../../../application/use-cases/send-hathor-transfer'
import { TOAST } from '../toasts'
import type { TokenSelect } from './token-select.component'

/**
 * The HTR→ARB half of the transfer card, plus the Hathor wallet button in the
 * header — they are one component because they are one state machine: the form
 * is usable exactly when the wallet is connected.
 *
 * Everything that decides whether a transfer may be sent already lives in the
 * sendHathorTransfer use case. What is here is the part only the form knows:
 * which field to mark, what the button says while it waits, and the fact that a
 * Hathor amount cannot carry more decimal places than the token has.
 *
 * The component announces two things and commands nothing outside its own
 * markup. While the ARB→HTR form and the history table are still in js/index.js,
 * they listen for those events; when they become components, the listeners move
 * with them and nothing here changes.
 */

/** Events this component publishes on the window. */
export const HATHOR_FORM_EVENT = {
  /** detail: `{ address }` — a session was opened or restored. */
  connected: 'hathorwallet:connected',
  disconnected: 'hathorwallet:disconnected',
  /** detail: `{ evmDestination }` — a transfer was submitted to the wallet. */
  transferSent: 'hathortransfer:sent',
} as const

export interface HathorWalletFacade {
  connect(): Promise<{ address: string | null }>
  disconnect(): Promise<void>
  getAddress(): string | null
  isConnected(): boolean
  /** The session ended on its own: it expired, or the wallet dropped it. */
  onSessionLost(listener: () => void): void
}

export interface HathorTransferFormDeps {
  readonly tokens: readonly Token[]
  readonly wallet: HathorWalletFacade
  /** @returns the balance formatted at the token's Hathor precision. */
  readonly refreshBalance: (token: Token) => Promise<string>
  readonly sendTransfer: (params: SendHathorTransferParams) => Promise<unknown>
  readonly toasts: {
    show(id: string, options?: { autoDismiss?: boolean }): void
    hide(id: string): void
  }
  /** The icon dropdown built over the native `<select>`. */
  readonly tokenSelect: TokenSelect | null
  /** The connected EVM account, used to prefill the destination. */
  readonly getEvmAddress: () => string
  /** Shows this token's limits in the info panel, if the chain is reachable. */
  readonly showTokenInfo: (token: Token) => void
}

export class HathorTransferForm {
  private readonly form: HTMLElement | null
  private readonly tokenSelect: HTMLSelectElement | null
  private readonly amount: HTMLInputElement | null
  private readonly destination: HTMLInputElement | null
  private readonly maxButton: HTMLButtonElement | null
  private readonly sendButton: HTMLButtonElement | null
  private readonly connectButton: HTMLButtonElement | null
  private readonly disconnectButton: HTMLElement | null
  private readonly walletInfo: HTMLElement | null
  private readonly walletAddress: HTMLElement | null
  private readonly balance: HTMLElement | null
  private readonly amountError: HTMLElement | null
  private readonly sendError: HTMLElement | null

  constructor(
    private readonly root: Document,
    private readonly deps: HathorTransferFormDeps,
  ) {
    const byId = <T extends HTMLElement>(id: string) => root.getElementById(id) as T | null

    this.form = byId('htrToArbForm')
    this.tokenSelect = byId<HTMLSelectElement>('htrTokenSelect')
    this.amount = byId<HTMLInputElement>('htrAmount')
    this.destination = byId<HTMLInputElement>('htrDestAddress')
    this.maxButton = byId<HTMLButtonElement>('htrMax')
    this.sendButton = byId<HTMLButtonElement>('htrSendBtn')
    this.connectButton = byId<HTMLButtonElement>('connectHathorWallet')
    this.disconnectButton = byId('disconnectHathorWallet')
    this.walletInfo = byId('hathorWalletInfo')
    this.walletAddress = byId('hathorWalletAddress')
    this.balance = byId('htrTokenBalance')
    this.amountError = byId('htrAmountError')
    this.sendError = byId('htrSendErrorMsg')
  }

  mount(): void {
    this.populateTokens()

    this.connectButton?.addEventListener('click', () => void this.toggleConnection())
    this.disconnectButton?.addEventListener('click', () => void this.toggleConnection())
    this.sendButton?.addEventListener('click', () => void this.send())

    if (this.tokenSelect) {
      this.tokenSelect.addEventListener('change', () => {
        void this.refreshBalance()
        // Switching to a token Hathor represents more coarsely has to re-cap
        // whatever is already typed.
        this.clampAmount()
        this.validateAmount()

        const token = this.selectedToken()
        if (token) this.deps.showTokenInfo(token)
      })
    }

    // 'input' rather than 'keypress', so pasting is covered too.
    this.amount?.addEventListener('input', () => {
      this.clampAmount()
      this.validateAmount()
    })
    this.amount?.addEventListener('keypress', (event) => {
      if (!isAmountKey(event)) event.preventDefault()
    })

    this.maxButton?.addEventListener('click', () => void this.fillMax())

    // A session can end while the page is open — it reaches its seven-day
    // expiry, or the user disconnects the dApp from the wallet itself. Nothing
    // else would notice, and the header would keep claiming a connection.
    this.deps.wallet.onSessionLost(() => this.showDisconnected({ expired: true }))

    // Each form shows and hides itself: the toggle is shared, the two halves of
    // its effect are not. The destination is prefilled from the connected EVM
    // account each time, since the user may have connected since.
    this.root.getElementById('directionToggle')?.addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement | null
      if (input?.name !== 'direction') return

      const mine = input.value === 'htr-to-arb'
      if (this.form) this.form.style.display = mine ? 'block' : 'none'
      if (mine) this.prefillDestination()
    })

    this.reflectConnection(this.deps.wallet.isConnected() ? this.deps.wallet.getAddress() : null)
  }

  /**
   * Shows the form as connected to `address`, and tells the rest of the page.
   *
   * Public because a restored session arrives asynchronously from the
   * composition root, after this component is already mounted.
   */
  showConnected(address: string | null): void {
    this.reflectConnection(address)
    this.emit(HATHOR_FORM_EVENT.connected, { address })
  }

  /**
   * Shows the form as disconnected, and tells the rest of the page.
   *
   * Public for the same reason `showConnected` is: the session can end without
   * anyone clicking anything here, and the composition root routes that back in.
   *
   * @param options.expired raises the toast that says why. A session that simply
   *        ran out looks identical to one the user ended, and without the
   *        message the page appears to have logged them out for no reason.
   */
  showDisconnected(options: { readonly expired?: boolean } = {}): void {
    this.reflectConnection(null)
    if (options.expired) this.deps.toasts.show(TOAST.hathorSessionExpired)
    this.emit(HATHOR_FORM_EVENT.disconnected, {})
  }

  // --- connection ----------------------------------------------------------

  private async toggleConnection(): Promise<void> {
    if (this.deps.wallet.isConnected()) {
      await this.deps.wallet.disconnect()
      this.showDisconnected()
      return
    }

    const button = this.connectButton
    const label = button?.textContent ?? 'Connect Hathor'
    if (button) {
      button.disabled = true
      button.textContent = 'Connecting...'
    }

    try {
      const { address } = await this.deps.wallet.connect()
      this.showConnected(address)
    } catch (error) {
      if (button) {
        button.disabled = false
        button.textContent = label
        button.style.display = ''
      }
      console.error('Hathor wallet connect failed', error)
      this.fail(`Could not connect Hathor wallet: ${messageOf(error)}`)
    }
  }

  /** Paints the header and enables or disables the form. */
  private reflectConnection(address: string | null): void {
    const connected = address !== null

    if (this.walletAddress) {
      this.walletAddress.textContent = address ? truncateMiddle(address) : ''
    }
    if (this.walletInfo) this.walletInfo.style.display = connected ? 'flex' : 'none'
    if (this.connectButton) {
      this.connectButton.style.display = connected ? 'none' : ''
      this.connectButton.disabled = false
      this.connectButton.textContent = 'Connect Hathor'
    }

    this.setEnabled(connected)
    if (connected) {
      this.prefillDestination()
      void this.refreshBalance()
    } else if (this.balance) {
      this.balance.textContent = '—'
    }
  }

  private setEnabled(enabled: boolean): void {
    this.deps.tokenSelect?.setDisabled(!enabled)
    if (this.amount) this.amount.disabled = !enabled
    if (this.maxButton) this.maxButton.disabled = !enabled
    if (this.destination) this.destination.disabled = !enabled
    // The send button stays disabled until an amount is actually valid.
    if (this.sendButton) this.sendButton.disabled = true
  }

  private prefillDestination(): void {
    const address = this.deps.getEvmAddress()
    if (address && this.destination) this.destination.value = address
  }

  // --- token and balance ---------------------------------------------------

  /** Only tokens that exist on Hathor can start a transfer from it. */
  private populateTokens(): void {
    if (!this.tokenSelect) return

    this.deps.tokenSelect?.setOptions(
      this.deps.tokens.filter(isOnHathor).map((token) => ({
        value: token.key,
        label: token.hathor.symbol || token.name,
        icon: token.icon,
      })),
    )
  }

  private selectedToken(): Token | null {
    const token = findTokenByKey(this.deps.tokens, this.tokenSelect?.value)
    // A token with no Hathor side carries the placeholder `decimals: 0`, and
    // clamping to zero decimals would make a fractional amount untypeable.
    return token && isOnHathor(token) ? token : null
  }

  private async refreshBalance(): Promise<void> {
    if (!this.balance) return

    const token = this.selectedToken()
    if (!token || !this.deps.wallet.isConnected()) {
      this.balance.textContent = '—'
      return
    }

    try {
      const formatted = await this.deps.refreshBalance(token)
      this.balance.textContent = `${formatted} ${token.hathor.symbol || token.key}`
    } catch (error) {
      console.error('Could not read the Hathor balance', error)
      this.balance.textContent = '—'
    }
  }

  private async fillMax(): Promise<void> {
    const token = this.selectedToken()
    if (!token || !this.amount || !this.deps.wallet.isConnected()) return

    try {
      this.amount.value = await this.deps.refreshBalance(token)
      this.validateAmount()
    } catch (error) {
      console.error('Could not fetch max balance', error)
    }
  }

  // --- amount --------------------------------------------------------------

  /**
   * Caps the field at the selected token's precision.
   *
   * Only rewrites the value when it actually changed, so the caret is left
   * alone while typing.
   */
  private clampAmount(): void {
    const token = this.selectedToken()
    if (!token || !this.amount) return

    const clamped = clampDecimals(this.amount.value, token.hathor.decimals)
    if (clamped !== this.amount.value) this.amount.value = clamped
  }

  private validateAmount(): void {
    if (!this.amount) return

    const valid = isPositiveAmount(this.amount.value)
    this.amount.classList.toggle('is-invalid', !valid)

    const ready = valid && this.deps.wallet.isConnected() && !!this.tokenSelect?.value
    if (this.sendButton) this.sendButton.disabled = !ready
  }

  // --- sending -------------------------------------------------------------

  private async send(): Promise<void> {
    this.deps.toasts.hide(TOAST.hathorSendSuccess)
    this.deps.toasts.hide(TOAST.hathorSendError)
    this.deps.toasts.hide(TOAST.hathorSendPending)

    const amount = this.amount?.value ?? ''
    const evmDestination = (this.destination?.value ?? '').trim()

    // The use case validates the same things and refuses, but only this half
    // knows which input to mark.
    if (!isPositiveAmount(amount)) {
      this.amount?.classList.add('is-invalid')
      if (this.amountError) this.amountError.textContent = 'Enter a valid amount.'
      return
    }
    this.amount?.classList.remove('is-invalid')

    if (!isEvmAddress(evmDestination)) {
      this.destination?.classList.add('is-invalid')
      this.fail('Enter a valid Arbitrum address (0x...).')
      return
    }
    this.destination?.classList.remove('is-invalid')

    const button = this.sendButton
    if (button) {
      button.disabled = true
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...'
    }

    // The wallet approves this over WalletConnect and raises no notification of
    // its own, so a user who does not switch to it sees only a spinner and
    // assumes the app is stuck. Sticky: it waits as long as the request does.
    this.deps.toasts.show(TOAST.hathorSendPending, { autoDismiss: false })

    try {
      await this.deps.sendTransfer({
        tokenKey: this.tokenSelect?.value ?? '',
        amount,
        evmDestination,
      })

      this.deps.toasts.show(TOAST.hathorSendSuccess)
      this.emit(HATHOR_FORM_EVENT.transferSent, { evmDestination })
    } catch (error) {
      console.error('HTR→ARB send failed', error)
      this.fail(messageOf(error) || 'Transaction failed. Please try again.')
    } finally {
      this.deps.toasts.hide(TOAST.hathorSendPending)
      if (button) {
        button.disabled = false
        button.textContent = 'Send via Hathor Wallet'
      }
    }
  }

  private fail(message: string): void {
    if (this.sendError) this.sendError.textContent = message
    this.deps.toasts.show(TOAST.hathorSendError)
  }

  private emit(type: string, detail: unknown): void {
    this.root.defaultView?.dispatchEvent(new CustomEvent(type, { detail }))
  }
}

export function mountHathorTransferForm(
  root: Document,
  deps: HathorTransferFormDeps,
): HathorTransferForm {
  const form = new HathorTransferForm(root, deps)
  form.mount()
  return form
}

/** Rejects '', '0', negatives and anything unparseable. */
function isPositiveAmount(amount: string): boolean {
  if (!amount) return false

  const parsed = new BigNumber(amount)
  return parsed.isFinite() && parsed.isGreaterThan(0)
}

/** Digits and a decimal point only; control keys carry a longer `key`. */
function isAmountKey(event: KeyboardEvent): boolean {
  return event.key.length > 1 || event.key === '.' || (event.key >= '0' && event.key <= '9')
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
