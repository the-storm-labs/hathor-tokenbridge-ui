import { findTokenByBridgeAddress } from '../../domain/token-lookup'
import type { BridgeTransfer } from '../../domain/model/transfer'
import type { Token } from '../../domain/model/token'
import type { BridgeRoute } from '../../domain/model/network'
import type { BridgeApiPort } from '../../ports/driven/bridge-api.port'
import { TransferDirection } from '../../ports/driven/bridge-api.port'
import type { BridgeContractPort } from '../../ports/driven/contracts.port'
import type { TransferHistoryPort, StoredTransfer } from '../../ports/driven/transfer-history.port'
import { mapApiTransfer, needsClaimCheck } from '../mappers/api-transfer.mapper'

/**
 * Loads the Hathor→EVM transfer history for an address.
 *
 * Absorbs fillHathorToEvmTxs, getPendingClaims and resolveClaimStatus. Returns
 * data — no HTML, no DOM. What it still does is persist: the local store is the
 * only place the Hathor tx id and sender survive for records the API reports
 * without them.
 */

export interface LoadTransferHistoryDeps {
  readonly bridgeApi: BridgeApiPort
  readonly bridge: BridgeContractPort | null
  readonly history: TransferHistoryPort
  readonly tokens: readonly Token[]
  readonly route: BridgeRoute
  /** keccak256, for recovering a Hathor id the API omitted. */
  readonly hash: (value: string) => string
}

export interface TransferHistory {
  readonly hathorToEvm: readonly BridgeTransfer[]
  /** EVM-origin transfers, read straight from local storage. */
  readonly evmToHathor: readonly StoredTransfer[]
}

const API_PAGE_LIMIT = 1000

export function createLoadTransferHistory(deps: LoadTransferHistoryDeps) {
  return async function loadTransferHistory(evmAddress: string): Promise<TransferHistory> {
    if (!evmAddress) return { hathorToEvm: [], evmToHathor: [] }

    const hathorNetwork = deps.route.hathor.name
    const evmNetwork = deps.route.evm.name

    const remote = await fetchRemote(deps, evmAddress)
    // Read once, before any write: the mapper needs the pre-existing records to
    // recover ids the API omits, and upserting as we go would move the target.
    const local = deps.history.list(evmAddress, hathorNetwork)

    const mapped: BridgeTransfer[] = []
    for (const record of remote) {
      const token = findTokenByBridgeAddress(deps.tokens, record.originalTokenAddress)
      // A transfer of a token this deployment does not list cannot be rendered;
      // skipping matches the previous behaviour.
      if (!token) continue

      const transfer = mapApiTransfer({
        remote: record,
        local,
        token,
        hash: deps.hash,
        claimable: await isActuallyClaimable(deps, record.status, record),
      })

      deps.history.upsertHathorTransfer(evmAddress, hathorNetwork, toStored(transfer))
      mapped.push(transfer)
    }

    return {
      // Re-read so the result includes locally-sent transfers the API has not
      // indexed yet, in the storage layer's sort order.
      hathorToEvm: reconcile(deps.history.list(evmAddress, hathorNetwork), mapped),
      evmToHathor: deps.history.list(evmAddress, evmNetwork),
    }
  }
}

async function fetchRemote(deps: LoadTransferHistoryDeps, evmAddress: string) {
  try {
    return await deps.bridgeApi.listByReceiver(evmAddress, {
      limit: API_PAGE_LIMIT,
      direction: TransferDirection.HathorToEvm,
    })
  } catch (error) {
    // The history table still has local records worth showing; an unreachable
    // API must not blank it.
    console.error('Could not fetch transfers from the Read API', error)
    return []
  }
}

/**
 * Re-checks a claim against the chain.
 *
 * `awaiting_claim` is not authoritative — a transfer already claimed keeps
 * reporting it — so offering the button on the API's word alone sends users to a
 * transaction that reverts.
 */
async function isActuallyClaimable(
  deps: LoadTransferHistoryDeps,
  status: string | null,
  record: { blockHash: string | null; receiver: string | null; amount: string; logIndex: number | null; originChainId: number | null; destinationChainId: number | null },
): Promise<boolean> {
  if (!needsClaimCheck(status) || !deps.bridge) return false
  if (!record.blockHash || !record.receiver || record.logIndex == null) return false
  if (record.originChainId == null || record.destinationChainId == null) return false

  try {
    const dataHash = await deps.bridge.getTransactionDataHash({
      to: record.receiver,
      amount: record.amount,
      blockHash: record.blockHash,
      logIndex: record.logIndex,
      originChainId: record.originChainId,
      destinationChainId: record.destinationChainId,
    })
    return !(await deps.bridge.isClaimed(dataHash))
  } catch (error) {
    // If the chain cannot be reached, trust the API rather than hide the button.
    console.warn('Could not verify claim status on-chain, using the API status', error)
    return true
  }
}

/** The persisted projection of a transfer. Amount stays raw; see BridgeTransfer. */
function toStored(transfer: BridgeTransfer): StoredTransfer {
  return {
    transactionId: transfer.transactionId,
    transactionHash: transfer.transactionHash,
    backendTxHash: transfer.backendTxHash,
    hathorTxId: transfer.hathorTxId,
    displayedTxHash: transfer.displayedTxHash,
    token: transfer.tokenSymbol,
    tokenDecimals: transfer.tokenDecimals,
    amount: transfer.amount,
    amountDecimals: transfer.amountDecimals,
    sender: transfer.sender,
    status: transfer.status,
    votes: transfer.votes,
    signatures: transfer.signatures,
    blockNumber: transfer.blockNumber,
  }
}

/**
 * Merges the freshly mapped transfers with what storage holds.
 *
 * Storage is authoritative for ordering and for records the API has not indexed
 * yet — a transfer sent seconds ago exists only locally. Where both have a
 * record, the mapped one wins: it carries the claim request and the resolved
 * scale, which a stored row cannot.
 */
function reconcile(
  stored: readonly StoredTransfer[],
  mapped: readonly BridgeTransfer[],
): readonly BridgeTransfer[] {
  const byKey = new Map<string, BridgeTransfer>()
  for (const transfer of mapped) {
    for (const key of identityKeys(transfer)) byKey.set(key, transfer)
  }

  return stored.map((record) => {
    for (const key of identityKeys(record)) {
      const match = byKey.get(key)
      if (match) return match
    }
    return fromStored(record)
  })
}

function identityKeys(record: {
  transactionId?: string | null
  hathorTxId?: string | null
  backendTxHash?: string | null
}): string[] {
  return [
    record.transactionId && `id:${record.transactionId}`,
    record.hathorTxId && `htr:${record.hathorTxId}`,
    record.backendTxHash && `evm:${record.backendTxHash}`,
  ].filter((key): key is string => !!key)
}

/**
 * A stored record as a transfer with no claim.
 *
 * Either one the API did not return — a locally-sent transfer awaiting
 * indexing, or one whose token this deployment no longer lists — or one being
 * rendered straight from storage while the next poll resolves it. The claim
 * request is checked against the bridge contract and is never persisted, so a
 * record from here never carries one.
 *
 * `amountDecimals` is absent on records written by earlier builds; the row
 * template treats that as "already formatted".
 */
export function fromStored(record: StoredTransfer): BridgeTransfer {
  return {
    transactionId: record.transactionId ?? null,
    transactionHash: record.transactionHash ?? null,
    backendTxHash: record.backendTxHash ?? null,
    hathorTxId: record.hathorTxId ?? null,
    displayedTxHash: record.displayedTxHash ?? null,
    tokenSymbol: record.token ?? '',
    tokenDecimals: (record['tokenDecimals'] as number | undefined) ?? 2,
    amount: record.amount ?? '0',
    amountDecimals: (record['amountDecimals'] as number | undefined) ?? null,
    sender: record.sender ?? null,
    status: record.status ?? null,
    votes: record.votes ?? 0,
    signatures: record.signatures ?? 0,
    blockNumber: record.blockNumber ?? null,
    claim: null,
  }
}
