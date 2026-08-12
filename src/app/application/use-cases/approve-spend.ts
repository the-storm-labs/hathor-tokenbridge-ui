import { toBaseUnits } from '../../domain/amount-math'
import { approvalAmount, type FeeBasis } from '../../domain/approval-amount'
import { findTokenByKey } from '../../domain/token-lookup'
import { isOnEvm, type Token } from '../../domain/model/token'
import type { BridgeRoute } from '../../domain/model/network'
import type { Erc20Port } from '../../ports/driven/contracts.port'
import type { EvmChainPort, EvmReceipt } from '../../ports/driven/evm-chain.port'
import { confirmTransaction } from './confirm-transaction'

/**
 * Approves the bridge to move a token on the user's behalf.
 *
 * Step one of the two-step ARB→HTR flow. Everything about *what* to approve is
 * decided here or in the domain; the form's job is to hand over a token key, an
 * amount string and whether the "don't ask again" box is checked.
 */

export interface ApproveSpendDeps {
  readonly erc20: Erc20Port
  readonly chain: EvmChainPort
  readonly tokens: readonly Token[]
  readonly route: BridgeRoute
  readonly resolveGasPrice: () => Promise<string>
  /** Read per call: the fee is loaded from the contract after connecting. */
  readonly getFee: () => FeeBasis
  /** The connected account, or `''`. */
  readonly getAccount: () => string
}

export interface ApproveSpendParams {
  /** `<option value>` of the token dropdown. */
  readonly tokenKey: string
  /** Amount as typed by the user, in whole tokens. */
  readonly amount: string
  /** The "don't ask again" checkbox: approve an effectively unbounded amount. */
  readonly unlimited: boolean
}

export function createApproveSpend(deps: ApproveSpendDeps) {
  return async function approveSpend(params: ApproveSpendParams): Promise<EvmReceipt> {
    const account = deps.getAccount()
    if (!account) throw new Error('Connect your wallet!')

    const token = findTokenByKey(deps.tokens, params.tokenKey)
    if (!token || !isOnEvm(token)) throw new Error('Choose a token to cross')
    if (!params.amount) throw new Error('Complete the Amount field')

    const amount = approvalAmount(toBaseUnits(params.amount, token.evm.decimals), deps.getFee(), {
      unlimited: params.unlimited,
    })

    const gasPrice = await deps.resolveGasPrice()

    const transactionHash = await deps.erc20.approve(
      token.evm.address,
      // The spender is the bridge itself. Taken from the route rather than from
      // a live contract object, so it cannot be read off a contract built for a
      // different network than the one the transfer is going to.
      deps.route.evm.bridge,
      amount,
      account,
      gasPrice,
    )

    return confirmTransaction(deps.chain, deps.route.evm.explorer, transactionHash)
  }
}
