import { describe, it, expect } from 'vitest'
import BigNumber from 'bignumber.js'
import { validateAmount, rejectionMessage } from './limits'

const limits = { min: 1, max: 100_000, feeRate: 0.002 }
const bn = (v: string) => new BigNumber(v)

describe('validateAmount', () => {
  it('accepts an amount inside the limits', () => {
    expect(validateAmount('50', bn('50.1'), limits)).toBeNull()
  })

  it('rejects a blank amount before anything else', () => {
    expect(validateAmount('', bn('0'), limits)).toEqual({ kind: 'empty' })
  })

  it('rejects zero and negatives', () => {
    expect(validateAmount('0', bn('0'), limits)).toEqual({ kind: 'not-positive' })
    expect(validateAmount('-1', bn('-1'), limits)).toEqual({ kind: 'not-positive' })
  })

  it('reports the minimum net of fee', () => {
    const rejection = validateAmount('0.5', bn('0.5'), limits)
    expect(rejection?.kind).toBe('below-minimum')
    expect(rejectionMessage(rejection!)).toBe('Minimum amount 0.998 token')
  })

  it('reports the maximum net of fee', () => {
    const rejection = validateAmount('200000', bn('200000'), limits)
    expect(rejection?.kind).toBe('above-maximum')
    expect(rejectionMessage(rejection!)).toBe('Max amount 99800 tokens')
  })

  it('validates the total cost, not the typed amount', () => {
    // 99_999 typed becomes 100_199.4 with fee, which is over the cap.
    expect(validateAmount('99999', bn('100199.4'), limits)?.kind).toBe('above-maximum')
  })

  it('treats the boundaries as inclusive', () => {
    expect(validateAmount('1', bn('1'), limits)).toBeNull()
    expect(validateAmount('100000', bn('100000'), limits)).toBeNull()
  })

  it('drops the fee term from the message when the fee is zero', () => {
    const zeroFee = { min: 1, max: 100, feeRate: 0 }
    expect(rejectionMessage(validateAmount('0.5', bn('0.5'), zeroFee)!)).toBe(
      'Minimum amount 1 token',
    )
  })
})

describe('rejectionMessage', () => {
  it('matches the strings the form showed before the refactor', () => {
    expect(rejectionMessage({ kind: 'empty' })).toBe('Invalid amount')
    expect(rejectionMessage({ kind: 'not-positive' })).toBe('Must be bigger than 0')
  })
})
