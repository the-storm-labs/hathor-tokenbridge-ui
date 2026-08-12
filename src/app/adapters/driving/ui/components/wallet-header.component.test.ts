// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import {
  mountWalletHeader,
  WALLET_EVENT,
  type WalletHeaderDeps,
} from './wallet-header.component'
import { ROUTES, routeForChainId } from '../../../../config/networks'

const ROUTE = ROUTES.mainnet
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678'
const OTHER_ACCOUNT = '0xfeedfacefeedfacefeedfacefeedfacefeedface'

const WALLET = { rdns: 'io.metamask', name: 'MetaMask', icon: 'data:,' }
const PROVIDER = { request: async () => null }

const MARKUP = `
  <button id="logIn">Connect EVM</button>
  <div class="wallet-status indicator" style="display:none">
    <span class="indicator"><span></span></span>
    <span id="evmNetwork"></span>
    <span id="address"></span>
    <button id="disconnectEvmWallet">&times;</button>
  </div>
  <span class="fromNetwork"></span>
  <span class="toNetwork"></span>
  <div id="transferTab" class="disabled"></div>
  <div id="myModal">
    <h5 class="modal-title"></h5>
    <div id="modal-message-content" style="display:none"></div>
    <ul id="wallet-list"></ul>
  </div>
`

function setup(overrides: Partial<WalletHeaderDeps> = {}) {
  document.body.innerHTML = MARKUP

  const handlers: {
    chain?: (chainId: string) => void
    accounts?: (accounts: string[]) => void
    disconnect?: () => void
  } = {}

  const deps: WalletHeaderDeps = {
    route: ROUTE,
    discoveredWallets: () => [WALLET],
    connect: vi.fn(async () => ({
      accounts: [ACCOUNT],
      chainId: ROUTE.evm.chainId,
      provider: PROVIDER,
    })),
    reconnect: vi.fn(async () => null),
    forget: vi.fn(),
    walletEvents: () => ({
      onChainChanged: (handler) => {
        handlers.chain = handler
      },
      onAccountsChanged: (handler) => {
        handlers.accounts = handler
      },
      onDisconnect: (handler) => {
        handlers.disconnect = handler
      },
    }),
    adoptProvider: vi.fn(),
    routeForChainId: (chainId) => routeForChainId(chainId, 'mainnet'),
    setAccount: vi.fn(),
    setRoute: vi.fn(),
    ...overrides,
  }

  const header = mountWalletHeader(document, deps)
  return { header, deps, handlers }
}

const el = (id: string) => document.getElementById(id) as HTMLElement
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Opens the picker and connects the one discovered wallet. */
async function connect(context: ReturnType<typeof setup>) {
  el('logIn').click()
  el('wallet-list').querySelector<HTMLElement>('[data-rdns]')!.click()
  await settle()
  return context
}

describe('mounting', () => {
  it('starts disconnected, with the transfer card disabled', () => {
    setup()
    expect(el('logIn').style.display).toBe('')
    expect(el('transferTab').classList.contains('disabled')).toBe(true)
    expect(document.querySelector<HTMLElement>('.wallet-status')!.style.display).toBe('none')
  })
})

describe('picking a wallet', () => {
  it('lists the wallets that announced themselves', () => {
    setup()
    el('logIn').click()

    expect(el('wallet-list').querySelectorAll('[data-rdns]')).toHaveLength(1)
    expect(el('wallet-list').textContent).toContain('MetaMask')
  })

  it('says so when nothing is installed', () => {
    setup({ discoveredWallets: () => [] })
    el('logIn').click()

    expect(el('modal-message-content').textContent).toContain('MetaMask')
    expect(el('wallet-list').style.display).toBe('none')
  })

  it('adopts the provider and shows the account', async () => {
    const context = setup()
    await connect(context)

    expect(context.deps.adoptProvider).toHaveBeenCalledWith(PROVIDER)
    expect(context.deps.setAccount).toHaveBeenCalledWith(ACCOUNT)
    expect(context.deps.setRoute).toHaveBeenCalledWith(ROUTE)
    expect(el('address').textContent).toContain('...')
    expect(el('evmNetwork').textContent).toBe('Arbitrum One')
    expect(el('logIn').style.display).toBe('none')
    expect(el('transferTab').classList.contains('disabled')).toBe(false)
  })

  it('announces the connection once', async () => {
    const heard = vi.fn()
    window.addEventListener(WALLET_EVENT.connected, heard)
    await connect(setup())

    expect(heard).toHaveBeenCalledOnce()
  })

  it('reports a refused connection without leaving the page half-connected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const context = setup({
      connect: vi.fn(async () => {
        throw new Error('user rejected')
      }),
    })
    await connect(context)

    expect(context.deps.forget).toHaveBeenCalled()
    expect(el('modal-message-content').textContent).toContain('user rejected')
    expect(el('transferTab').classList.contains('disabled')).toBe(true)
  })
})

describe('the wrong network', () => {
  it('refuses a chain this deployment does not bridge', async () => {
    const context = setup({
      connect: vi.fn(async () => ({ accounts: [ACCOUNT], chainId: 1, provider: PROVIDER })),
    })
    await connect(context)

    expect(context.deps.setRoute).toHaveBeenCalledWith(null)
    expect(context.deps.setAccount).not.toHaveBeenCalledWith(ACCOUNT)
    expect(document.querySelector('.indicator')!.classList.contains('btn-outline-danger')).toBe(
      true,
    )
    expect(el('modal-message-content').textContent).toContain('Arbitrum One')
  })
})

describe('provider events', () => {
  it('re-checks the chain when the wallet switches network', async () => {
    const context = setup()
    await connect(context)

    context.handlers.chain!('0x1')
    expect(context.deps.setRoute).toHaveBeenLastCalledWith(null)
  })

  it('ignores chain events that arrive after the wallet was dropped', async () => {
    const context = setup()
    await connect(context)
    context.handlers.chain!('0x1')

    // These handlers outlive the connection — dropping a wallet does not
    // detach them from its provider. Repainting the header as connected here
    // would show a good network with no account and no provider behind it.
    const heard = vi.fn()
    window.addEventListener(WALLET_EVENT.connected, heard)
    context.handlers.chain!(String(ROUTE.evm.chainId))

    expect(heard).not.toHaveBeenCalled()
    expect(el('transferTab').classList.contains('disabled')).toBe(true)
  })

  it('follows an account switch', async () => {
    const context = setup()
    await connect(context)

    const heard = vi.fn()
    window.addEventListener(WALLET_EVENT.accountChanged, heard)
    context.handlers.accounts!([OTHER_ACCOUNT])

    expect(context.deps.setAccount).toHaveBeenLastCalledWith(OTHER_ACCOUNT)
    expect(heard).toHaveBeenCalledOnce()
  })

  it('treats an empty account list as a disconnection', async () => {
    const context = setup()
    await connect(context)
    context.handlers.accounts!([])

    expect(context.deps.forget).toHaveBeenCalled()
    expect(el('transferTab').classList.contains('disabled')).toBe(true)
  })
})

describe('disconnecting', () => {
  it('clears the header, the provider and the stored preference', async () => {
    const context = setup()
    await connect(context)

    const heard = vi.fn()
    window.addEventListener(WALLET_EVENT.disconnected, heard)
    el('disconnectEvmWallet').click()

    expect(context.deps.forget).toHaveBeenCalled()
    expect(context.deps.adoptProvider).toHaveBeenLastCalledWith(null)
    expect(context.deps.setAccount).toHaveBeenLastCalledWith('')
    expect(el('logIn').style.display).toBe('')
    expect(heard).toHaveBeenCalledOnce()
  })
})

describe('reconnecting on the next visit', () => {
  it('adopts the remembered wallet without opening the picker', async () => {
    const context = setup({
      reconnect: vi.fn(async () => ({
        wallet: WALLET,
        connection: { accounts: [ACCOUNT], chainId: ROUTE.evm.chainId, provider: PROVIDER },
      })),
    })

    await context.header.reconnect()

    expect(el('address').textContent).toContain('...')
    expect(el('transferTab').classList.contains('disabled')).toBe(false)
  })

  it('leaves the page as it loaded when there is nothing to reconnect to', async () => {
    const context = setup()
    await context.header.reconnect()

    expect(el('transferTab').classList.contains('disabled')).toBe(true)
  })
})
