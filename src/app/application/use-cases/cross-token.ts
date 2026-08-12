import BigNumber from 'bignumber.js'
import { toBaseUnits } from '../../domain/amount-math'
import { grossUpForFee, type FeeBasis } from '../../domain/approval-amount'
import { findTokenByKey } from '../../domain/token-lookup'
import { isOnEvm, type Token } from '../../domain/model/token'
import type { BridgeRoute } from '../../domain/model/network'
import type { AllowTokensPort, BridgeContractPort, Erc20Port } from '../../ports/driven/contracts.port'
import type { EvmChainPort, EvmReceipt } from '../../ports/driven/evm-chain.port'
import type { TransferHistoryPort } from '../../ports/driven/transfer-history.port'
import { confirmTransaction } from './confirm-transaction'

/**
 * Sends tokens from the EVM side to Hathor — step two of the ARB→HTR flow.
 *
 * The three checks before submitting (balance, daily limit, destination address)
 * are the point of this use case. They were interleaved with DOM writes, so the
 * only way to know a transfer was rejected for a *reason* rather than by the
 * contract was to read the alert text.
 */

export interface CrossTokenDeps {
  readonly erc20: Erc20Port
  readonly bridge: BridgeContractPort
  readonly allowTokens: AllowTokensPort
  readonly chain: EvmChainPort
  readonly history: TransferHistoryPort
  readonly tokens: readonly Token[]
  readonly route: BridgeRoute
  readonly resolveGasPrice: () => Promise<string>
  readonly getFee: () => FeeBasis
  readonly getAccount: () => string
  /** Injected: address validation needs base58 and sha256 from CDN globals. */
  readonly isValidHathorAddress: (address: string) => boolean
  /** Converts an 18-decimal contract value to whole tokens, for the limit message. */
  readonly fromWei: (value: string) => string
}

export interface CrossTokenParams {
  readonly tokenKey: string
  /** Amount as typed by the user, in whole tokens. */
  readonly amount: string
  /** Hathor destination address. */
  readonly hathorAddress: string
}

export interface CrossTokenResult {
  readonly receipt: EvmReceipt
  /**
   * What the user will receive, for the success message: the amount they typed,
   * in the symbol it arrives as on Hathor.
   */
  readonly receives: string
}

export function createCrossToken(deps: CrossTokenDeps) {
  return async function crossToken(params: CrossTokenParams): Promise<CrossTokenResult> {
    const account = deps.getAccount()
    if (!account) throw new Error('Connect your wallet!')

    const token = findTokenByKey(deps.tokens, params.tokenKey)
    if (!token || !isOnEvm(token)) throw new Error('Choose a token to cross')
    if (!params.amount) throw new Error('Complete the Amount field')
    if (!params.hathorAddress) throw new Error('Inform the hathor address!')
    if (!deps.isValidHathorAddress(params.hathorAddress)) {
      throw new Error('Invalid Hathor address!')
    }

    // What the contract must move: the amount the user wants to arrive, plus the
    // bridge's fee. The same value the allowance was checked against.
    const amountUnits = grossUpForFee(
      toBaseUnits(params.amount, token.evm.decimals),
      deps.getFee(),
    )

    await assertSufficientBalance(deps, token, account, amountUnits)
    await assertWithinDailyLimit(deps, token, amountUnits)

    const gasPrice = await deps.resolveGasPrice()

    const transactionHash = await deps.bridge.receiveTokensTo(
      {
        destinationChainId: deps.route.hathor.networkId,
        tokenAddress: token.evm.address,
        to: params.hathorAddress,
        amount: amountUnits,
      },
      account,
      gasPrice,
    )

    const receipt = await confirmTransaction(
      deps.chain,
      deps.route.evm.explorer,
      transactionHash,
    )

    // Recorded under the EVM network name, which is the key the EVM→HTR history
    // tab reads. Fields and shape are the ones already in users' storage: the
    // receipt is spread in whole, because the row reads blockNumber and
    // transactionHash straight off it, and `amount` stays the string the user
    // typed — for these rows there is no scale to record.
    //
    // The receipt's `status` is dropped. It is a boolean ("mined successfully"),
    // it collided with the API's string status on the same field name, and
    // nothing ever read it: the row derives Confirmed/Pending from the block
    // count instead.
    const { status: _mined, ...minedReceipt } = receipt
    deps.history.addEvmTransfer(account, deps.route.evm.name, {
      networkId: deps.route.evm.chainId,
      tokenFrom: token.evm.symbol,
      tokenTo: token.hathor.symbol,
      amount: params.amount,
      ...minedReceipt,
    })

    return { receipt, receives: `${params.amount} ${token.hathor.symbol}` }
  }
}

async function assertSufficientBalance(
  deps: CrossTokenDeps,
  token: Token & { evm: NonNullable<Token['evm']> },
  account: string,
  amountUnits: string,
): Promise<void> {
  const balance = await deps.erc20.balanceOf(token.evm.address, account)
  if (new BigNumber(balance).isGreaterThanOrEqualTo(amountUnits)) return

  // The message reports the balance in whole tokens, as before — the number the
  // user sees in the balance field, not the base units the comparison used.
  const shown = new BigNumber(balance).shiftedBy(-token.evm.decimals)
  throw new Error(
    `Insuficient Balance in your account, your current balance is ${shown} ${token.evm.symbol}`,
  )
}

/**
 * The bridge caps how much of a token may cross per day, and reports what is
 * left. Checking it here turns a revert into a sentence.
 *
 * ## The comparison is in whole tokens, and that is a fix
 *
 * The original compared the amount in the token's **base units** against
 * `calcMaxWithdraw`, which — like every other AllowTokens value in this app — is
 * **18-decimal scaled** whatever the token's own decimals are. Everywhere else
 * (getMaxBalance, the min/max/daily of the info panel) the value goes through
 * `fromWei` first.
 *
 * So for USDC, with 6 decimals, the limit looked 10^12 times larger than it is
 * and this check never fired: the user got a revert from the contract instead of
 * this sentence. Comparing both sides in whole tokens makes it fire when it
 * should. It can only ever reject a transfer the contract would have rejected
 * anyway, for the same reason.
 */
async function assertWithinDailyLimit(
  deps: CrossTokenDeps,
  token: Token & { evm: NonNullable<Token['evm']> },
  amountUnits: string,
): Promise<void> {
  const maxWithdraw = await deps.allowTokens.calcMaxWithdraw(token.evm.address)

  const amount = new BigNumber(amountUnits).shiftedBy(-token.evm.decimals)
  const limit = new BigNumber(deps.fromWei(maxWithdraw))
  if (amount.isLessThanOrEqualTo(limit)) return

  throw new Error(
    `Amount bigger than the daily limit. Daily limit left ${deps.fromWei(maxWithdraw)} tokens`,
  )
}
