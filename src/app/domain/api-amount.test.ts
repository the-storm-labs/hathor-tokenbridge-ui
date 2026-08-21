import { describe, it, expect } from 'vitest'
import BigNumber from 'bignumber.js'
import { apiAmountDecimals } from './api-amount'

const HATHOR_DECIMALS = 2

/** What the history row does with the scale this function picks. */
const render = (amount: string, status: string | null) =>
  new BigNumber(amount)
    .shiftedBy(-apiAmountDecimals(status, HATHOR_DECIMALS))
    .toFormat(HATHOR_DECIMALS, BigNumber.ROUND_DOWN)

describe('apiAmountDecimals', () => {
  it('uses Hathor units while only the Hathor federation has seen the transfer', () => {
    expect(apiAmountDecimals('hathor_voting', HATHOR_DECIMALS)).toBe(HATHOR_DECIMALS)
  })

  it('uses the 18-decimal wire scale for every later stage', () => {
    for (const status of ['evm_voting', 'awaiting_claim', 'claimed']) {
      expect(apiAmountDecimals(status, HATHOR_DECIMALS), status).toBe(18)
    }
  })

  it('falls back to the wire scale for an unknown or missing status', () => {
    // A status this build does not know about came from the EVM side, so the
    // wire scale is the safer default.
    expect(apiAmountDecimals(null, HATHOR_DECIMALS)).toBe(18)
    expect(apiAmountDecimals('some_future_status', HATHOR_DECIMALS)).toBe(18)
  })

  it('respects a token with a different Hathor precision', () => {
    expect(apiAmountDecimals('hathor_voting', 3)).toBe(3)
  })
})

describe('rendering real records', () => {
  it('renders a hathor_voting record at its true value, not 0.00', () => {
    // The bug: `500` is 5.00 USDC in Hathor units. Dividing it by 1e18 rendered
    // a real 5 USDC transfer as 0.00.
    expect(render('500', 'hathor_voting')).toBe('5.00')
    expect(render('500', 'claimed')).toBe('0.00')
  })

  it('renders the later stages of the same transfer identically', () => {
    // The amount changes scale as the transfer progresses; the displayed value
    // must not.
    expect(render('500', 'hathor_voting')).toBe('5.00')
    expect(render('5000000000000000000', 'evm_voting')).toBe('5.00')
    expect(render('5000000000000000000', 'claimed')).toBe('5.00')
  })

  it('renders the 2 HTR transfer seen in production', () => {
    expect(render('200', 'hathor_voting')).toBe('2.00')
    expect(render('2000000000000000000', 'evm_voting')).toBe('2.00')
  })
})
