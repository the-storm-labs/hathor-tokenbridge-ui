import { needsLatestBlockMinimum } from '../../../domain/gas-price'
import type { GasPriceInputs } from '../../../domain/gas-price'
import type { EvmChainPort, EvmReceipt } from '../../../ports/driven/evm-chain.port'
import type { SchedulerPort } from '../../../ports/driven/scheduler.port'

/**
 * Chain reads via web3.js 1.x.
 *
 * The web3 instance is passed per call rather than held: it is replaced whenever
 * the user switches wallet or network, and a cached reference would keep talking
 * to the old provider.
 */
export class Web3ChainAdapter implements EvmChainPort {
  constructor(
    private readonly getWeb3: () => Web3Instance | null,
    private readonly scheduler: SchedulerPort,
    private readonly receiptTimeoutMs = 90_000,
    private readonly receiptPollMs = 10_000,
  ) {}

  async getBlockNumber(): Promise<number> {
    return this.web3().eth.getBlockNumber()
  }

  /**
   * Fetches only the input the rule will read — one request, not two. Which one
   * that is comes from the domain, so the branch cannot drift from the decision.
   */
  async getGasPriceInputs(chainId: number): Promise<GasPriceInputs> {
    if (needsLatestBlockMinimum(chainId)) {
      const block = await this.web3().eth.getBlock('latest')
      return { averageGasPrice: '', latestBlockMinimumGasPrice: block.minimumGasPrice }
    }

    return { averageGasPrice: await this.web3().eth.getGasPrice() }
  }

  /**
   * Polls until the transaction is mined.
   *
   * The original leaked its interval on the timeout path — it rejected without
   * ever calling clearInterval, so a slow transaction left a poller running for
   * the rest of the session. Here the disposer runs on both paths.
   */
  waitForReceipt(transactionHash: string): Promise<EvmReceipt> {
    return new Promise((resolve, reject) => {
      let elapsed = 0

      const stop = this.scheduler.every(this.receiptPollMs, () => {
        elapsed += this.receiptPollMs

        this.web3()
          .eth.getTransactionReceipt(transactionHash)
          .then((receipt) => {
            if (receipt) {
              stop()
              resolve(receipt as EvmReceipt)
            } else if (elapsed >= this.receiptTimeoutMs) {
              stop()
              reject(new Error(`Transaction ${transactionHash} was not mined in time`))
            }
          })
          .catch((error: unknown) => {
            stop()
            reject(error instanceof Error ? error : new Error(String(error)))
          })
      })
    })
  }

  private web3(): Web3Instance {
    const web3 = this.getWeb3()
    if (!web3) throw new Error('No EVM provider connected')
    return web3
  }
}
