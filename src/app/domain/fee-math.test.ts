import { describe, it, expect } from 'vitest'
import BigNumber from 'bignumber.js'
import { quote, formatQuoteValue, maxTransferable } from './fee-math'

// Verified against the original isAmountOk / checkAllowance / getMaxBalance math
// before those were replaced.
describe('quote', () => {
  it('charges the fee on top, not inside', () => {
    // 100 arriving at a 0.2% fee costs 100/0.998, not 100*1.002.
    const q = quote('100', 0.002)
    expect(formatQuoteValue(q.totalCost)).toBe('100.200400')
    expect(formatQuoteValue(q.serviceFee)).toBe('0.200400')
  })

  it('short-circuits a zero fee', () => {
    const q = quote('100', 0)
    expect(formatQuoteValue(q.totalCost)).toBe('100.000000')
    expect(formatQuoteValue(q.serviceFee)).toBe('0.000000')
  })

  it('treats a blank amount as zero', () => {
    const q = quote('', 0.002)
    expect(formatQuoteValue(q.totalCost)).toBe('0.000000')
    expect(formatQuoteValue(q.serviceFee)).toBe('0.000000')
  })

  it('handles a 50% fee (total is double the amount)', () => {
    const q = quote('1', 0.5)
    expect(formatQuoteValue(q.totalCost)).toBe('2.000000')
    expect(formatQuoteValue(q.serviceFee)).toBe('1.000000')
  })

  it('accepts a BigNumber without re-parsing', () => {
    expect(formatQuoteValue(quote(new BigNumber('100'), 0).totalCost)).toBe('100.000000')
  })
})

describe('formatQuoteValue', () => {
  it('groups thousands', () => {
    // toFormat, not toFixed — dropping the separator would change the UI.
    expect(formatQuoteValue(new BigNumber('1234.5'))).toBe('1,234.500000')
    expect(formatQuoteValue(new BigNumber('1234567.891234567'))).toBe('1,234,567.891234')
  })

  it('truncates the 7th decimal instead of rounding it', () => {
    expect(formatQuoteValue(new BigNumber('0.9999999'))).toBe('0.999999')
  })
})

describe('maxTransferable', () => {
  it('caps at the bridge withdraw limit when the balance exceeds it', () => {
    expect(maxTransferable(new BigNumber('100'), new BigNumber('50'), 0.002, 6)).toBe('49.900000')
  })

  it('uses the balance when it is below the limit', () => {
    expect(maxTransferable(new BigNumber('10'), new BigNumber('1000'), 0, 18)).toBe(
      '10.000000000000000000',
    )
  })

  it('truncates at the token decimals', () => {
    expect(maxTransferable(new BigNumber('5.555555'), new BigNumber('5.555555'), 0.01, 2)).toBe(
      '5.49',
    )
  })

  it('is zero for an empty balance', () => {
    expect(maxTransferable(new BigNumber('0'), new BigNumber('10'), 0.002, 6)).toBe('0.000000')
  })
})
