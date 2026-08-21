import BigNumber from 'bignumber.js'
import { clampDecimals } from '../../../../domain/amount-math'
import { quote, formatQuoteValue } from '../../../../domain/fee-math'
import { validateAmount, rejectionMessage } from '../../../../domain/limits'
import { findTokenByKey } from '../../../../domain/token-lookup'
import { isOnEvm, isOnHathor, type Token } from '../../../../domain/model/token'
import type { BridgeRoute } from '../../../../domain/model/network'
import type { ApproveSpendParams } from '../../../../application/use-cases/approve-spend'
import type { CrossTokenParams } from '../../../../application/use-cases/cross-token'
import { formatRowAmount } from '../templates/amount'
import { HATHOR_FORM_EVENT } from './hathor-transfer-form.component'
import { TOAST } from '../toasts'
import type { TokenSelect } from './token-select.component'

/**
 * The ARB→HTR half of the transfer card: pick a token, type an amount, approve
 * the bridge to move it, cross it.
 *
 * The arithmetic left here is zero. The quote, the limit check, the fee
 * gross-up, the balance and the allowance comparison are all domain functions or
 * use cases; this decides what is enabled, what is shown, and in which field a
 * rejection is reported.
 *
 * Three of the elements it writes to did not exist in the page, and jQuery
 * writes to an empty set silently, so they failed invisibly:
 *
 *  - the **amount validation message** had nowhere to render, so an amount below
 *    the minimum or over the daily limit was rejected with no explanation;
 *  - the **unlimited-approval checkbox** was gone, so that option was
 *    unreachable even though the use case still implements it;
 *  - `.approve-deposit`, the block those two live in, was never in the markup.
 *
 * They are in both pages now. The remaining dead writes — `#secondsPerBlock` and
 * the `#willReceive-copy` clipboard button — are gone instead: the first is
 * shown in the info panel, the second duplicated the token list tab.
 */

/** Events this component publishes on the window. */
export const CROSS_FORM_EVENT = {
  /** A transfer was submitted and mined. No detail: it is the connected account. */
  transferSent: 'crosstransfer:sent',
} as const

export interface BridgeParametersView {
  readonly feeRate: number
  readonly minTokensAllowed: number
  readonly maxTokensAllowed: number
}

export interface CrossTransferFormDeps {
  readonly tokens: readonly Token[]
  readonly route: BridgeRoute
  readonly toasts: { show(id: string): void; hide(id: string): void }
  /** Shows a failure in the shared error toast. */
  readonly reportError: (message: string) => void
  /** The icon dropdown built over the native `<select>`. */
  readonly tokenSelect: TokenSelect | null

  /** The connected EVM account, or `''`. */
  readonly getEvmAddress: () => string
  /** The fee and limits last read from the chain. */
  readonly getParameters: () => BridgeParametersView

  /** @returns a decimal string at the token's EVM precision. */
  readonly getTokenBalance: (token: Token, owner: string) => Promise<string>
  readonly getMaxTransferable: (token: Token, owner: string, feeRate: number) => Promise<string>
  readonly isApproved: (
    token: Token,
    owner: string,
    spender: string,
    totalCost: BigNumber,
  ) => Promise<{ approved: boolean }>
  /** Reloads the info panel for a token; also refreshes the fee and limits. */
  readonly loadParameters: (tokenAddress: string) => Promise<unknown>

  readonly approve: (params: ApproveSpendParams) => Promise<unknown>
  readonly cross: (params: CrossTokenParams) => Promise<{ receives: string }>
  readonly isValidHathorAddress: (address: string) => boolean
}

export class CrossTransferForm {
  private readonly form: HTMLElement | null
  private readonly tokenSelect: HTMLSelectElement | null
  private readonly amount: HTMLInputElement | null
  private readonly amountError: HTMLElement | null
  private readonly maxButton: HTMLElement | null
  private readonly destination: HTMLInputElement | null
  private readonly approveButton: HTMLButtonElement | null
  private readonly unlimited: HTMLInputElement | null
  private readonly crossButton: HTMLButtonElement | null
  private readonly balance: HTMLElement | null

  constructor(
    private readonly root: Document,
    private readonly deps: CrossTransferFormDeps,
  ) {
    const byId = <T extends HTMLElement>(id: string) => root.getElementById(id) as T | null

    this.form = byId('crossForm')
    this.tokenSelect = byId<HTMLSelectElement>('tokenAddress')
    this.amount = byId<HTMLInputElement>('amount')
    this.amountError = byId('amountError')
    this.maxButton = byId('max')
    this.destination = byId<HTMLInputElement>('hathorAddress')
    this.approveButton = byId<HTMLButtonElement>('approve')
    this.unlimited = byId<HTMLInputElement>('doNotAskAgain')
    this.crossButton = byId<HTMLButtonElement>('deposit')
    this.balance = byId('evmTokenBalance')
  }

  mount(): void {
    this.tokenSelect?.addEventListener('change', () => void this.onTokenChanged())

    // 'input' rather than 'keypress', so pasting is covered too. It fires before
    // 'keyup', so the check below already sees the clamped value.
    this.amount?.addEventListener('input', () => {
      this.clampAmount()
      this.checkAmount()
    })
    this.amount?.addEventListener('keyup', (event) => {
      this.checkAmount()
      if (event.key === 'Enter') void this.refreshApprovalState()
    })
    this.amount?.addEventListener('focusout', () => void this.refreshApprovalState())
    this.amount?.addEventListener('keypress', (event) => {
      if (!isAmountKey(event)) event.preventDefault()
    })

    this.maxButton?.addEventListener('click', (event) => {
      event.preventDefault()
      void this.fillMax()
    })

    this.destination?.addEventListener('keyup', () => this.markDestination())

    this.approveButton?.addEventListener('click', (event) => {
      event.preventDefault()
      void this.approve()
    })
    this.form?.addEventListener('submit', (event) => {
      event.preventDefault()
      void this.cross()
    })

    // The Hathor form knows the address before this one does, and a user who
    // has connected there should not have to retype it here.
    this.root.defaultView?.addEventListener(HATHOR_FORM_EVENT.connected, (event) => {
      const { address } = (event as CustomEvent<{ address: string | null }>).detail
      if (address) this.setDestination(address)
    })

    this.root.getElementById('directionToggle')?.addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement | null
      if (input?.name === 'direction') this.setVisible(input.value === 'arb-to-htr')
    })

    this.setEnabled(false)
    this.setButtons({ approve: false, cross: false })
  }

  // --- enabling ------------------------------------------------------------

  /** Enabled means: a wallet is connected on a chain this deployment bridges. */
  setEnabled(enabled: boolean): void {
    this.deps.tokenSelect?.setDisabled(!enabled)
    if (this.amount) this.amount.disabled = !enabled
    // The Max link is bound once and checks this, rather than having its
    // handler and its href added and removed on every state change.
    if (this.maxButton) this.maxButton.toggleAttribute('disabled', !enabled)
  }

  private setButtons(state: { approve: boolean; cross: boolean }): void {
    if (this.approveButton) this.approveButton.disabled = !state.approve
    if (this.unlimited) this.unlimited.disabled = !state.approve
    if (this.crossButton) this.crossButton.disabled = !state.cross
  }

  private setVisible(visible: boolean): void {
    if (this.form) this.form.style.display = visible ? 'block' : 'none'
  }

  // --- token ---------------------------------------------------------------

  /**
   * Rebuilds the dropdown for this deployment and re-reads the selection.
   *
   * Called when a wallet connects or the network changes. A token absent from
   * this deployment's EVM chain has no address to cross from and is skipped.
   */
  populateTokens(): void {
    if (!this.tokenSelect) return

    this.deps.tokenSelect?.setOptions(
      this.deps.tokens.filter(isOnEvm).map((token) => ({
        value: token.key,
        label: token.evm.symbol,
        icon: token.icon,
      })),
    )
    this.deps.tokenSelect?.setDisabled(false)
    void this.onTokenChanged()
  }

  private selectedToken(): Token | null {
    return findTokenByKey(this.deps.tokens, this.tokenSelect?.value)
  }

  private async onTokenChanged(): Promise<void> {
    this.deps.toasts.hide(TOAST.transferSuccess)

    const token = this.selectedToken()
    if (!token || !isOnEvm(token)) {
      this.setSymbols('')
      this.showQuote('0.000000', '0.000000')
      return
    }

    this.setSymbols(token.evm.symbol)
    this.showDestinationToken(token)
    void this.showBalance(token)

    // Switching to a token Hathor represents more coarsely has to re-cap
    // whatever is already typed.
    this.clampAmount()

    // Loading the parameters also refreshes the fee and the limits the check
    // below reads, so it has to finish first.
    await this.deps.loadParameters(token.evm.address)
    this.checkAmount()
    if (this.amount?.value) void this.refreshApprovalState()
  }

  private setSymbols(symbol: string): void {
    for (const element of this.root.querySelectorAll('.selectedToken')) {
      element.textContent = symbol
    }
  }

  /** What arrives on the other side, linked to the Hathor explorer. */
  private showDestinationToken(token: Token): void {
    const target = this.root.getElementById('willReceiveToken')
    if (!target) return

    if (!isOnHathor(token)) {
      target.textContent = ''
      return
    }

    const url = `${this.deps.route.hathor.explorer}/${this.deps.route.hathor.explorerTokenTab}/${token.hathor.pureHtrAddress.toLowerCase()}`
    target.innerHTML =
      `<a target="_blank" href="${url}">` +
      `<span><img src="${token.icon}" class="token-logo"></span>${token.hathor.symbol}</a>`
  }

  private async showBalance(token: Token): Promise<void> {
    if (!this.balance) return

    try {
      const balance = await this.deps.getTokenBalance(token, this.deps.getEvmAddress())
      const symbol = isOnEvm(token) ? token.evm.symbol : ''
      this.balance.textContent = `${formatRowAmount(balance, null, 4)} ${symbol}`
    } catch {
      this.balance.textContent = '—'
    }
  }

  // --- amount --------------------------------------------------------------

  /**
   * Caps #amount at the precision Hathor can represent.
   *
   * The destination chain truncates anything finer, so accepting it would only
   * mislead the user about what arrives. This constrains the *input*: the
   * approve and cross use cases still scale by the token's EVM decimals, which
   * is what the contracts expect.
   */
  private clampAmount(): void {
    const token = this.selectedToken()
    // A token with no Hathor side carries the placeholder `decimals: 0`, and
    // clamping to zero decimals would make a fractional amount untypeable.
    if (!token || !isOnHathor(token) || !this.amount) return

    const clamped = clampDecimals(this.amount.value, token.hathor.decimals)
    if (clamped !== this.amount.value) this.amount.value = clamped
  }

  /** Prices the amount, shows the quote, and reports why it is refused. */
  private checkAmount(): void {
    this.deps.toasts.hide(TOAST.transferSuccess)
    if (!this.amount) return

    const { feeRate, minTokensAllowed, maxTokensAllowed } = this.deps.getParameters()
    const { totalCost, serviceFee } = quote(this.amount.value, feeRate)
    this.showQuote(formatQuoteValue(serviceFee), formatQuoteValue(totalCost))

    const rejection = validateAmount(this.amount.value, totalCost, {
      min: minTokensAllowed,
      max: maxTokensAllowed,
      feeRate,
    })

    if (rejection) {
      this.markInvalidAmount(rejectionMessage(rejection))
      this.setButtons({ approve: false, cross: false })
      return
    }

    this.clearAmountError()
  }

  private markInvalidAmount(message: string): void {
    if (this.amountError) {
      this.amountError.textContent = message
      this.amountError.style.display = 'block'
    }
    this.amount?.classList.add('is-invalid')
    this.amount?.classList.remove('ok')
    if (this.amount) this.amount.disabled = false
  }

  private clearAmountError(): void {
    if (this.amountError) {
      this.amountError.textContent = ''
      this.amountError.style.display = 'none'
    }
    this.amount?.classList.remove('is-invalid')
    this.amount?.classList.add('ok')
  }

  private showQuote(serviceFee: string, totalCost: string): void {
    const write = (id: string, value: string) => {
      const element = this.root.getElementById(id)
      if (element) element.textContent = value
    }
    write('serviceFee', serviceFee)
    write('totalCost', totalCost)
  }

  private async fillMax(): Promise<void> {
    const token = this.selectedToken()
    if (!token || !this.amount || this.maxButton?.hasAttribute('disabled')) return

    const { feeRate } = this.deps.getParameters()
    // Computed at the token's EVM precision, then capped at what Hathor can
    // represent — both steps truncate down, so Max never exceeds the balance.
    this.amount.value = await this.deps.getMaxTransferable(
      token,
      this.deps.getEvmAddress(),
      feeRate,
    )
    this.clampAmount()
    this.checkAmount()
    void this.refreshApprovalState()
  }

  // --- destination ---------------------------------------------------------

  private setDestination(address: string): void {
    if (!this.destination) return

    this.destination.value = address
    this.markDestination()
  }

  private markDestination(): void {
    if (!this.destination) return

    const address = this.destination.value
    this.destination.classList.remove('is-valid', 'is-invalid')
    if (!address) return

    const valid = this.deps.isValidHathorAddress(address)
    this.destination.classList.add(valid ? 'is-valid' : 'is-invalid')
  }

  // --- allowance, approve, cross -------------------------------------------

  /**
   * Decides whether the user still has to approve, or can cross directly.
   *
   * The allowance is compared against the **total cost**, not the amount typed:
   * the fee is charged on top, so an approval for the bare amount leaves the
   * transfer to fail at the contract.
   */
  private async refreshApprovalState(): Promise<void> {
    const token = this.selectedToken()
    const owner = this.deps.getEvmAddress()
    if (!token || !owner || !this.amount) return

    const amount = this.amount.value
    if (!amount) {
      this.markInvalidAmount('Invalid amount')
      return
    }
    if (new BigNumber(amount).isLessThanOrEqualTo(0)) {
      this.markInvalidAmount('Must be bigger than 0')
      return
    }

    const { feeRate } = this.deps.getParameters()
    const { totalCost } = quote(amount, feeRate)

    try {
      const { approved } = await this.deps.isApproved(
        token,
        owner,
        this.deps.route.evm.bridge,
        totalCost,
      )
      this.showApprovalStep(!approved)
      this.setButtons({ approve: !approved, cross: approved })
    } catch (error) {
      console.error('Could not read the allowance', error)
    }
  }

  private showApprovalStep(needed: boolean): void {
    for (const element of this.root.querySelectorAll<HTMLElement>('.approve-deposit')) {
      element.style.display = needed ? 'block' : 'none'
    }
  }

  private async approve(): Promise<void> {
    if (!this.approveButton) return
    if (this.amount?.classList.contains('is-invalid')) {
      this.deps.reportError('Invalid Amount')
      return
    }

    const label = this.approveButton.innerHTML
    this.approveButton.disabled = true
    this.approveButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Approving...'

    try {
      await this.deps.approve({
        tokenKey: this.tokenSelect?.value ?? '',
        amount: this.amount?.value ?? '',
        unlimited: this.unlimited?.checked ?? false,
      })
      this.setButtons({ approve: false, cross: true })
    } catch (error) {
      console.error(error)
      this.deps.reportError(`Couldn't approve amount. ${messageOf(error)}`)
      this.setButtons({ approve: true, cross: false })
    } finally {
      this.approveButton.innerHTML = label
    }
  }

  private async cross(): Promise<void> {
    if (!this.crossButton) return

    const label = this.crossButton.innerHTML
    this.crossButton.disabled = true
    this.crossButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Converting...'

    try {
      this.deps.toasts.hide(TOAST.transferError)
      this.deps.toasts.hide(TOAST.transferSuccess)

      if (this.amount?.classList.contains('is-invalid')) throw new Error('Invalid Amount')

      this.setEnabled(false)

      const { receives } = await this.deps.cross({
        tokenKey: this.tokenSelect?.value ?? '',
        amount: this.amount?.value ?? '',
        hathorAddress: this.destination?.value ?? '',
      })

      this.announce(receives)
      this.setButtons({ approve: false, cross: false })
      this.root.defaultView?.dispatchEvent(new CustomEvent(CROSS_FORM_EVENT.transferSent))
    } catch (error) {
      console.error(error)
      this.deps.reportError(`Couldn't cross the tokens. ${messageOf(error)}`)
    } finally {
      this.crossButton.disabled = false
      this.crossButton.innerHTML = label
      this.setEnabled(true)
    }
  }

  private announce(receives: string): void {
    const write = (id: string, value: string) => {
      const element = this.root.getElementById(id)
      if (element) element.textContent = value
    }
    write('receive', receives)
    write('confirmationTime', this.deps.route.evm.confirmationTime)
    this.deps.toasts.show(TOAST.transferSuccess)
  }
}

export function mountCrossTransferForm(
  root: Document,
  deps: CrossTransferFormDeps,
): CrossTransferForm {
  const form = new CrossTransferForm(root, deps)
  form.mount()
  return form
}

/** Digits and a decimal point only; control keys carry a longer `key`. */
function isAmountKey(event: KeyboardEvent): boolean {
  return event.key.length > 1 || event.key === '.' || (event.key >= '0' && event.key <= '9')
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
