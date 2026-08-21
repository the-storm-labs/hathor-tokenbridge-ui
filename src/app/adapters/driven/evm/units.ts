import { formatUnits, keccak256 as viemKeccak256, toBytes } from 'viem'

/**
 * The two `Web3.utils` helpers the app actually used, on viem instead.
 *
 * They lived as one-line lambdas duplicated across the two composition files,
 * each reaching for a CDN global. Here they are one implementation with the
 * behaviour written down, because in both cases the exact behaviour is
 * load-bearing and neither is obvious from the name.
 */

/** Wire scale of everything AllowTokens reports and of every post-Hathor amount. */
const WEI_DECIMALS = 18

/**
 * An 18-decimal contract value as a decimal string.
 *
 * Matches `web3.utils.fromWei(value, 'ether')` including the trailing-zero
 * trimming — `1000000000000000000` is `'1'`, not `'1.000000000000000000'`.
 * Callers `parseInt` or `new BigNumber` the result, so a changed shape would
 * pass silently and only show up in a rendered number.
 */
export function fromWei(value: string): string {
  // A contract read that came back empty would make BigInt throw, which is a
  // worse failure than reporting zero for a value nothing can be done with.
  if (!value) return '0'

  return formatUnits(BigInt(value), WEI_DECIMALS)
}

/**
 * keccak256 of a value **as text**, which is what the bridge hashes.
 *
 * This one is easy to get wrong and expensive when you do. `web3.utils.keccak256`
 * hashes a `0x`-prefixed argument as *bytes* and anything else as *UTF-8*, and
 * the app only ever passes bare 64-char Hathor tx ids — so the UTF-8 form is the
 * one in use, and it is the one the federation used for the records that omit
 * `originTransactionHash` (verified against 86 live mainnet records). Passing a
 * `0x`-prefixed id here would silently produce the other hash and match nothing.
 */
export function keccak256Text(value: string): string {
  return viemKeccak256(toBytes(value))
}
