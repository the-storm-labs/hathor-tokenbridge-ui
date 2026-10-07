import { describe, it, expect } from 'vitest'
import { evmTransferRow, type EvmTransferRowData } from './evm-transfer-row'

const CONTEXT = {
  currentBlock: 1_000,
  confirmations: 900,
  secondsPerBlock: 0.25,
  explorer: 'https://arbiscan.io',
  signaturesRequired: 4,
  hathorExplorer: 'https://explorer.hathor.network',
}

const transfer = (over: Partial<EvmTransferRowData> = {}): EvmTransferRowData => ({
  transactionHash: '0x' + 'ab'.repeat(32),
  blockNumber: 50,
  amount: '3',
  tokenFrom: 'USDC',
  ...over,
})

const federation = (over: Record<string, unknown> = {}) => ({
  signatures: 0,
  hathorFederationStatus: null,
  delivered: false,
  deliveryTxId: null,
  ...over,
})

describe('evmTransferRow status', () => {
  it('counts down the Arbitrum confirmations, with the time left', () => {
    const html = evmTransferRow(transfer({ blockNumber: 900 }), CONTEXT)
    expect(html).toContain('Confirming on Arbitrum')
    expect(html).toContain('mins')
  })

  it('waits for the federation once confirmed', () => {
    expect(evmTransferRow(transfer(), CONTEXT)).toContain('Waiting for the federation')
  })

  it('shows the Hathor signatures with the same meter as the other direction', () => {
    const html = evmTransferRow(
      transfer({
        federation: federation({ hathorFederationStatus: 'ProposalSigned', signatures: 2 }),
      }),
      CONTEXT,
    )
    expect(html).toContain('Signing on Hathor')
    expect(html).toContain('2/4')
  })

  it('shows a failed push as delayed, not failed', () => {
    const html = evmTransferRow(
      transfer({ federation: federation({ hathorFederationStatus: 'TransactionFailed' }) }),
      CONTEXT,
    )
    expect(html).toContain('Delayed')
    expect(html).not.toContain('Failed')
  })

  it('links a delivered transfer to its Hathor transaction', () => {
    const html = evmTransferRow(
      transfer({ federation: federation({ delivered: true, deliveryTxId: '00bf68c99dc4aa11' }) }),
      CONTEXT,
    )
    expect(html).toContain('Delivered')
    expect(html).toContain('https://explorer.hathor.network/transaction/00bf68c99dc4aa11')
    expect(html).toContain('View on Hathor')
    // The id only in the link's href, never as text.
    expect(html.replace(/href="[^"]*"/g, '')).not.toContain('00bf68')
  })
})
