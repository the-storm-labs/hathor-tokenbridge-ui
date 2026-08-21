import type { GasPriceInputs } from '../../domain/gas-price'

/** Reads and waits on the EVM chain itself, independent of any contract. */
export interface EvmChainPort {
  getBlockNumber(): Promise<number>

  /**
   * The inputs the gas-price rule needs. Which one is populated depends on the
   * chain, so the adapter only fetches what `gasPriceFor` will actually read —
   * see domain/gas-price.ts.
   */
  getGasPriceInputs(chainId: number): Promise<GasPriceInputs>

  /**
   * Wait for a transaction to be mined.
   * @throws if it does not confirm within the adapter's timeout.
   */
  waitForReceipt(transactionHash: string): Promise<EvmReceipt>
}

export interface EvmReceipt {
  readonly status: boolean
  readonly transactionHash: string
  readonly blockNumber: number
  readonly [key: string]: unknown
}
