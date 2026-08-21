// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import BigNumber from 'bignumber.js'
import {
  mountCrossTransferForm,
  CROSS_FORM_EVENT,
  type CrossTransferFormDeps,
} from './cross-transfer-form.component'
import { HATHOR_FORM_EVENT } from './hathor-transfer-form.component'
import { ROUTES } from '../../../../config/networks'
import { tokensFor } from '../../../../config/tokens'
import { mountTokenSelect } from './token-select.component'
import { TOAST } from '../toasts'

const ROUTE = ROUTES.mainnet
const TOKENS = tokensFor('mainnet')
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678'
const HATHOR_ADDRESS = 'HDeadbeefDeadbeefDeadbeefDeadbeef01'

const MARKUP = `
  <div id="directionToggle">
    <input type="radio" name="direction" value="arb-to-htr" checked>
    <input type="radio" name="direction" value="htr-to-arb">
  </div>
  <form id="crossForm">
    <select id="tokenAddress" disabled></select>
    <small>Balance: <span id="evmTokenBalance">—</span></small>
    <input id="amount" disabled>
    <div class="invalid-feedback" id="amountError"></div>
    <button id="max" type="button">Max</button>
    <p>Service fee: <span id="serviceFee"></span> <span class="selectedToken"></span></p>
    <p>Total cost: <span id="totalCost"></span> <span class="selectedToken"></span></p>
    <small>You will receive: <span id="willReceiveToken">—</span></small>
    <input id="hathorAddress">
    <div class="approve-deposit">
      <button disabled id="approve">Approve</button>
      <input type="checkbox" id="doNotAskAgain" disabled>
    </div>
    <button disabled id="deposit" type="submit">Convert tokens</button>
  </form>
  <span id="receive"></span>
  <span id="confirmationTime"></span>
`

/** Enough fee for a visible quote: 0.2%, min 1, max 100000. */
const PARAMETERS = { feeRate: 0.002, minTokensAllowed: 1, maxTokensAllowed: 100_000 }

function setup(overrides: Partial<CrossTransferFormDeps> = {}) {
  document.body.innerHTML = MARKUP

  const deps: CrossTransferFormDeps = {
    tokens: TOKENS,
    route: ROUTE,
    toasts: { show: vi.fn(), hide: vi.fn() },
    reportError: vi.fn(),
    tokenSelect: mountTokenSelect(document, 'tokenAddress', 'Select token'),
    getEvmAddress: () => ACCOUNT,
    getParameters: () => PARAMETERS,
    getTokenBalance: vi.fn(async () => '250.5'),
    getMaxTransferable: vi.fn(async () => '249.99'),
    isApproved: vi.fn(async () => ({ approved: false })),
    loadParameters: vi.fn(async () => undefined),
    approve: vi.fn(async () => ({})),
    cross: vi.fn(async () => ({ receives: '2.00 hUSDC' })),
    isValidHathorAddress: (address: string) => address.startsWith('H'),
    ...overrides,
  }

  const form = mountCrossTransferForm(document, deps)
  return { form, deps }
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const amount = () => el<HTMLInputElement>('amount')
const select = () => el<HTMLSelectElement>('tokenAddress')
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Types an amount and lets the allowance check run, which is what decides
 * whether Approve or Convert is the enabled button.
 */
async function typeAmountAndCheckAllowance(value: string) {
  amount().value = value
  amount().dispatchEvent(new Event('input'))
  amount().dispatchEvent(new Event('focusout'))
  await settle()
}

/** A mounted form with USDC selected and the async token load finished. */
async function withToken(overrides: Partial<CrossTransferFormDeps> = {}) {
  const context = setup(overrides)
  context.form.setEnabled(true)
  context.form.populateTokens()
  await settle()
  return context
}

describe('the token dropdown', () => {
  it('offers only tokens that exist on this deployment EVM chain', async () => {
    await withToken()
    const expected = TOKENS.filter((token) => token.evm !== null).length
    expect(select().options).toHaveLength(expected)
  })

  it('shows the balance, the symbols and the token that will arrive', async () => {
    await withToken()

    expect(el('evmTokenBalance').textContent).toBe('250.5000 USDC')
    expect(document.querySelector('.selectedToken')!.textContent).toBe('USDC')
    expect(el('willReceiveToken').innerHTML).toContain('hUSDC')
    expect(el('willReceiveToken').innerHTML).toContain('explorer.hathor.network/token_detail/')
  })

  it('reloads the limits for the token that was selected', async () => {
    const { deps } = await withToken()
    expect(deps.loadParameters).toHaveBeenCalledWith(TOKENS[0]!.evm!.address)
  })
})

describe('the amount field', () => {
  it('quotes the fee and the total cost as it is typed', async () => {
    await withToken()
    amount().value = '100'
    amount().dispatchEvent(new Event('input'))

    // The fee is charged on top of what arrives, so the total is
    // amount / (1 - rate), not amount * (1 + rate).
    expect(el('totalCost').textContent).toBe('100.200400')
    expect(el('serviceFee').textContent).toBe('0.200400')
  })

  it('explains why an amount is refused, where the user can see it', async () => {
    await withToken()
    amount().value = '0.5'
    amount().dispatchEvent(new Event('input'))

    // This message had nowhere to render before: the selector it was written
    // into matched nothing in the page.
    expect(el('amountError').textContent).toContain('Minimum amount')
    expect(el('amountError').style.display).toBe('block')
    expect(amount().classList.contains('is-invalid')).toBe(true)
    expect(el<HTMLButtonElement>('deposit').disabled).toBe(true)
  })

  it('caps what is typed at the precision Hathor can represent', async () => {
    await withToken()
    amount().value = '1.2345'
    amount().dispatchEvent(new Event('input'))

    expect(amount().value).toBe('1.23')
  })

  it('fills Max from the transferable maximum, capped at that precision', async () => {
    const { deps } = await withToken({ getMaxTransferable: vi.fn(async () => '249.999') })
    el('max').click()
    await settle()

    expect(deps.getMaxTransferable).toHaveBeenCalledWith(expect.anything(), ACCOUNT, 0.002)
    expect(amount().value).toBe('249.99')
  })

  it('does nothing on Max while the form is disabled', async () => {
    const { form, deps } = await withToken()
    form.setEnabled(false)
    el('max').click()
    await settle()

    expect(deps.getMaxTransferable).not.toHaveBeenCalled()
  })
})

describe('the destination address', () => {
  it('marks a valid and an invalid Hathor address', async () => {
    await withToken()
    const destination = el<HTMLInputElement>('hathorAddress')

    destination.value = HATHOR_ADDRESS
    destination.dispatchEvent(new Event('keyup'))
    expect(destination.classList.contains('is-valid')).toBe(true)

    destination.value = '0xnope'
    destination.dispatchEvent(new Event('keyup'))
    expect(destination.classList.contains('is-invalid')).toBe(true)
  })

  it('is filled in when the Hathor wallet connects', async () => {
    await withToken()
    window.dispatchEvent(
      new CustomEvent(HATHOR_FORM_EVENT.connected, { detail: { address: HATHOR_ADDRESS } }),
    )

    const destination = el<HTMLInputElement>('hathorAddress')
    expect(destination.value).toBe(HATHOR_ADDRESS)
    expect(destination.classList.contains('is-valid')).toBe(true)
  })
})

describe('the approval step', () => {
  it('offers Approve while the allowance does not cover the total cost', async () => {
    const { deps } = await withToken()
    amount().value = '100'
    amount().dispatchEvent(new Event('focusout'))
    await settle()

    // Compared against the total, not the typed amount: the fee is charged on
    // top, so approving the bare amount leaves the transfer to revert.
    const totalCost = (deps.isApproved as ReturnType<typeof vi.fn>).mock.calls[0]![3] as BigNumber
    expect(totalCost.toFixed(4)).toBe('100.2004')
    expect(el<HTMLButtonElement>('approve').disabled).toBe(false)
    expect(el<HTMLButtonElement>('deposit').disabled).toBe(true)
    expect(document.querySelector<HTMLElement>('.approve-deposit')!.style.display).toBe('block')
  })

  it('goes straight to Convert when the allowance is enough', async () => {
    await withToken({ isApproved: vi.fn(async () => ({ approved: true })) })
    amount().value = '100'
    amount().dispatchEvent(new Event('focusout'))
    await settle()

    expect(el<HTMLButtonElement>('deposit').disabled).toBe(false)
    expect(document.querySelector<HTMLElement>('.approve-deposit')!.style.display).toBe('none')
  })

  it('passes the unlimited checkbox through, now that it exists', async () => {
    const { deps } = await withToken()
    await typeAmountAndCheckAllowance('100')
    el<HTMLInputElement>('doNotAskAgain').checked = true

    el('approve').click()
    await settle()

    expect(deps.approve).toHaveBeenCalledWith({
      tokenKey: 'USDC',
      amount: '100',
      unlimited: true,
    })
  })

  it('re-offers Approve when it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = await withToken({
      approve: vi.fn(async () => {
        throw new Error('user rejected')
      }),
    })
    await typeAmountAndCheckAllowance('100')

    el('approve').click()
    await settle()

    expect(deps.reportError).toHaveBeenCalledWith(expect.stringContaining('user rejected'))
    expect(el<HTMLButtonElement>('approve').disabled).toBe(false)
  })
})

describe('crossing', () => {
  async function ready(overrides: Partial<CrossTransferFormDeps> = {}) {
    const context = await withToken(overrides)
    amount().value = '2'
    amount().dispatchEvent(new Event('input'))
    el<HTMLInputElement>('hathorAddress').value = HATHOR_ADDRESS
    return context
  }

  it('submits the typed values and announces the transfer', async () => {
    const { deps } = await ready()
    const heard = vi.fn()
    window.addEventListener(CROSS_FORM_EVENT.transferSent, heard)

    el('crossForm').dispatchEvent(new Event('submit'))
    await settle()

    expect(deps.cross).toHaveBeenCalledWith({
      tokenKey: 'USDC',
      amount: '2',
      hathorAddress: HATHOR_ADDRESS,
    })
    expect(el('receive').textContent).toBe('2.00 hUSDC')
    expect(el('confirmationTime').textContent).toBe(ROUTE.evm.confirmationTime)
    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.transferSuccess)
    expect(heard).toHaveBeenCalledOnce()
  })

  it('re-enables the form after a failure and says what happened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = await ready({
      cross: vi.fn(async () => {
        throw new Error('insufficient balance')
      }),
    })

    el('crossForm').dispatchEvent(new Event('submit'))
    await settle()

    expect(deps.reportError).toHaveBeenCalledWith(expect.stringContaining('insufficient balance'))
    expect(el<HTMLButtonElement>('deposit').disabled).toBe(false)
    expect(amount().disabled).toBe(false)
  })

  it('refuses to submit an amount already marked invalid', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = await ready()
    amount().value = '0.5'
    amount().dispatchEvent(new Event('input'))

    el('crossForm').dispatchEvent(new Event('submit'))
    await settle()

    expect(deps.cross).not.toHaveBeenCalled()
  })
})

describe('the direction toggle', () => {
  it('hides this form when the other direction is chosen', async () => {
    await withToken()
    const htr = document.querySelector<HTMLInputElement>('input[value="htr-to-arb"]')!

    htr.checked = true
    htr.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el('crossForm').style.display).toBe('none')

    const arb = document.querySelector<HTMLInputElement>('input[value="arb-to-htr"]')!
    arb.checked = true
    arb.dispatchEvent(new Event('change', { bubbles: true }))
    expect(el('crossForm').style.display).toBe('block')
  })
})
