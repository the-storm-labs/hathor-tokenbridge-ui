/**
 * Gas price selection.
 *
 * This rule was written out three times, byte for byte, in approveSpend,
 * crossToken and claimToken. Splitting it into "fetch the inputs" (an adapter
 * concern) and "decide the price" (this pure function) is what makes it one
 * implementation instead of three.
 */

/** Chain ids that report a floor price via `block.minimumGasPrice` (RSK). */
const MIN_GAS_PRICE_CHAIN_RANGE = { first: 30, last: 33 } as const

const RSK_MULTIPLIER = 1.03
const DEFAULT_MULTIPLIER = 1.3

export interface GasPriceInputs {
  /** `eth_gasPrice`. Used off the RSK range. */
  readonly averageGasPrice: string
  /** `block.minimumGasPrice` of the latest block. Only read on the RSK range. */
  readonly latestBlockMinimumGasPrice?: string
}

/**
 * @returns Hex-encoded gas price (`0x...`), ready for a transaction's
 *          `gasPrice` field.
 */
export function gasPriceFor(chainId: number, inputs: GasPriceInputs): string {
  const usesMinimum =
    chainId >= MIN_GAS_PRICE_CHAIN_RANGE.first && chainId <= MIN_GAS_PRICE_CHAIN_RANGE.last

  const raw = usesMinimum ? inputs.latestBlockMinimumGasPrice : inputs.averageGasPrice
  const multiplier = usesMinimum ? RSK_MULTIPLIER : DEFAULT_MULTIPLIER

  const parsed = parseInt(raw ?? '', 10)

  // `parseInt` of a non-numeric string is NaN, and `NaN <= 1` is false, so the
  // original would go on to produce '0xNaN'. Treating it as the floor is the one
  // deliberate behaviour change here: a malformed node response should not
  // become an invalid transaction field.
  const price = !Number.isFinite(parsed) || parsed <= 1 ? 1 : parsed * multiplier

  return `0x${Math.ceil(price).toString(16)}`
}

/** Whether this chain needs `block.minimumGasPrice` fetched at all. */
export function needsLatestBlockMinimum(chainId: number): boolean {
  return chainId >= MIN_GAS_PRICE_CHAIN_RANGE.first && chainId <= MIN_GAS_PRICE_CHAIN_RANGE.last
}
