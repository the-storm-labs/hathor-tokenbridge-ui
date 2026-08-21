import type { EvmChainPort, EvmReceipt } from '../../ports/driven/evm-chain.port'

/**
 * Waiting for an EVM write to be mined, and deciding whether it worked.
 *
 * The three write paths (approve, cross, claim) each submitted a transaction and
 * then interpreted the result their own way. Approve and cross polled for the
 * receipt and checked `receipt.status`; claim awaited the send promise and
 * checked nothing, so a reverted claim looked successful and the row simply
 * never changed. One helper, one interpretation.
 */

/**
 * A transaction that was mined and reverted.
 *
 * Distinct from a submission failure (user rejected, gas estimation failed):
 * this one cost gas and has a hash worth linking to.
 *
 * The message carries the explorer link as markup because the alert that renders
 * it uses `.html()`, and this reproduces the string the previous code produced
 * character for character. Callers that want to build their own link have
 * `transactionHash`.
 */
export class TransactionFailedError extends Error {
  constructor(
    readonly transactionHash: string,
    explorerUrl: string,
  ) {
    super(
      `Execution failed <a target="_blank" href="${explorerUrl}/tx/${transactionHash}">see Tx</a>`,
    )
    this.name = 'TransactionFailedError'
  }
}

/**
 * @throws {TransactionFailedError} if the transaction reverted.
 * @throws whatever the chain port throws if it never confirms.
 */
export async function confirmTransaction(
  chain: EvmChainPort,
  explorerUrl: string,
  transactionHash: string,
): Promise<EvmReceipt> {
  const receipt = await chain.waitForReceipt(transactionHash)
  if (!receipt.status) throw new TransactionFailedError(transactionHash, explorerUrl)

  return receipt
}
