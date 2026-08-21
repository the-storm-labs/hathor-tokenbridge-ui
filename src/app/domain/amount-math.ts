/**
 * Conversion between a human-typed decimal string and a token's base units.
 *
 * This replaces a digit-padding loop that was duplicated verbatim in
 * approveSpend and crossToken (and leaked an implicit global `i` in both). The
 * behaviour is reproduced exactly, including the edge cases below, because this
 * is the money path — a rounding change here silently sends the wrong amount.
 */

/**
 * Scale a decimal string to integer base units.
 *
 * Truncates rather than rounds: `'1.999'` at 2 decimals is `'199'`, matching the
 * original loop. Callers must not pre-round.
 *
 * Faithful edge cases, all reachable from the amount input:
 *  - `''`     → `'0'.repeat(decimals)`  (empty integer part; the caller is
 *               expected to have rejected an empty amount before this point)
 *  - `'.5'`   → integer part is empty, fraction is used: `'50'` at 2 decimals
 *  - `'1.'`   → the fraction `''` is falsy, so it pads: `'100'` at 2 decimals
 *
 * @param amount   Decimal string as typed by the user, e.g. `'1.23'`
 * @param decimals Number of decimal places the token uses on its own chain
 * @returns Integer string in base units. Not `BigInt`, because callers hand it
 *          straight to `new BN(...)` / contract calls as a string.
 */
export function toBaseUnits(amount: string, decimals: number): string {
  const [whole, fraction] = amount.split('.')
  let result = whole ?? ''

  for (let i = 0; i < decimals; i++) {
    // An empty fraction ('1.') is falsy in the original and pads with zeros.
    result += fraction && i < fraction.length ? fraction[i] : '0'
  }

  return result
}

/**
 * Truncate a decimal string to at most `decimals` places.
 *
 * For amount *inputs*: it caps precision as the user types without otherwise
 * reformatting, so a half-typed `'2.'` or `'2.5'` is left alone. Padding here
 * would fight the caret.
 *
 * Truncates rather than rounds, matching {@link toBaseUnits} — the field must
 * never show a number larger than what will actually be sent.
 */
export function clampDecimals(value: string, decimals: number): string {
  const dot = value.indexOf('.')
  if (dot === -1) return value

  if (decimals === 0) return value.slice(0, dot)

  const maxLength = dot + 1 + decimals
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

/**
 * Inverse of {@link toBaseUnits}: base units back to a decimal string.
 *
 * Used for display only. Keeps trailing zeros so the output has exactly
 * `decimals` places, which is what the balance fields render today.
 */
export function fromBaseUnits(baseUnits: string, decimals: number): string {
  if (decimals === 0) return baseUnits

  const negative = baseUnits.startsWith('-')
  const digits = (negative ? baseUnits.slice(1) : baseUnits).padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = digits.slice(digits.length - decimals)

  return `${negative ? '-' : ''}${whole}.${fraction}`
}
