import { apiAmountDecimals } from '../../domain/api-amount'
import type { BridgeTransfer } from '../../domain/model/transfer'
import type { Token } from '../../domain/model/token'
import {
  matchLocalHathorTransfer,
  resolveOriginSender,
  toHathorTxId,
} from '../../domain/tx-id'
import type { ApiTransfer } from '../../ports/driven/bridge-api.port'
import { TransferStatus } from '../../ports/driven/bridge-api.port'
import type { StoredTransfer } from '../../ports/driven/transfer-history.port'

/**
 * Turns one Read API record into a BridgeTransfer.
 *
 * ## Why this file exists
 *
 * Three fields of an API record mean different things depending on how far the
 * transfer has progressed. Each one was handled — or mishandled — in a different
 * corner of the old fillHathorToEvmTxs, and each produced a bug that reached
 * production:
 *
 *  1. **`amount` changes scale.** While `hathor_voting` it is in the token's
 *     Hathor units; afterwards it is 18-decimal. Unscaling by 18 throughout
 *     rendered a live 5 USDC transfer as `0.00`.
 *  2. **The Hathor origin is identified two ways.** `originTransactionHash`
 *     when the Hathor federation reported it, otherwise `blockHash`, which holds
 *     `keccak256(hathorTxId)`. The old code compared against `transactionHash`
 *     instead — measured over 28 live records, that matched **zero** of them, so
 *     every unreported transfer became a duplicate row.
 *  3. **`sender` may be the federation relayer's EVM address**, not the user.
 *     Because that value is truthy, `remote.sender || local.sender` never fell
 *     through and the real Hathor sender captured at send time was discarded on
 *     the first poll.
 *
 * Keeping the three together, with the local record beside the remote one, is
 * the point: they are all the same question — what does this record actually
 * say, given where the transfer is.
 */

/**
 * What the bridge contract says about a transfer the API reports as
 * `awaiting_claim`.
 *
 * Three outcomes, not two. Collapsing them into one boolean is what made a
 * freshly claimed transfer render as "Voting — in progress" beside a full 4/4
 * approval meter: "not claimable" was true both for *already claimed* and for
 * *could not be checked*, and only the second one means the API's status should
 * be believed.
 */
export type ClaimCheck =
  /** The chain says this is claimed, whatever the API still reports. */
  | 'claimed'
  /** Offer the button: the chain says unclaimed, or it could not be reached. */
  | 'claimable'
  /** Nothing to offer: not awaiting a claim, no contract, or unreadable. */
  | 'unknown'

export interface MapApiTransferInput {
  readonly remote: ApiTransfer
  /** Records already stored for this address, to recover what the API omits. */
  readonly local: readonly StoredTransfer[]
  /** The token this transfer moves, resolved from `originalTokenAddress`. */
  readonly token: Token
  /** keccak256, injected so this stays pure. */
  readonly hash: (value: string) => string
  /** What the bridge contract says; see {@link ClaimCheck}. */
  readonly claimCheck: ClaimCheck
}

export function mapApiTransfer(input: MapApiTransferInput): BridgeTransfer {
  const { remote, local, token, hash, claimCheck } = input

  const matched = matchLocalHathorTransfer(local, remote, hash)

  // The API reports the Hathor id directly when it has it; otherwise the local
  // record we matched is the only place it exists.
  const hathorTxId = toHathorTxId(remote.originTransactionHash) ?? matched?.hathorTxId ?? null

  return {
    transactionId: remote.transactionId,
    transactionHash: remote.transactionHash,
    backendTxHash: remote.backendTxHash,
    hathorTxId,
    // Prefer the Hathor id so the row links to the Hathor explorer; fall back to
    // the EVM hash, which the row template renders as "Not available".
    displayedTxHash: hathorTxId ?? remote.backendTxHash,

    tokenSymbol: token.hathor.symbol || token.key,
    tokenDecimals: token.hathor.decimals,

    amount: remote.amount,
    amountDecimals: apiAmountDecimals(remote.status, token.hathor.decimals),

    sender: resolveOriginSender(remote, matched),

    // The chain outranks the API here. The API keeps reporting `awaiting_claim`
    // for a while after the claim is mined, and rendering that status while the
    // approval meter reads 4/4 tells the user their claim did not happen.
    status: claimCheck === 'claimed' ? TransferStatus.Claimed : remote.status,
    votes: remote.votes,
    signatures: remote.signatures,
    blockNumber: remote.blockNumber,

    claim: claimCheck === 'claimable' ? toClaimRequest(remote) : null,
  }
}

/**
 * The claim parameters, typed.
 *
 * `blockHash` for a Hathor-origin transfer is `keccak256(hathorTxId)`, not an
 * EVM block hash — the bridge adapter duplicates it into both hash slots.
 */
function toClaimRequest(remote: ApiTransfer): BridgeTransfer['claim'] {
  if (
    !remote.receiver ||
    !remote.blockHash ||
    remote.logIndex == null ||
    remote.originChainId == null ||
    remote.destinationChainId == null
  ) {
    return null
  }

  return {
    to: remote.receiver,
    amount: remote.amount,
    blockHash: remote.blockHash,
    logIndex: remote.logIndex,
    originChainId: remote.originChainId,
    destinationChainId: remote.destinationChainId,
  }
}

/**
 * Whether the API's status warrants re-checking the claim on-chain.
 *
 * `awaiting_claim` is **not authoritative**: a transfer already claimed still
 * reports it, so offering a Claim button on that alone sends users to a
 * transaction that reverts.
 */
export function needsClaimCheck(status: string | null): boolean {
  return status === TransferStatus.AwaitingClaim
}
