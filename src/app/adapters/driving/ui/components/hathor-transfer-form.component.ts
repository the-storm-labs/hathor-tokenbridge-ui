import BigNumber from 'bignumber.js'
import { clampDecimals } from '../../../../domain/amount-math'
import { isEvmAddress } from '../../../../domain/evm-address'
import { maxSendableHathorAmount } from '../../../../domain/hathor-network-fee'
import { checkHathorTransferLimits, type WeiLimits } from '../../../../domain/limits'
import { findTokenByKey } from '../../../../domain/token-lookup'
import { isOnHathor, type Token } from '../../../../domain/model/token'
import { truncateMiddle } from '../../../../domain/tx-id'
import {
  Eip7702DelegatedError,
  TransferLimitError,
  type SendHathorTransferParams,
} from '../../../../application/use-cases/send-hathor-transfer'
import { UserRejectedError } from '../../../../ports/driven/hathor-wallet.port'
import { TOAST } from '../toasts'
import { messageOf } from '../messages'
import { bindPopover, type Popover } from '../popover'
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

/**
 * How much of the address the header trigger shows before "…" — more than
 * `truncateMiddle`'s own default, tested against the narrowest phone widths
 * this app supports so the row never overflows. The popover it opens has
 * room to show the address in full instead.
 */
const TRIGGER_ADDRESS_CHARS = { start: 12, end: 8 } as const

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
  /**
   * The token's per-transaction limits, for flagging the amount while it is
   * typed. The send use case checks them again, and refuses if they cannot be
   * read; this is the early, field-level half of the same rule.
   */
  readonly loadLimits: (token: Token) => Promise<WeiLimits>
}

export class HathorTransferForm {
  private readonly form: HTMLElement | null
  private readonly tokenSelect: HTMLSelectElement | null
  private readonly amount: HTMLInputElement | null
  private readonly destination: HTMLInputElement | null
  private readonly maxButton: HTMLButtonElement | null
  private readonly sendButton: HTMLButtonElement | null
  private readonly connectButton: HTMLButtonElement | null
  /**
   * The `#connectHathorWallet` label lives in its own span, not the button's
   * `textContent`: the button also holds the compact icon shown on narrow
   * screens, and writing to the button directly would wipe that markup out.
   */
  private readonly connectButtonLabel: HTMLElement | null
  private readonly disconnectButton: HTMLElement | null
  private readonly copyAddressButton: HTMLElement | null
  private readonly walletInfo: HTMLElement | null
  private readonly walletAddress: HTMLElement | null
  private readonly walletMenuAddress: HTMLElement | null
  private readonly balance: HTMLElement | null
  private readonly amountError: HTMLElement | null
  private readonly sendError: HTMLElement | null
  private readonly blockedError: HTMLElement | null
  /** Null on a page with no trigger/menu pair — nothing opens, nothing closes. */
  private readonly popover: Popover | null
  /** Limits read so far, by token key. A token missing here is not checked yet. */
  private readonly limits = new Map<string, WeiLimits>()

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
    this.connectButtonLabel =
      this.connectButton?.querySelector('.wallet-connect-btn__label') ?? null
    this.disconnectButton = byId('disconnectHathorWallet')
    this.copyAddressButton = byId('copyHathorAddress')
    this.walletInfo = byId('hathorWalletInfo')
    this.walletAddress = byId('hathorWalletAddress')
    this.walletMenuAddress = byId('hathorWalletMenuAddress')
    this.balance = byId('htrTokenBalance')
    this.amountError = byId('htrAmountError')
    this.sendError = byId('htrSendErrorMsg')
    this.blockedError = byId('htrDestinationBlockedMsg')

    const trigger = byId('hathorWalletTrigger')
    const menu = byId('hathorWalletMenu')
    this.popover =
      trigger && menu ? bindPopover(trigger, menu, { onClose: () => this.resetCopyLabel() }) : null
  }

  mount(): void {
    this.populateTokens()

    this.connectButton?.addEventListener('click', () => void this.toggleConnection())
    this.disconnectButton?.addEventListener('click', () => void this.toggleConnection())
    this.copyAddressButton?.addEventListener('click', () => void this.copyAddress())
    this.sendButton?.addEventListener('click', () => void this.send())

    if (this.tokenSelect) {
      this.tokenSelect.addEventListener('change', () => {
        void this.refreshBalance()
        // Switching to a token Hathor represents more coarsely has to re-cap
        // whatever is already typed.
        this.clampAmount()
        this.validateAmount()

        const token = this.selectedToken()
        if (token) {
          this.deps.showTokenInfo(token)
          void this.loadLimits(token)
        }
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

  /**
   * Sets the button's visible label and its accessible name together: the
   * compact, icon-only layout for narrow screens hides the label span, and a
   * hidden span drops out of the accessible name too, so the button needs its
   * own `aria-label` to stay announced.
   */
  private setConnectLabel(text: string): void {
    if (this.connectButtonLabel) this.connectButtonLabel.textContent = text
    this.connectButton?.setAttribute('aria-label', text)
  }

  /**
   * Copies the full address (never the truncated display text) and swaps the
   * button's own label to confirm it. There is no timer to revert it:
   * `resetCopyLabel` runs whenever the menu closes instead, so the label is
   * never stale the next time it opens.
   */
  private async copyAddress(): Promise<void> {
    const address = this.deps.wallet.getAddress()
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
    } catch (error) {
      console.error('Copying the address failed', error)
      return
    }
    const label = this.copyAddressButton?.querySelector('span')
    if (label) label.textContent = 'Copied!'
  }

  private resetCopyLabel(): void {
    const label = this.copyAddressButton?.querySelector('span')
    if (label) label.textContent = 'Copy address'
  }

  private async toggleConnection(): Promise<void> {
    if (this.deps.wallet.isConnected()) {
      await this.deps.wallet.disconnect()
      this.showDisconnected()
      return
    }

    const button = this.connectButton
    const label = this.connectButtonLabel?.textContent ?? 'Connect Hathor'
    if (button) button.disabled = true
    this.setConnectLabel('Connecting...')

    try {
      const { address } = await this.deps.wallet.connect()
      this.showConnected(address)
    } catch (error) {
      if (button) {
        button.disabled = false
        button.style.display = ''
      }
      this.setConnectLabel(label)
      console.error('Hathor wallet connect failed', error)
      this.fail(`Could not connect Hathor wallet: ${messageOf(error)}`)
    }
  }

  /** Paints the header and enables or disables the form. */
  private reflectConnection(address: string | null): void {
    const connected = address !== null

    if (this.walletAddress) {
      this.walletAddress.textContent = address
        ? truncateMiddle(address, TRIGGER_ADDRESS_CHARS.start, TRIGGER_ADDRESS_CHARS.end)
        : ''
    }
    // The popover has room the header trigger doesn't — no reason to
    // truncate the one place meant for reading or copying the whole thing.
    if (this.walletMenuAddress) this.walletMenuAddress.textContent = address ?? ''
    if (this.walletInfo) this.walletInfo.style.display = connected ? 'flex' : 'none'
    if (this.connectButton) {
      this.connectButton.style.display = connected ? 'none' : ''
      this.connectButton.disabled = false
    }
    this.setConnectLabel('Connect Hathor')
    if (!connected) this.popover?.close()

    this.setEnabled(connected)
    if (connected) {
      this.prefillDestination()
      void this.refreshBalance()
      const token = this.selectedToken()
      if (token) void this.loadLimits(token)
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
      const balance = await this.deps.refreshBalance(token)
      // Leaves room for the Hathor network's data-output fee -- filling the
      // whole balance for a native-HTR send left nothing to cover it, and the
      // wallet rejected the transaction before ever showing a confirmation
      // screen. See maxSendableHathorAmount for why only HTR is affected.
      this.amount.value = maxSendableHathorAmount(balance, token)
      this.validateAmount()
    } catch (error) {
      console.error('Could not fetch max balance', error)
    }
  }

  /**
   * Reads and caches the limits, then re-validates whatever is typed. A failed
   * read is logged and left out of the cache: the field just goes unchecked,
   * and the send use case — which fails closed — is still in the way.
   */
  private async loadLimits(token: Token): Promise<void> {
    if (this.limits.has(token.key)) return
    try {
      this.limits.set(token.key, await this.deps.loadLimits(token))
    } catch (error) {
      console.error('Could not read the bridge limits', error)
      return
    }
    if (this.selectedToken()?.key === token.key) this.validateAmount()
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

    const outOfLimits = this.limitRejection()
    const valid = isPositiveAmount(this.amount.value) && !outOfLimits
    // An empty field is not a mistake yet — nothing typed, nothing to flag red.
    // Only a non-empty value that fails validation gets the red border; the
    // Send button staying disabled is what actually blocks an empty submit.
    this.amount.classList.toggle('is-invalid', !valid && this.amount.value !== '')
    if (this.amountError) this.amountError.textContent = outOfLimits ?? ''

    const ready = valid && this.deps.wallet.isConnected() && !!this.tokenSelect?.value
    if (this.sendButton) this.sendButton.disabled = !ready
  }

  /** The limit message for what is typed, or `null` when within or unknown. */
  private limitRejection(): string | null {
    const token = this.selectedToken()
    const limits = token && this.limits.get(token.key)
    const amount = this.amount?.value ?? ''
    if (!limits || !isPositiveAmount(amount)) return null

    const rejection = checkHathorTransferLimits(amount, limits)
    return rejection && 'message' in rejection ? rejection.message : null
  }

  // --- sending -------------------------------------------------------------

  private async send(): Promise<void> {
    this.deps.toasts.hide(TOAST.hathorSendSuccess)
    this.deps.toasts.hide(TOAST.hathorSendError)
    this.deps.toasts.hide(TOAST.hathorDestinationBlocked)
    this.deps.toasts.hide(TOAST.hathorSendCancelled)
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
      // The amount just went out — refilling it would resubmit the same
      // number by accident, and the balance it was drawn from just changed.
      this.resetAmountAfterSend()
    } catch (error) {
      if (error instanceof TransferLimitError) {
        // Limits the field had not read yet, or that changed since. Nothing was
        // sent, so the amount stays for the user to correct.
        this.amount?.classList.add('is-invalid')
        if (this.amountError) this.amountError.textContent = error.message
        this.fail(error.message)
      } else if (error instanceof Eip7702DelegatedError) {
        // A delegated destination was never going to work — the guard did its
        // job, so this renders as a block, not a failure, and is logged as one.
        // Nothing was sent to the wallet, so the typed amount is still good.
        console.warn('HTR→ARB send blocked: destination has an EIP-7702 delegation', error)
        this.block(error.message)
      } else if (error instanceof UserRejectedError) {
        // The user's own choice, not a failure — no console.error either. They
        // said no to *this* request; starting the next one from a blank field
        // matches confirming, rather than leaving a stale amount behind.
        this.cancel()
        this.resetAmountAfterSend()
      } else {
        console.error('HTR→ARB send failed', error)
        this.fail(messageOf(error) || 'Transaction failed. Please try again.')
      }
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

  /** A destination the bridge could never claim to — shown as a warning, not an error. */
  private block(message: string): void {
    if (this.blockedError) this.blockedError.textContent = message
    this.deps.toasts.show(TOAST.hathorDestinationBlocked)
  }

  /** The user declined in their wallet — shown as a warning, not an error. */
  private cancel(): void {
    this.deps.toasts.show(TOAST.hathorSendCancelled)
  }

  /**
   * Clears the amount and re-reads the balance once the wallet interaction is
   * settled — sent, or the user said no. Called for both outcomes, never for
   * the pre-flight EIP-7702 block: that one never reached the wallet, so the
   * typed amount is still what the user meant to send.
   */
  private resetAmountAfterSend(): void {
    if (this.amount) this.amount.value = ''
    this.validateAmount()
    void this.refreshBalance()
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
