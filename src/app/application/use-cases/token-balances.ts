import BigNumber from 'bignumber.js'
import { fromBaseUnits } from '../../domain/amount-math'
import { maxTransferable } from '../../domain/fee-math'
import { isOnEvm, isOnHathor, type Token } from '../../domain/model/token'
import type { Deployment } from '../../domain/model/deployment'
import type { AllowTokensPort, Erc20Port } from '../../ports/driven/contracts.port'
import type { HathorWalletPort } from '../../ports/driven/hathor-wallet.port'

/**
 * Balance reads for both sides of the bridge.
 *
 * The Hathor balance was fetched in two places with identical code — the Max
 * button and the balance label — differing only in where the result was written.
 */

export interface HathorBalanceDeps {
  readonly wallet: HathorWalletPort
  readonly deployment: Deployment
}

export function createRefreshHathorBalance(deps: HathorBalanceDeps) {
  /** @returns the available balance, formatted at the token's Hathor precision. */
  return async function refreshHathorBalance(token: Token): Promise<string> {
    if (!isOnHathor(token)) return fromBaseUnits('0', token.hathor.decimals)

    const balance = await deps.wallet.getBalance(token.hathor.pureHtrAddress, deps.deployment)
    // String math: the old `available / 10**decimals` went through a float.
    return fromBaseUnits(String(balance.available), token.hathor.decimals)
  }
}

export interface MaxTransferableDeps {
  readonly erc20: Erc20Port
  readonly allowTokens: AllowTokensPort
  /** Converts an 18-decimal contract value to a whole-token decimal string. */
  readonly fromWei: (value: string) => string
}

export function createGetMaxTransferable(deps: MaxTransferableDeps) {
  /**
   * The largest amount transferable: the lower of the wallet balance and the
   * bridge's withdraw cap, minus the fee.
   *
   * @returns a decimal string at the token's **EVM** precision. The caller caps
   *          it further at the Hathor precision, since that is what can actually
   *          arrive.
   */
  return async function getMaxTransferable(
    token: Token,
    owner: string,
    feeRate: number,
  ): Promise<string> {
    if (!isOnEvm(token)) return '0'

    const [rawBalance, rawMaxWithdraw] = await Promise.all([
      deps.erc20.balanceOf(token.evm.address, owner),
      deps.allowTokens.calcMaxWithdraw(token.evm.address),
    ])

    const balance = new BigNumber(rawBalance).shiftedBy(-token.evm.decimals)
    const maxWithdraw = new BigNumber(deps.fromWei(rawMaxWithdraw))

    return maxTransferable(balance, maxWithdraw, feeRate, token.evm.decimals)
  }
}

export interface AllowanceDeps {
  readonly erc20: Erc20Port
  readonly fromWei: (value: string) => string
}

export function createCheckAllowance(deps: AllowanceDeps) {
  /**
   * Whether the bridge is already approved to move `totalCost` of this token.
   *
   * The comparison is against the **total cost**, not the amount the user typed:
   * the fee is charged on top, so approving only the amount leaves the transfer
   * to fail at the contract.
   */
  return async function checkAllowance(
    token: Token,
    owner: string,
    spender: string,
    totalCost: BigNumber,
  ): Promise<{ approved: boolean; allowance: BigNumber }> {
    if (!isOnEvm(token)) return { approved: false, allowance: new BigNumber(0) }

    const raw = await deps.erc20.allowance(token.evm.address, owner, spender)
    const allowance = new BigNumber(deps.fromWei(raw))

    return { approved: totalCost.lte(allowance), allowance }
  }
}
