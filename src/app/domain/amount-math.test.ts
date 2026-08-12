import { describe, it, expect } from 'vitest'
import { toBaseUnits, fromBaseUnits, clampDecimals } from './amount-math'

describe('clampDecimals', () => {
  it('caps the fraction at the token precision', () => {
    expect(clampDecimals('2.999', 2)).toBe('2.99')
    expect(clampDecimals('0.123456789', 2)).toBe('0.12')
  })

  it('truncates rather than rounds, so the field never overstates the amount', () => {
    expect(clampDecimals('2.999', 2)).not.toBe('3.00')
    expect(clampDecimals('1.9999', 3)).toBe('1.999')
  })

  it('leaves values already within precision untouched', () => {
    expect(clampDecimals('2.5', 2)).toBe('2.5')
    expect(clampDecimals('2.50', 2)).toBe('2.50')
    expect(clampDecimals('2', 2)).toBe('2')
  })

  it('does not disturb half-typed input', () => {
    // Rewriting these while the user types would fight the caret.
    expect(clampDecimals('2.', 2)).toBe('2.')
    expect(clampDecimals('', 2)).toBe('')
    expect(clampDecimals('.', 2)).toBe('.')
  })

  it('drops the fraction entirely at zero decimals', () => {
    expect(clampDecimals('2.999', 0)).toBe('2')
    expect(clampDecimals('2.', 0)).toBe('2')
  })

  it('supports a precision other than 2 without code changes', () => {
    // The point of driving this from token config: a 3-decimal token just works.
    expect(clampDecimals('1.23456', 3)).toBe('1.234')
    expect(clampDecimals('1.23456', 8)).toBe('1.23456')
  })

  it('agrees with toBaseUnits — what is shown is what is sent', () => {
    for (const [value, decimals] of [
      ['2.999', 2],
      ['0.123456', 3],
      ['5.5', 2],
    ] as const) {
      const clamped = clampDecimals(value, decimals)
      expect(toBaseUnits(clamped, decimals)).toBe(toBaseUnits(value, decimals))
    }
  })
})

// Every expectation here was verified against the original padding loop from
// index.js (approveSpend / crossToken) before that loop was deleted.
describe('toBaseUnits', () => {
  it('scales a decimal string to base units', () => {
    expect(toBaseUnits('1.23', 6)).toBe('1230000')
    expect(toBaseUnits('1', 18)).toBe('1000000000000000000')
  })

  it('truncates rather than rounds', () => {
    // The money path: 1.999 at 2 decimals must not become 200.
    expect(toBaseUnits('1.999', 2)).toBe('199')
    expect(toBaseUnits('0.0000001', 6)).toBe('0000000')
  })

  it('handles a missing integer part', () => {
    expect(toBaseUnits('.5', 2)).toBe('50')
  })

  it('treats a trailing dot as no fraction', () => {
    // '1.'.split('.')[1] is '', which is falsy — so it pads with zeros.
    expect(toBaseUnits('1.', 2)).toBe('100')
  })

  it('pads an empty amount', () => {
    // Callers reject an empty amount earlier; this pins the behaviour anyway so
    // it cannot change silently.
    expect(toBaseUnits('', 6)).toBe('000000')
  })

  it('is the identity at zero decimals', () => {
    expect(toBaseUnits('5', 0)).toBe('5')
    expect(toBaseUnits('5.99', 0)).toBe('5')
  })
})

describe('fromBaseUnits', () => {
  it('inverts toBaseUnits', () => {
    expect(fromBaseUnits('1230000', 6)).toBe('1.230000')
    expect(fromBaseUnits('1000000000000000000', 18)).toBe('1.000000000000000000')
  })

  it('pads values shorter than the decimal count', () => {
    expect(fromBaseUnits('50', 2)).toBe('0.50')
    expect(fromBaseUnits('7', 6)).toBe('0.000007')
    expect(fromBaseUnits('0', 2)).toBe('0.00')
  })

  it('returns the input unchanged at zero decimals', () => {
    expect(fromBaseUnits('5', 0)).toBe('5')
  })

  it('keeps the sign', () => {
    expect(fromBaseUnits('-50', 2)).toBe('-0.50')
  })

  it('round-trips exactly, without going through a float', () => {
    // Note the oracle is string padding, not Number().toFixed(). At 18 decimals
    // `Number('123.456789').toFixed(18)` is '123.456789000000000556' — the float
    // error this whole module exists to avoid.
    const cases = [
      ['1.23', 6, '1.230000'],
      ['0.50', 2, '0.50'],
      ['123.456789', 18, '123.456789000000000000'],
    ] as const

    for (const [amount, decimals, expected] of cases) {
      expect(fromBaseUnits(toBaseUnits(amount, decimals), decimals)).toBe(expected)
    }
  })
})
