import { describe, it, expect } from 'vitest'
import { gasPriceFor, needsLatestBlockMinimum } from './gas-price'

// Verified against all three copies of this rule in index.js (approveSpend,
// crossToken, claimToken) before they were replaced by one call.
describe('gasPriceFor', () => {
  it('applies the 1.3x multiplier off the RSK range', () => {
    // 100000000 * 1.3 = 130000000 = 0x7bfa480
    expect(gasPriceFor(42161, { averageGasPrice: '100000000' })).toBe('0x7bfa480')
  })

  it('applies the 1.03x multiplier and the block minimum on the RSK range', () => {
    // 59240000 * 1.03 = 61017200 = 0x3a30c70
    expect(
      gasPriceFor(31, { averageGasPrice: 'ignored', latestBlockMinimumGasPrice: '59240000' }),
    ).toBe('0x3a30c70')
  })

  it('floors at 1', () => {
    expect(gasPriceFor(42161, { averageGasPrice: '1' })).toBe('0x1')
    expect(gasPriceFor(42161, { averageGasPrice: '0' })).toBe('0x1')
    expect(gasPriceFor(30, { averageGasPrice: 'x', latestBlockMinimumGasPrice: '1' })).toBe('0x1')
  })

  it('rounds up', () => {
    // 7 * 1.3 = 9.1 -> ceil 10 -> 0xa
    expect(gasPriceFor(42161, { averageGasPrice: '7' })).toBe('0xa')
  })

  it('falls back to the floor on an unparseable price', () => {
    // The original produced '0xNaN' here, which is not a valid gasPrice field.
    expect(gasPriceFor(42161, { averageGasPrice: 'not-a-number' })).toBe('0x1')
    expect(gasPriceFor(42161, { averageGasPrice: '' })).toBe('0x1')
    expect(gasPriceFor(30, { averageGasPrice: '100' })).toBe('0x1')
  })

  it('covers the whole RSK range boundary', () => {
    expect(needsLatestBlockMinimum(29)).toBe(false)
    expect(needsLatestBlockMinimum(30)).toBe(true)
    expect(needsLatestBlockMinimum(33)).toBe(true)
    expect(needsLatestBlockMinimum(34)).toBe(false)
    // The live configs are 42161 / 11155111, so neither takes the RSK branch.
    expect(needsLatestBlockMinimum(42161)).toBe(false)
    expect(needsLatestBlockMinimum(11155111)).toBe(false)
  })
})
