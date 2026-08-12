import { describe, it, expect } from 'vitest'
import {
  approvalAmount,
  grossUpForFee,
  UNLIMITED_APPROVAL_UNITS,
  type FeeBasis,
} from './approval-amount'
import { toBaseUnits } from './amount-math'

/** The mainnet configuration: 0.2%. */
const TWO_TENTHS_PERCENT: FeeBasis = { feePercentage: 20, feePercentageDivider: 10_000 }
const NO_FEE: FeeBasis = { feePercentage: 0, feePercentageDivider: 10_000 }

describe('grossUpForFee', () => {
  it('adds the fee on top, not as a percentage of the amount', () => {
    // 1 USDC at 6 decimals. 1000000 * 10000 / 9980 = 1002004.008..., truncated.
    expect(grossUpForFee('1000000', TWO_TENTHS_PERCENT)).toBe('1002004')
  })

  it('leaves the amount untouched when the fee is zero', () => {
    expect(grossUpForFee('1000000', NO_FEE)).toBe('1000000')
  })

  it('truncates rather than rounding, so it can only send less', () => {
    // 3 * 10000 / 9980 = 3.006..., which truncates to 3 — never 4.
    expect(grossUpForFee('3', TWO_TENTHS_PERCENT)).toBe('3')
  })

  it('normalises the leading zeros toBaseUnits produces', () => {
    // '.5' at 2 decimals is '050' — a valid BN input, but not a canonical one.
    expect(grossUpForFee(toBaseUnits('.5', 2), NO_FEE)).toBe('50')
  })

  it('stays exact past 2^53, where float arithmetic would not', () => {
    // 1000 tokens at 18 decimals. The float result would end in ...0000000000000.
    expect(grossUpForFee('1000000000000000000000', TWO_TENTHS_PERCENT)).toBe(
      '1002004008016032064128',
    )
  })

  it('never uses exponential notation, whatever the magnitude', () => {
    expect(grossUpForFee('1'.padEnd(40, '0'), NO_FEE)).not.toContain('e')
  })

  it('rejects a fee of 100% or more instead of returning nonsense', () => {
    expect(() => grossUpForFee('1000', { feePercentage: 10_000, feePercentageDivider: 10_000 })).toThrow(
      /Invalid bridge fee/,
    )
    expect(() => grossUpForFee('1000', { feePercentage: 20_000, feePercentageDivider: 10_000 })).toThrow(
      /Invalid bridge fee/,
    )
  })
})

describe('approvalAmount', () => {
  it('approves the grossed-up amount plus 1% headroom', () => {
    // 1002004 * 101 / 100 = 1012024.04, truncated.
    expect(approvalAmount('1000000', TWO_TENTHS_PERCENT, { unlimited: false })).toBe('1012024')
  })

  it('approves MAX_SAFE_INTEGER wei plus the same headroom when unlimited', () => {
    expect(approvalAmount('1000000', TWO_TENTHS_PERCENT, { unlimited: true })).toBe(
      '9097271247288400910000000000000000',
    )
  })

  it('ignores the amount entirely when unlimited', () => {
    const fromOne = approvalAmount('1', TWO_TENTHS_PERCENT, { unlimited: true })
    const fromHuge = approvalAmount('1'.padEnd(30, '0'), TWO_TENTHS_PERCENT, { unlimited: true })
    expect(fromOne).toBe(fromHuge)
  })

  it('keeps the unlimited constant as MAX_SAFE_INTEGER scaled by 1e18', () => {
    // Pins the literal against the web3 call it replaced.
    expect(UNLIMITED_APPROVAL_UNITS).toBe(`${Number.MAX_SAFE_INTEGER}${'0'.repeat(18)}`)
  })

  it('approves at least the total cost of the transfer', () => {
    const amountUnits = toBaseUnits('123.456789', 6)
    const approved = BigInt(approvalAmount(amountUnits, TWO_TENTHS_PERCENT, { unlimited: false }))
    const required = BigInt(grossUpForFee(amountUnits, TWO_TENTHS_PERCENT))

    expect(approved).toBeGreaterThan(required)
  })
})
