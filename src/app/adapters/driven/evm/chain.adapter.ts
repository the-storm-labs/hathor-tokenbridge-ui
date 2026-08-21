import type { Hex } from 'viem'
import { needsLatestBlockMinimum } from '../../../domain/gas-price'
import type { GasPriceInputs } from '../../../domain/gas-price'
import type { EvmChainPort, EvmReceipt } from '../../../ports/driven/evm-chain.port'
import { requireClients, type EvmClients } from './clients'

/**
 * Chain reads, on viem.
 *
 * The clients are fetched per call rather than held: they are rebuilt whenever
 * the user switches wallet or network, and a cached reference would keep
 * talking to the old provider.
 */
export class ViemChainAdapter implements EvmChainPort {
  constructor(
    private readonly getClients: () => EvmClients | null,
    private readonly receiptTimeoutMs = 90_000,
    private readonly receiptPollMs = 10_000,
  ) {}

  async getBlockNumber(): Promise<number> {
    return Number(await this.clients().reader.getBlockNumber())
  }

  /**
   * Fetches only the input the rule will read — one request, not two. Which one
   * that is comes from the domain, so the branch cannot drift from the decision.
   */
  async getGasPriceInputs(chainId: number): Promise<GasPriceInputs> {
    if (needsLatestBlockMinimum(chainId)) {
      // `minimumGasPrice` is RSK's, not part of any standard block, so viem's
      // typed getBlock drops it. This has to go out as a raw request.
      //
      // Unreachable on both deployments — the rule fires for chain ids 30–33
      // and this app bridges 42161 and 11155111 — so it is kept for the port's
      // contract rather than because anything exercises it.
      const block = (await this.clients().reader.request({
        method: 'eth_getBlockByNumber',
        params: ['latest', false],
      } as never)) as { minimumGasPrice?: string } | null

      return { averageGasPrice: '', latestBlockMinimumGasPrice: block?.minimumGasPrice }
    }

    return { averageGasPrice: String(await this.clients().reader.getGasPrice()) }
  }

  /**
   * Waits for a transaction to be mined.
   *
   * viem owns the polling and its own teardown, which is what the hand-written
   * loop this replaces got wrong: it rejected on timeout without ever clearing
   * its interval, so a slow transaction left a poller running for the rest of
   * the session.
   */
  async waitForReceipt(transactionHash: string): Promise<EvmReceipt> {
    const receipt = await this.clients().reader.waitForTransactionReceipt({
      hash: transactionHash as Hex,
      timeout: this.receiptTimeoutMs,
      pollingInterval: this.receiptPollMs,
    })

    return {
      ...receipt,
      // viem reports 'success' | 'reverted'; the port promises a boolean, and
      // the callers check it to turn a revert into an error.
      status: receipt.status === 'success',
      transactionHash: receipt.transactionHash,
      blockNumber: Number(receipt.blockNumber),
    }
  }

  private clients(): EvmClients {
    return requireClients(this.getClients())
  }
}
