// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import {
  mountHathorTransferForm,
  HATHOR_FORM_EVENT,
  type HathorTransferFormDeps,
} from './hathor-transfer-form.component'
import {
  Eip7702DelegatedError,
  TransferLimitError,
} from '../../../../application/use-cases/send-hathor-transfer'
import { UserRejectedError } from '../../../../ports/driven/hathor-wallet.port'
import { tokensFor } from '../../../../config/tokens'
import type { WeiLimits } from '../../../../domain/limits'
import { mountTokenSelect } from './token-select.component'
import { TOAST } from '../toasts'

const TOKENS = tokensFor('mainnet')

const MARKUP = `
  <button id="connectHathorWallet">Connect Hathor</button>
  <div id="hathorWalletInfo" style="display:none">
    <span id="hathorWalletAddress"></span>
    <button id="disconnectHathorWallet">&times;</button>
  </div>
  <div id="directionToggle">
    <input type="radio" name="direction" value="arb-to-htr" checked>
    <input type="radio" name="direction" value="htr-to-arb">
  </div>
  <select id="htrTokenSelect" disabled></select>
  <span id="htrTokenBalance">—</span>
  <input id="htrAmount" disabled>
  <div id="htrAmountError"></div>
  <button id="htrMax" disabled></button>
  <input id="htrDestAddress" disabled>
  <button id="htrSendBtn" disabled></button>
  <p id="htrSendErrorMsg"></p>
  <p id="htrDestinationBlockedMsg"></p>
`

const EVM_ADDRESS = '0x1234567890abcdef1234567890ABCDEF12345678'

function setup(overrides: Partial<HathorTransferFormDeps> = {}) {
  document.body.innerHTML = MARKUP

  let connected = false
  // What the adapter would call when the session dies on its own; the tests
  // fire it by hand.
  const sessionLost: Array<() => void> = []
  const wallet = {
    connect: vi.fn(async () => {
      connected = true
      return { address: 'HDeadbeefDeadbeefDeadbeefDeadbeefXX' }
    }),
    disconnect: vi.fn(async () => {
      connected = false
    }),
    getAddress: () => (connected ? 'HDeadbeefDeadbeefDeadbeefDeadbeefXX' : null),
    isConnected: () => connected,
    onSessionLost: (listener: () => void) => void sessionLost.push(listener),
  }
  const loseSession = () => {
    connected = false
    for (const listener of sessionLost) listener()
  }

  const deps: HathorTransferFormDeps = {
    tokens: TOKENS,
    wallet,
    refreshBalance: vi.fn(async () => '12.34'),
    sendTransfer: vi.fn(async () => ({})),
    toasts: { show: vi.fn(), hide: vi.fn() },
    tokenSelect: mountTokenSelect(document, 'htrTokenSelect', 'Select token'),
    getEvmAddress: () => EVM_ADDRESS,
    showTokenInfo: vi.fn(),
    // 0.5 to 1,000 tokens, 18-decimal as AllowTokens reports them.
    loadLimits: vi.fn(async () => ({ min: '5' + '0'.repeat(17), max: '1000' + '0'.repeat(18) })),
    ...overrides,
  }

  const form = mountHathorTransferForm(document, deps)
  return { form, deps, wallet, loseSession }
}

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const select = () => el<HTMLSelectElement>('htrTokenSelect')
const amount = () => el<HTMLInputElement>('htrAmount')
const sendButton = () => el<HTMLButtonElement>('htrSendBtn')

/** Lets the microtasks a click handler schedules settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the token dropdown', () => {
  it('offers only tokens that exist on Hathor', () => {
    setup()
    const expected = TOKENS.filter((token) => token.hathor.pureHtrAddress !== '').length
    expect(select().options).toHaveLength(expected)
  })

  it('keeps the form disabled until a wallet is connected', () => {
    setup()
    expect(select().disabled).toBe(true)
    expect(amount().disabled).toBe(true)
    expect(sendButton().disabled).toBe(true)
  })
})

describe('connecting', () => {
  it('enables the form, fills the destination and shows the address', async () => {
    setup()
    el('connectHathorWallet').click()
    await settle()

    expect(el('hathorWalletInfo').style.display).toBe('flex')
    expect(el('hathorWalletAddress').textContent).toContain('...')
    expect(el('connectHathorWallet').style.display).toBe('none')
    expect(select().disabled).toBe(false)
    expect(el<HTMLInputElement>('htrDestAddress').value).toBe(EVM_ADDRESS)
  })

  it('announces the session so the rest of the page can react', async () => {
    setup()
    const heard = vi.fn()
    window.addEventListener(HATHOR_FORM_EVENT.connected, heard)

    el('connectHathorWallet').click()
    await settle()

    expect(heard).toHaveBeenCalledOnce()
  })

  it('restores the button and reports the failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = setup({
      wallet: {
        connect: async () => {
          throw new Error('user rejected')
        },
        disconnect: async () => {},
        getAddress: () => null,
        isConnected: () => false,
        onSessionLost: () => {},
      },
    })

    el('connectHathorWallet').click()
    await settle()

    expect(el<HTMLButtonElement>('connectHathorWallet').disabled).toBe(false)
    expect(el('htrSendErrorMsg').textContent).toContain('user rejected')
    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.hathorSendError)
  })

  it('disconnects from the header button and re-disables the form', async () => {
    const { wallet } = setup()
    el('connectHathorWallet').click()
    await settle()

    el('disconnectHathorWallet').click()
    await settle()

    expect(wallet.disconnect).toHaveBeenCalledOnce()
    expect(el('hathorWalletInfo').style.display).toBe('none')
    expect(amount().disabled).toBe(true)
  })
})

describe('the amount field', () => {
  it('caps what is typed at the token precision on Hathor', async () => {
    setup()
    el('connectHathorWallet').click()
    await settle()

    select().value = 'USDC'
    select().dispatchEvent(new Event('change'))

    // Hathor represents 2 decimals for every token today, so a third one is a
    // promise the destination chain cannot keep.
    amount().value = '1.2345'
    amount().dispatchEvent(new Event('input'))
    expect(amount().value).toBe('1.23')
  })

  it('enables Send only for a positive amount', async () => {
    setup()
    el('connectHathorWallet').click()
    await settle()
    select().value = 'USDC'

    amount().value = '0'
    amount().dispatchEvent(new Event('input'))
    expect(sendButton().disabled).toBe(true)
    expect(amount().classList.contains('is-invalid')).toBe(true)

    amount().value = '1.5'
    amount().dispatchEvent(new Event('input'))
    expect(sendButton().disabled).toBe(false)
    expect(amount().classList.contains('is-invalid')).toBe(false)
  })

  it('does not mark an empty field red — only a value the user actually typed', async () => {
    setup()
    el('connectHathorWallet').click()
    await settle()
    select().value = 'USDC'

    amount().value = '0'
    amount().dispatchEvent(new Event('input'))
    expect(amount().classList.contains('is-invalid')).toBe(true)

    // Deleting back to empty: still nothing to send, but not a mistake either.
    amount().value = ''
    amount().dispatchEvent(new Event('input'))

    expect(amount().classList.contains('is-invalid')).toBe(false)
    expect(sendButton().disabled).toBe(true)
  })

  it('blocks an amount over the token maximum, saying what the maximum is', async () => {
    const { deps } = setup()
    el('connectHathorWallet').click()
    await settle()
    select().value = 'USDC'
    select().dispatchEvent(new Event('change'))
    await settle()
    expect(deps.loadLimits).toHaveBeenCalledWith(expect.objectContaining({ key: 'USDC' }))

    amount().value = '1000.01'
    amount().dispatchEvent(new Event('input'))
    expect(sendButton().disabled).toBe(true)
    expect(amount().classList.contains('is-invalid')).toBe(true)
    expect(el('htrAmountError').textContent).toBe('Max amount 1,000 tokens')

    amount().value = '1000'
    amount().dispatchEvent(new Event('input'))
    expect(sendButton().disabled).toBe(false)
    expect(el('htrAmountError').textContent).toBe('')
  })

  it('blocks an amount under the token minimum', async () => {
    setup()
    el('connectHathorWallet').click()
    await settle()
    select().value = 'USDC'
    select().dispatchEvent(new Event('change'))
    await settle()

    amount().value = '0.4'
    amount().dispatchEvent(new Event('input'))
    expect(sendButton().disabled).toBe(true)
    expect(el('htrAmountError').textContent).toBe('Minimum amount 0.5 tokens')
  })

  it('flags an amount typed before the limits arrived, once they do', async () => {
    let resolve: (limits: WeiLimits) => void = () => {}
    setup({ loadLimits: vi.fn(() => new Promise<WeiLimits>((r) => (resolve = r))) })
    el('connectHathorWallet').click()
    await settle()

    amount().value = '5000'
    amount().dispatchEvent(new Event('input'))
    expect(sendButton().disabled).toBe(false)

    resolve({ min: '0', max: '1000' + '0'.repeat(18) })
    await settle()
    expect(sendButton().disabled).toBe(true)
  })

  it('leaves the field unchecked when the limits cannot be read', async () => {
    // The send use case fails closed on its own; the field just has nothing to say.
    setup({ loadLimits: vi.fn(async () => Promise.reject(new Error('rpc down'))) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    el('connectHathorWallet').click()
    await settle()

    amount().value = '5000'
    amount().dispatchEvent(new Event('input'))
    expect(sendButton().disabled).toBe(false)
  })

  it('fills Max from the balance', async () => {
    setup()
    el('connectHathorWallet').click()
    await settle()
    select().value = 'USDC'

    el('htrMax').click()
    await settle()

    expect(amount().value).toBe('12.34')
    expect(sendButton().disabled).toBe(false)
  })
})

describe('sending', () => {
  async function ready(overrides: Partial<HathorTransferFormDeps> = {}) {
    const context = setup(overrides)
    el('connectHathorWallet').click()
    await settle()
    select().value = 'USDC'
    amount().value = '2.5'
    amount().dispatchEvent(new Event('input'))
    el<HTMLInputElement>('htrDestAddress').value = EVM_ADDRESS
    return context
  }

  it('submits the typed values and announces the transfer', async () => {
    const { deps } = await ready()
    const heard = vi.fn()
    window.addEventListener(HATHOR_FORM_EVENT.transferSent, heard)

    sendButton().click()
    await settle()

    expect(deps.sendTransfer).toHaveBeenCalledWith({
      tokenKey: 'USDC',
      amount: '2.5',
      evmDestination: EVM_ADDRESS,
    })
    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.hathorSendSuccess)
    expect(heard).toHaveBeenCalledOnce()
  })

  it('clears the amount and re-reads the balance once the transfer is confirmed', async () => {
    const { deps } = await ready()

    sendButton().click()
    await settle()

    expect(amount().value).toBe('')
    expect(deps.refreshBalance).toHaveBeenCalled()
  })

  it('keeps the pending toast up until the wallet answers', async () => {
    const { deps } = await ready()
    sendButton().click()
    await settle()

    // Sticky: a WalletConnect confirmation can take minutes and the wallet
    // raises no notification of its own.
    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.hathorSendPending, { autoDismiss: false })
    expect(deps.toasts.hide).toHaveBeenCalledWith(TOAST.hathorSendPending)
  })

  it('marks the destination and sends nothing when it is not an EVM address', async () => {
    const { deps } = await ready()
    const destination = el<HTMLInputElement>('htrDestAddress')
    destination.value = 'not-an-address'

    sendButton().click()
    await settle()

    expect(deps.sendTransfer).not.toHaveBeenCalled()
    expect(destination.classList.contains('is-invalid')).toBe(true)
    expect(el('htrSendErrorMsg').textContent).toContain('Arbitrum address')
  })

  it('reports a rejected transfer and frees the button', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = await ready({
      sendTransfer: vi.fn(async () => {
        throw new Error('wallet said no')
      }),
    })

    sendButton().click()
    await settle()

    expect(el('htrSendErrorMsg').textContent).toBe('wallet said no')
    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.hathorSendError)
    expect(sendButton().disabled).toBe(false)
  })

  it('shows a delegated destination as a block, not a send error', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { deps } = await ready({
      sendTransfer: vi.fn(async () => {
        throw new Eip7702DelegatedError('0x000000000000000000000000000000000000ad')
      }),
    })

    sendButton().click()
    await settle()

    expect(el('htrDestinationBlockedMsg').textContent).toContain('EIP-7702 delegation')
    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.hathorDestinationBlocked)
    expect(deps.toasts.show).not.toHaveBeenCalledWith(TOAST.hathorSendError)
    expect(sendButton().disabled).toBe(false)
    // Nothing reached the wallet — the typed amount is still what was meant.
    expect(amount().value).toBe('2.5')
  })

  it('marks the amount when the send use case refuses it on limits', async () => {
    const { deps } = await ready({
      sendTransfer: vi.fn(async () => {
        throw new TransferLimitError('Max amount 1,000 tokens')
      }),
    })

    sendButton().click()
    await settle()

    expect(amount().classList.contains('is-invalid')).toBe(true)
    expect(el('htrAmountError').textContent).toBe('Max amount 1,000 tokens')
    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.hathorSendError)
    // Nothing was sent, so the amount stays for the user to correct.
    expect(amount().value).toBe('2.5')
  })

  it('shows a cancelled notice, not a send error, when the user declines in their wallet', async () => {
    // A shared spy across this file's other tests, so it starts with calls of
    // its own — cleared here to isolate what this test itself triggers.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = await ready({
      sendTransfer: vi.fn(async () => {
        throw new UserRejectedError()
      }),
    })
    consoleError.mockClear()

    sendButton().click()
    await settle()

    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.hathorSendCancelled)
    expect(deps.toasts.show).not.toHaveBeenCalledWith(TOAST.hathorSendError)
    expect(consoleError).not.toHaveBeenCalled()
    expect(sendButton().disabled).toBe(false)
    // Declining is a settled outcome too — starts the next attempt fresh,
    // same as a confirmed send.
    expect(amount().value).toBe('')
    expect(deps.refreshBalance).toHaveBeenCalled()
  })
})

describe('a restored session', () => {
  it('shows as connected without going through the wallet again', () => {
    const { wallet } = setup()
    const heard = vi.fn()
    window.addEventListener(HATHOR_FORM_EVENT.connected, heard)

    mountHathorTransferForm(document, {
      tokens: TOKENS,
      wallet,
      refreshBalance: async () => '0.00',
      sendTransfer: async () => ({}),
      toasts: { show: vi.fn(), hide: vi.fn() },
      tokenSelect: mountTokenSelect(document, 'htrTokenSelect', 'Select token'),
      getEvmAddress: () => EVM_ADDRESS,
      showTokenInfo: vi.fn(),
      loadLimits: vi.fn(async () => ({ min: '0', max: '0' })),
    }).showConnected('HRestoredRestoredRestoredRestored1')

    expect(wallet.connect).not.toHaveBeenCalled()
    expect(el('hathorWalletInfo').style.display).toBe('flex')
    expect(heard).toHaveBeenCalledOnce()
  })
})

describe('a session that ends on its own', () => {
  it('drops the header and says why', async () => {
    const { deps, loseSession } = setup()
    const heard = vi.fn()
    window.addEventListener(HATHOR_FORM_EVENT.disconnected, heard)

    el<HTMLButtonElement>('connectHathorWallet').click()
    await settle()
    expect(el('hathorWalletInfo').style.display).toBe('flex')

    loseSession()

    expect(el('hathorWalletInfo').style.display).toBe('none')
    expect(el('connectHathorWallet').style.display).toBe('')
    expect(el('htrAmount').hasAttribute('disabled')).toBe(true)
    expect(deps.toasts.show).toHaveBeenCalledWith(TOAST.hathorSessionExpired)
    expect(heard).toHaveBeenCalledOnce()
  })

  it('stays quiet when the user is the one disconnecting', async () => {
    const { deps } = setup()

    el<HTMLButtonElement>('connectHathorWallet').click()
    await settle()
    el<HTMLButtonElement>('disconnectHathorWallet').click()
    await settle()

    expect(el('hathorWalletInfo').style.display).toBe('none')
    expect(deps.toasts.show).not.toHaveBeenCalledWith(TOAST.hathorSessionExpired)
  })
})
