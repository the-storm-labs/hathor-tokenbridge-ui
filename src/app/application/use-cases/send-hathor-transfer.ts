import BigNumber from 'bignumber.js'
import { toBaseUnits } from '../../domain/amount-math'
import { isEvmAddress } from '../../domain/evm-address'
import { findTokenByKey } from '../../domain/token-lookup'
import { isOnHathor, type Token } from '../../domain/model/token'
import { truncateMiddle } from '../../domain/tx-id'
import type { BridgeRoute } from '../../domain/model/network'
import type { Deployment } from '../../domain/model/deployment'
import { TransferStatus } from '../../ports/driven/bridge-api.port'
import type { Eip7702Port } from '../../ports/driven/eip7702.port'
import type { HathorWalletPort } from '../../ports/driven/hathor-wallet.port'
import type { StoredTransfer, TransferHistoryPort } from '../../ports/driven/transfer-history.port'

/**
 * Starts an HTR→ARB transfer: a Hathor transaction carrying the tokens to the
 * bridge's deposit address plus a data output with the EVM destination.
 *
 * Building that transaction is the wallet adapter's job. What belongs here is
 * everything that decides whether it should be sent at all, and the local record
 * that keeps the transfer visible until the bridge indexes it.
 */

export interface SendHathorTransferDeps {
  readonly wallet: HathorWalletPort
  readonly history: TransferHistoryPort
  readonly tokens: readonly Token[]
  readonly route: BridgeRoute
  readonly deployment: Deployment
  readonly eip7702: Eip7702Port
}

export interface SendHathorTransferParams {
  readonly tokenKey: string
  /** Amount as typed by the user, in whole tokens. */
  readonly amount: string
  /** EVM address the tokens should arrive at. */
  readonly evmDestination: string
}

export interface SendHathorTransferResult {
  /** Hathor transaction id, bare hex. */
  readonly hathorTxId: string
  /** The record written to local history, for the caller to render immediately. */
  readonly record: StoredTransfer
}

/**
 * The destination has an active EIP-7702 delegation, so the bridge cannot
 * process a claim to it. Its own type, distinct from a plain `Error`: this is
 * a guard rejecting a destination that was never going to work, not something
 * that went wrong on a send that otherwise would have — the form renders it
 * as a block, not a failure. See HathorTransferForm.
 */
export class Eip7702DelegatedError extends Error {
  constructor(readonly delegate: string) {
    // Truncated the same way the wallet header shortens an address — the full
    // 42 characters is one unbroken token with nowhere to wrap, and it blew
    // out the width of the toast that renders this.
    super(
      `This Arbitrum address has an active EIP-7702 delegation (to ${truncateMiddle(delegate)}). ` +
        'The bridge cannot process a claim to a delegated account — send to a plain wallet address ' +
        "instead, or remove the delegation from your wallet's own account settings first (this page " +
        "can't do that for you).",
    )
    this.name = 'Eip7702DelegatedError'
  }
}

export function createSendHathorTransfer(deps: SendHathorTransferDeps) {
  return async function sendHathorTransfer(
    params: SendHathorTransferParams,
  ): Promise<SendHathorTransferResult> {
    const token = findTokenByKey(deps.tokens, params.tokenKey)
    if (!token) throw new Error('Please select a token.')
    if (!isOnHathor(token)) throw new Error('Selected token is not available on Hathor.')

    if (!isPositiveAmount(params.amount)) throw new Error('Enter a valid amount.')

    const evmDestination = params.evmDestination.trim()
    if (!isEvmAddress(evmDestination)) {
      throw new Error('Enter a valid Arbitrum address (0x...).')
    }

    // The bridge cannot process a claim to a delegated account — the tokens
    // would arrive but sit unclaimable forever. Catching that here means it
    // fails before a Hathor transaction is even signed, instead of after
    // Hathor voting finishes, which is where this used to be discovered.
    const delegate = await deps.eip7702.getDelegate(evmDestination)
    if (delegate) throw new Eip7702DelegatedError(delegate)

    const bridgeAddress = deps.route.hathor.bridgeHathorAddress
    // A placeholder here would send the user's tokens to an address nobody
    // controls, so an unconfigured deployment must refuse rather than try.
    if (!bridgeAddress || bridgeAddress.startsWith('HATHOR_')) {
      throw new Error('Bridge Hathor deposit address is not configured.')
    }

    const decimals = token.hathor.decimals
    // String math, truncating — never float. `Math.round(parseFloat(x) * 100)`
    // rounds *up* past two decimals, so 2.999 used to send 3.00 HTR: more than
    // the user asked for. BigInt drops the leading zeros toBaseUnits keeps
    // ('0.5' → '050'), so the wallet receives '50'.
    const amountUnits = BigInt(toBaseUnits(params.amount, decimals)).toString()

    const { hash } = await deps.wallet.sendBridgeTransfer(
      {
        bridgeAddress,
        tokenUid: token.hathor.pureHtrAddress,
        amountUnits,
        evmDestination,
      },
      deps.deployment,
    )

    if (!hash) throw new Error('Transaction sent but wallet returned no response')

    const record: StoredTransfer = {
      hathorTxId: hash,
      backendTxHash: null,
      displayedTxHash: hash,
      transactionHash: hash,
      // The EVM symbol when the token exists there, since the destination is the
      // EVM side; otherwise whatever Hathor calls it.
      token: token.evm?.symbol || token.hathor.symbol || token.key,
      // Raw units plus their scale, like every record the API produces. Storing a
      // formatted string is what used to freeze a row at the precision of the
      // build that wrote it — a claimed transfer is never rewritten.
      amount: amountUnits,
      amountDecimals: decimals,
      tokenDecimals: decimals,
      sender: deps.wallet.getAddress(),
      // The Hathor federation signs first; the Read API takes this record's
      // status over once it indexes the transaction.
      status: TransferStatus.HathorVoting,
      votes: 0,
      signatures: 0,
      blockNumber: null,
    }

    // Keyed by the EVM destination, which is what the history poll queries the
    // Read API with — the Hathor sender is not a key either side agrees on.
    deps.history.upsertHathorTransfer(evmDestination, deps.route.hathor.name, record)

    return { hathorTxId: hash, record }
  }
}

/** Rejects '', '0', negatives and anything unparseable — the form's own check. */
function isPositiveAmount(amount: string): boolean {
  if (!amount) return false

  const parsed = new BigNumber(amount)
  return parsed.isFinite() && parsed.isGreaterThan(0)
}
