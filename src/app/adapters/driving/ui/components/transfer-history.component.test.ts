// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { mountTransferHistory, type TransferHistoryDeps } from './transfer-history.component'
import { ROUTES } from '../../../../config/networks'
import { TransferStatus } from '../../../../ports/driven/bridge-api.port'
import type { BridgeTransfer } from '../../../../domain/model/transfer'
import type { ClaimRequest } from '../../../../ports/driven/contracts.port'

const ROUTE = ROUTES.mainnet
const ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678'

const MARKUP = `
  <div id="previousTxnsEmptyTab"></div>
  <div id="previousTxnsTab">
    <a id="nav-htr-eth-tab" class="active"></a>
    <a id="nav-eth-htr-tab"></a>
    <div id="nav-htr-eth" class="active show"><table><tbody id="htr-eth-tbody"></tbody></table></div>
    <div id="nav-eth-htr"><table><tbody id="eth-htr-tbody"></tbody></table></div>
    <div class="btn-toolbar">
      <button id="txn-previous"></button>
      <button id="txn-next"></button>
    </div>
  </div>
`

const CLAIM: ClaimRequest = {
  to: ACCOUNT,
  amount: '2000000000000000000',
  blockHash: '0xabc',
  logIndex: 0,
  originChainId: 31,
  destinationChainId: 42161,
}

function hathorTransfer(overrides: Partial<BridgeTransfer> = {}): BridgeTransfer {
  return {
    transactionId: 'tx-1',
    transactionHash: null,
    backendTxHash: null,
    hathorTxId: '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532',
    displayedTxHash: '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532',
    tokenSymbol: 'USDC',
    tokenDecimals: 2,
    amount: '200',
    amountDecimals: 2,
    sender: 'HDeadbeefDeadbeefDeadbeefDeadbeef01',
    status: TransferStatus.AwaitingClaim,
    votes: 4,
    signatures: 4,
    blockNumber: null,
    claim: CLAIM,
    ...overrides,
  }
}

function setup(overrides: Partial<TransferHistoryDeps> = {}) {
  document.body.innerHTML = MARKUP

  let onBlock: ((blockNumber: number) => void) | null = null
  const stopWatching = vi.fn()

  const deps: TransferHistoryDeps = {
    route: ROUTE,
    getEvmAddress: () => ACCOUNT,
    loadHistory: vi.fn(async () => ({ hathorToEvm: [], evmToHathor: [] })),
    listStored: vi.fn(() => []),
    claim: vi.fn(async () => ({})),
    watchBlockNumber: vi.fn((callback) => {
      onBlock = callback
      return stopWatching
    }),
    reportError: vi.fn(),
    ...overrides,
  }

  const history = mountTransferHistory(document, deps)
  return { history, deps, stopWatching, block: (n: number) => onBlock?.(n) }
}

const el = (id: string) => document.getElementById(id) as HTMLElement
const rows = (id: string) => el(id).querySelectorAll('tr')
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('polling', () => {
  it('starts once, however often it is asked', () => {
    const { history, deps } = setup()
    history.start()
    history.start()

    // The original cleared no interval on a network switch and simply started
    // another, doubling the request rate each time.
    expect(deps.watchBlockNumber).toHaveBeenCalledOnce()
  })

  it('stops and can be started again', () => {
    const { history, stopWatching, deps } = setup()
    history.start()
    history.stop()
    expect(stopWatching).toHaveBeenCalledOnce()

    history.start()
    expect(deps.watchBlockNumber).toHaveBeenCalledTimes(2)
  })

  it('reloads the history on each new block', async () => {
    const { history, deps, block } = setup()
    history.start()
    block(1000)
    await settle()

    expect(deps.loadHistory).toHaveBeenCalledWith(ACCOUNT)
  })

  it('asks for nothing while no account is connected', async () => {
    const { history, deps } = setup({ getEvmAddress: () => '' })
    await history.refresh()
    expect(deps.loadHistory).not.toHaveBeenCalled()
  })
})

describe('rendering', () => {
  it('shows the empty state when both sides are empty', async () => {
    const { history } = setup()
    history.start()
    await history.refresh()

    // Explicit, because the stylesheet hides both by default.
    expect(el('previousTxnsEmptyTab').style.display).toBe('block')
    expect(el('previousTxnsTab').style.display).toBe('none')
  })

  it('leaves the page alone when idle and empty', () => {
    // Hathor-origin rows can arrive with no EVM wallet, and therefore no
    // poller; flashing the empty state in between would be wrong.
    const { history } = setup()
    history.render()
    expect(el('previousTxnsTab').style.display).toBe('')
  })

  it('renders one row per transfer, into the table for its origin', async () => {
    const { history } = setup({
      loadHistory: async () => ({
        hathorToEvm: [hathorTransfer(), hathorTransfer({ transactionId: 'tx-2', claim: null })],
        evmToHathor: [
          { transactionHash: '0xfeed0000feed', blockNumber: 10, amount: '1.5', tokenFrom: 'USDC' },
        ],
      }),
    })
    history.start()
    await history.refresh()

    expect(rows('eth-htr-tbody')).toHaveLength(2)
    expect(rows('htr-eth-tbody')).toHaveLength(1)
  })

  it("uses the route's federator count for the approval meter, not a hardcoded four", async () => {
    // Golf testnet runs a single federator — this used to render 4/4 no
    // matter which route was showing the row.
    const { history } = setup({
      route: { ...ROUTE, signaturesRequired: 1 },
      loadHistory: async () => ({
        hathorToEvm: [
          hathorTransfer({ status: TransferStatus.HathorVoting, signatures: 1, claim: null }),
        ],
        evmToHathor: [],
      }),
    })
    history.start()
    await history.refresh()

    const html = el('eth-htr-tbody').innerHTML
    expect(html).toContain('1/1')
    expect(html).not.toContain('/4')
  })

  it('paginates at six rows and disables the boundaries', async () => {
    const many = Array.from({ length: 8 }, (_, i) => hathorTransfer({ transactionId: `tx-${i}` }))
    const { history } = setup({
      loadHistory: async () => ({ hathorToEvm: many, evmToHathor: [] }),
    })
    history.start()
    await history.refresh()
    history.showTab('hathor')

    expect(rows('eth-htr-tbody')).toHaveLength(6)
    expect((el('txn-previous') as HTMLButtonElement).disabled).toBe(true)
    expect((el('txn-next') as HTMLButtonElement).disabled).toBe(false)

    el('txn-next').click()
    expect(rows('eth-htr-tbody')).toHaveLength(2)
    expect((el('txn-next') as HTMLButtonElement).disabled).toBe(true)
  })

  it('hides the pager when everything fits on one page', async () => {
    const { history } = setup({
      loadHistory: async () => ({ hathorToEvm: [hathorTransfer()], evmToHathor: [] }),
    })
    history.start()
    await history.refresh()

    expect(document.querySelector<HTMLElement>('.btn-toolbar')!.style.display).toBe('none')
  })

  it('follows the user clicking a tab, without Bootstrap telling it', () => {
    // shown.bs.tab is a jQuery event and never reaches addEventListener.
    const { history } = setup({
      loadHistory: async () => ({
        hathorToEvm: Array.from({ length: 8 }, () => hathorTransfer()),
        evmToHathor: [],
      }),
    })
    history.start()
    return history.refresh().then(() => {
      expect(document.querySelector<HTMLElement>('.btn-toolbar')!.style.display).toBe('none')

      el('nav-eth-htr-tab').click()
      expect(document.querySelector<HTMLElement>('.btn-toolbar')!.style.display).toBe('')
    })
  })

  it('brings a tab to the front without touching the URL', () => {
    const { history } = setup()
    history.showTab('hathor')

    expect(el('nav-eth-htr-tab').classList.contains('active')).toBe(true)
    expect(el('nav-htr-eth-tab').classList.contains('active')).toBe(false)
    expect(el('nav-eth-htr').classList.contains('show')).toBe(true)
    // The original assigned location.hash twice, leaving a stale fragment and
    // a back-history entry behind.
    expect(window.location.hash).toBe('')
  })
})

describe('showStored', () => {
  it('reads each side under the network name it is keyed by', () => {
    const { history, deps } = setup()
    history.showStored()

    expect(deps.listStored).toHaveBeenCalledWith(ACCOUNT, ROUTE.hathor.name)
    expect(deps.listStored).toHaveBeenCalledWith(ACCOUNT, ROUTE.evm.name)
  })

  it('takes the receiver of a Hathor-origin transfer over the connected account', () => {
    // That form works with no EVM wallet, and the transfer is keyed by its
    // destination rather than by whoever happens to be connected.
    const destination = '0xfeedfacefeedfacefeedfacefeedfacefeedface'
    const { history, deps } = setup()
    history.showStored(destination)

    expect(deps.listStored).toHaveBeenCalledWith(destination, ROUTE.hathor.name)
  })

  it('renders no Claim button, since storage carries no claim request', () => {
    const { history } = setup({
      listStored: (_address, network) =>
        network === ROUTE.hathor.name
          ? [{ status: TransferStatus.AwaitingClaim, amount: '200', amountDecimals: 2 }]
          : [],
    })
    history.showStored()

    // A button built from unresolved data could point at a transfer that was
    // already claimed on-chain.
    expect(el('eth-htr-tbody').querySelector('.claim-button')).toBeNull()
  })
})

describe('claiming', () => {
  async function withClaimable(overrides: Partial<TransferHistoryDeps> = {}) {
    const context = setup({
      loadHistory: async () => ({ hathorToEvm: [hathorTransfer()], evmToHathor: [] }),
      ...overrides,
    })
    context.history.start()
    await context.history.refresh()
    return context
  }

  it('submits the typed request the use case built', async () => {
    const { deps } = await withClaimable()
    el('eth-htr-tbody').querySelector<HTMLButtonElement>('.claim-button')!.click()
    await settle()

    // Not re-parsed out of data-* attributes: the amount never becomes a string
    // in the DOM and back.
    expect(deps.claim).toHaveBeenCalledWith(CLAIM)
  })

  it('stops the poll while the claim is in flight and resumes after', async () => {
    const { deps, stopWatching } = await withClaimable()
    el('eth-htr-tbody').querySelector<HTMLButtonElement>('.claim-button')!.click()
    await settle()

    expect(stopWatching).toHaveBeenCalled()
    expect(deps.watchBlockNumber).toHaveBeenCalledTimes(2)
  })

  it('reports a rejected claim instead of leaving the row unchanged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = await withClaimable({
      claim: vi.fn(async () => {
        throw new Error('reverted')
      }),
    })

    el('eth-htr-tbody').querySelector<HTMLButtonElement>('.claim-button')!.click()
    await settle()

    expect(deps.reportError).toHaveBeenCalledWith(expect.stringContaining('reverted'))
  })

  it('claims once however many times the table was repainted', async () => {
    const { deps, history } = await withClaimable()
    history.render()
    history.render()

    el('eth-htr-tbody').querySelector<HTMLButtonElement>('.claim-button')!.click()
    await settle()

    // The original re-bound a listener per button on every repaint, so a row
    // that survived ten of them fired ten claims.
    expect(deps.claim).toHaveBeenCalledOnce()
  })
})
