import type { BridgeRoute } from '../../domain/model/network'
import type { BridgeContractPort, ClaimRequest } from '../../ports/driven/contracts.port'
import type { EvmChainPort, EvmReceipt } from '../../ports/driven/evm-chain.port'
import { confirmTransaction } from './confirm-transaction'

/**
 * Claims a Hathor→EVM transfer, releasing the tokens on the EVM side.
 *
 * The claim request arrives as the typed object the history use case built. It is
 * deliberately not reconstructed here: the parameters used to be written into
 * `data-*` attributes and parsed back out of the DOM, which put an amount and a
 * block hash through a string round trip on the way to a contract call.
 *
 * The blockHash-in-both-slots rule lives in the adapter, behind
 * {@link BridgeContractPort}, so no call site can get it wrong.
 */

export interface ClaimTransferDeps {
  readonly bridge: BridgeContractPort
  readonly chain: EvmChainPort
  readonly route: BridgeRoute
  readonly resolveGasPrice: () => Promise<string>
  readonly getAccount: () => string
}

export function createClaimTransfer(deps: ClaimTransferDeps) {
  /**
   * @throws {TransactionFailedError} if the claim reverts — which the previous
   *         code could not report, because it awaited the send promise and never
   *         looked at the receipt's status.
   */
  return async function claimTransfer(claim: ClaimRequest): Promise<EvmReceipt> {
    const account = deps.getAccount()
    if (!account) throw new Error('Connect your wallet!')

    const gasPrice = await deps.resolveGasPrice()
    const transactionHash = await deps.bridge.claim(claim, account, gasPrice)

    return confirmTransaction(deps.chain, deps.route.evm.explorer, transactionHash)
  }
}
