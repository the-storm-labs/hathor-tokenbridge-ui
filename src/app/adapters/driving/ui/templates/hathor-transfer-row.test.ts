import { describe, it, expect } from 'vitest'
import { hathorTransferRow } from './hathor-transfer-row'
import { formatRowAmount } from './amount'
import { approvalMeter } from './approval-meter'
import { transferStatusCell } from './transfer-status'

const EXPLORER = 'https://explorer.hathor.network'
const HATHOR_TX = '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532'
const EVM_TX = '0x3649d02e31bc8ec0e0ca27c2968a38c49e3ab49ff19b8f36ef453a4c1c1441dd'

describe('formatRowAmount', () => {
  it('scales a raw amount by the reported decimals', () => {
    expect(formatRowAmount('2000000000000000000', 18, 2)).toBe('2.00')
    expect(formatRowAmount('500', 2, 2)).toBe('5.00')
  })

  it('re-formats a legacy already-formatted value', () => {
    // Records written by earlier builds hold '1.3000'; a claimed transfer is
    // never rewritten, so the row has to cope rather than migrate.
    expect(formatRowAmount('1.3000', null, 2)).toBe('1.30')
    expect(formatRowAmount('2', null, 2)).toBe('2.00')
  })

  it('parses a legacy value that carries thousands separators', () => {
    // toFormat inserts them, and BigNumber cannot read them back — without
    // stripping, any transfer over 1000 rendered as NaN.
    expect(formatRowAmount('1,234.5000', null, 2)).toBe('1,234.50')
  })

  it('truncates rather than rounds', () => {
    expect(formatRowAmount('2999', 3, 2)).toBe('2.99')
  })

  it('returns the input untouched when it is not a number', () => {
    expect(formatRowAmount('not-a-number', null, 2)).toBe('not-a-number')
  })

  it('treats missing input as zero', () => {
    expect(formatRowAmount(null, 18, 2)).toBe('0.00')
    expect(formatRowAmount(undefined, null, 2)).toBe('0.00')
  })
})

describe('approvalMeter', () => {
  it('paints one filled segment per approval', () => {
    const html = approvalMeter({ signatures: 2 }, true, 4)
    expect((html.match(/#28a745/g) ?? []).length).toBe(2)
    expect((html.match(/#e9ecef/g) ?? []).length).toBe(2)
    expect(html).toContain('2/4')
  })

  it('labels the phase it is counting', () => {
    expect(approvalMeter({ signatures: 1 }, true, 4)).toContain('Hathor federation signatures')
    expect(approvalMeter({ votes: 1 }, false, 4)).toContain('Arbitrum federation votes')
  })

  it('does not overflow when the count exceeds the threshold', () => {
    const html = approvalMeter({ signatures: 9 }, true, 4)
    expect(html).toContain('4/4')
    expect((html.match(/#28a745/g) ?? []).length).toBe(4)
  })

  it('uses the threshold the caller passes, not a hardcoded four', () => {
    // Golf testnet runs a single federator.
    const html = approvalMeter({ signatures: 1 }, true, 1)
    expect(html).toContain('1/1')
    expect((html.match(/#28a745/g) ?? []).length).toBe(1)
    expect((html.match(/#e9ecef/g) ?? []).length).toBe(0)
  })
})

describe('transferStatusCell', () => {
  it('renders a badge per status', () => {
    expect(transferStatusCell('hathor_voting', null)).toContain('Signing on Hathor')
    expect(transferStatusCell('evm_voting', null)).toContain('Voting — in progress')
    expect(transferStatusCell('claimed', null)).toContain('Claimed')
  })

  it('still understands the legacy processing_transfer status', () => {
    expect(transferStatusCell('processing_transfer', null)).toContain('Voting — in progress')
  })

  it('renders a Claim button carrying only its index', () => {
    const html = transferStatusCell('awaiting_claim', 3)
    expect(html).toContain('claim-button')
    expect(html).toContain('data-claim-index="3"')
    // The parameters no longer travel through the DOM.
    expect(html).not.toContain('data-amount')
    expect(html).not.toContain('data-blockhash')
  })

  it('withholds the button when no valid claim could be built', () => {
    // Better no button than one that builds a data hash matching nothing.
    const html = transferStatusCell('awaiting_claim', null)
    expect(html).not.toContain('claim-button')
    // And it does not claim the transfer is still voting: awaiting a claim
    // means voting is over, and the row shows a full approval meter beside it.
    expect(html).toContain('Awaiting claim')
    expect(html).not.toContain('Voting')
  })

  it('renders nothing for an unknown status', () => {
    expect(transferStatusCell('something_new', null)).toBe('')
    expect(transferStatusCell(null, null)).toBe('')
  })
})

describe('hathorTransferRow', () => {
  const base = {
    displayedTxHash: HATHOR_TX,
    sender: 'HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM',
    tokenSymbol: 'aHTR',
    amount: '2000000000000000000',
    amountDecimals: 18,
    tokenDecimals: 2,
    status: 'claimed',
    votes: 4,
    signatures: 0,
    action: '<span>Claimed</span>',
  }

  it('links a Hathor hash to the Hathor explorer', () => {
    const html = hathorTransferRow(base, EXPLORER, 4)
    expect(html).toContain(`${EXPLORER}/transaction/${HATHOR_TX}`)
    expect(html).toContain('00002f8b...738b5532')
  })

  it('shows "Not available" for an EVM hash, which has no Hathor page', () => {
    const html = hathorTransferRow({ ...base, displayedTxHash: EVM_TX }, EXPLORER, 4)
    expect(html).toContain('Not available')
    expect(html).not.toContain('<a href')
  })

  it('shows "Not available" when no explorer url was supplied', () => {
    // The old closure defaulted its config parameter to {}, so a caller that
    // forgot to pass it silently produced this for every row.
    expect(hathorTransferRow(base, null, 4)).toContain('Not available')
  })

  it('hides an EVM sender, which is the relayer rather than the user', () => {
    const html = hathorTransferRow(
      { ...base, sender: '0x89612c955624281a4B3aa41b8b2994A77EDAcEaD' },
      EXPLORER,
      4,
    )
    expect(html).toContain('Not available')
  })

  it('truncates a Hathor sender', () => {
    expect(hathorTransferRow(base, EXPLORER, 4)).toContain('HT55cV...H4NM')
  })

  it('shows a dash when there is no sender at all', () => {
    expect(hathorTransferRow({ ...base, sender: null }, EXPLORER, 4)).toContain('—')
  })

  it('renders the amount at the token precision, with its symbol', () => {
    expect(hathorTransferRow(base, EXPLORER, 4)).toContain('2.00 aHTR')
  })

  it('renders a hathor_voting amount at its own scale', () => {
    const html = hathorTransferRow(
      { ...base, status: 'hathor_voting', amount: '500', amountDecimals: 2, tokenSymbol: 'hUSDC' },
      EXPLORER,
      4,
    )
    // The regression: unscaling this by 18 rendered a real 5 USDC as 0.00.
    expect(html).toContain('5.00 hUSDC')
  })

  it('produces one table row with six cells, one per header', () => {
    const html = hathorTransferRow(base, EXPLORER, 4)
    expect((html.match(/<tr/g) ?? []).length).toBe(1)
    expect((html.match(/<t[hd]/g) ?? []).length).toBe(6)
  })
})

describe('the Date column', () => {
  it('shows when the transfer was made', () => {
    const html = hathorTransferRow(
      { sentAt: '2026-08-27T17:02:24.000Z' },
      'https://explorer.hathor.network',
      4,
      null,
      (date) => date.toISOString().slice(0, 16).replace('T', ' '),
    )
    expect(html).toContain('2026-08-27 17:02')
  })

  it('shows a dash for an older record with no date', () => {
    expect(hathorTransferRow({}, 'https://explorer.hathor.network', 4)).toContain(
      '<td class="align-middle">—</td>',
    )
  })
})
