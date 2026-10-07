import { describe, it, expect } from 'vitest'
import { dashboardLink } from './dashboard-link'
import { evmTransferRow } from './evm-transfer-row'
import { hathorTransferRow } from './hathor-transfer-row'

const DASHBOARD = 'https://dashboard.example'
const EVM_HASH = '0xfc5d8dec6af6873c8b343e56ea4fb43e969276c737d6fa0e3ec87c42410f4800'
const HATHOR_TX = '003fc8498ce2e5b6749f1977e0b8cbf37707f8b127de054d13d83e533aec4623'

describe('dashboardLink', () => {
  it('links /tx/<hash> on the dashboard, in a new tab', () => {
    const html = dashboardLink(EVM_HASH, `${DASHBOARD}/`)
    expect(html).toContain(`href="${DASHBOARD}/tx/${EVM_HASH}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('renders nothing without a dashboard, without a hash, or for something that is not a hash', () => {
    expect(dashboardLink(EVM_HASH, undefined)).toBe('')
    expect(dashboardLink(null, DASHBOARD)).toBe('')
    expect(dashboardLink('"><script>', DASHBOARD)).toBe('')
  })
})

describe('history rows', () => {
  it('EVM -> Hathor: tracks the Cross transaction hash', () => {
    const html = evmTransferRow(
      {
        transactionHash: EVM_HASH,
        blockNumber: 1,
        amount: '1',
        amountDecimals: 6,
        tokenFrom: 'USDC',
      },
      {
        currentBlock: 2000,
        confirmations: 900,
        secondsPerBlock: 0.25,
        explorer: 'https://arbiscan.io',
        dashboardUrl: DASHBOARD,
        signaturesRequired: 4,
        hathorExplorer: 'https://explorer.hathor.network',
      },
    )
    expect(html).toContain(`${DASHBOARD}/tx/${EVM_HASH}`)
  })

  it('Hathor -> EVM: tracks the Hathor transaction id', () => {
    const html = hathorTransferRow(
      { hathorTxId: HATHOR_TX, amount: '200', amountDecimals: 2, tokenSymbol: 'hUSDC' },
      'https://explorer.hathor.network',
      4,
      DASHBOARD,
    )
    expect(html).toContain(`${DASHBOARD}/tx/${HATHOR_TX}`)
  })

  it('Hathor -> EVM keyed by an EVM id still gets a dashboard link, though no explorer one', () => {
    const html = hathorTransferRow(
      { transactionHash: EVM_HASH, amount: '1' },
      'https://explorer.hathor.network',
      4,
      DASHBOARD,
    )
    expect(html).not.toContain('explorer.hathor.network/transaction')
    expect(html).toContain(`${DASHBOARD}/tx/${EVM_HASH}`)
  })

  it('leaves rows untouched where the deployment has no dashboard', () => {
    const html = hathorTransferRow(
      { hathorTxId: HATHOR_TX, amount: '1' },
      'https://explorer.hathor.network',
      4,
    )
    expect(html).not.toContain('/tx/')
  })
})
