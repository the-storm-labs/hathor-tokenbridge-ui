import BigNumber from 'bignumber.js'
import type { Token } from './model/token'

/**
 * Every `htr_sendTransaction` the bridge asks the wallet to sign carries a
 * `data` output (the EVM destination) alongside the token transfer, and
 * Hathor's fee-based-token network charges for that data output in HTR --
 * always HTR, never the token being transferred (`hathor-rpc-lib`'s
 * `sendTransaction.ts` asserts every fee entry has `tokenIndex === 0`).
 *
 * The wallet itself decides the exact amount at prepare time, but it is a
 * fixed per-output cost, not a percentage, so a stable estimate is enough to
 * keep "Max" from spending every last drop of HTR. Verified against a mainnet
 * failure: filling Max on a native-HTR send left nothing to cover this fee,
 * and the wallet's `prepareTx()` rejected with a generic "Transaction failed
 * validation" -- before ever showing the confirmation screen, which read as
 * the bridge being broken rather than as an ordinary insufficient-balance
 * case.
 */
export const HATHOR_DATA_OUTPUT_FEE = '0.01'

/**
 * The most that can be filled into the HTR->ARB amount field and still leave
 * room for {@link HATHOR_DATA_OUTPUT_FEE}.
 *
 * Only native HTR (`pureHtrAddress === '00'`) is ever reduced: the fee is
 * denominated in HTR regardless of which token is sent, so an hUSDC/hSLT7 Max
 * pays it out of a separate HTR UTXO and is unaffected here. Truncates rather
 * than rounds, like every other amount conversion in `amount-math.ts` -- the
 * field must never show more than what will actually fit.
 */
export function maxSendableHathorAmount(balance: string, token: Token): string {
  if (token.hathor.pureHtrAddress !== '00') return balance

  const max = new BigNumber(balance).minus(HATHOR_DATA_OUTPUT_FEE)
  if (!max.isGreaterThan(0)) return '0'

  return max.toFixed(token.hathor.decimals, BigNumber.ROUND_DOWN)
}
