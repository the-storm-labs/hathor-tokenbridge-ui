import type {
  StoredTransfer,
  TransferHistoryPort,
} from '../../../ports/driven/transfer-history.port'

/**
 * Transfer history backed by Web Storage. Ported from the TXN_Storage class.
 *
 * ## The storage key is a compatibility contract
 *
 * Real users have real history under keys built exactly this way. Two details
 * look like bugs and must not be "fixed":
 *
 *  - `.replace(' ', '-')` is **not global**, so only the first space is
 *    replaced. A network named `"Hathor Main Net"` keys as
 *    `"hathor-main net"`. Making it global would orphan existing data.
 *  - the whole key is lowercased on read and write, so address casing does not
 *    split a user's history in two.
 *
 * ## Fixed while porting
 *
 * The original captured `Storage` lazily inside `isStorageAvailable()`, so every
 * other method threw if that had not been called first. It survived only because
 * of call ordering in updateNetwork. Here the storage object is injected, so it
 * is impossible to use uninitialised. The original's quota branch also
 * referenced an undeclared `storage` variable and threw a ReferenceError instead
 * of returning false.
 */
export class LocalTransferHistoryAdapter implements TransferHistoryPort {
  constructor(private readonly storage: Storage) {}

  isAvailable(): boolean {
    try {
      const probe = '__storage_test__'
      this.storage.setItem(probe, probe)
      this.storage.removeItem(probe)
      return true
    } catch {
      return false
    }
  }

  list(accountAddress: string, networkName: string): StoredTransfer[] {
    return this.read(storageKey(accountAddress, networkName)).sort((a, b) => {
      // Records with no block number are freshly submitted; sorting them as
      // Infinity floats them to the top.
      const left = a.blockNumber ?? Infinity
      const right = b.blockNumber ?? Infinity
      return left <= right ? 1 : -1
    })
  }

  addEvmTransfer(accountAddress: string, networkName: string, transfer: StoredTransfer): void {
    const key = storageKey(accountAddress, networkName)
    this.write(key, [...this.read(key), stripReceiptNoise(transfer)])
  }

  upsertHathorTransfer(
    accountAddress: string,
    networkName: string,
    transfer: StoredTransfer,
  ): void {
    const key = storageKey(accountAddress, networkName)
    const stored = this.read(key)

    const matches = stored.filter((candidate) => identifiesSameTransfer(candidate, transfer))
    const existing = matches[0]

    // Skip the write only when there is exactly one copy and nothing about it
    // changed. With duplicates present we must always collapse them — see
    // identifiesSameTransfer for why duplicates exist at all.
    if (existing && matches.length === 1 && !hasChanged(existing, transfer)) return

    this.write(key, [
      ...stored.filter((candidate) => !identifiesSameTransfer(candidate, transfer)),
      transfer,
    ])
  }

  private read(key: string): StoredTransfer[] {
    try {
      const raw = this.storage.getItem(key)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      return Array.isArray(parsed) ? (parsed as StoredTransfer[]) : []
    } catch {
      // Corrupt JSON must not take the history table down with it.
      return []
    }
  }

  private write(key: string, transfers: readonly StoredTransfer[]): void {
    this.storage.setItem(key, JSON.stringify(transfers))
  }
}

/**
 * @see LocalTransferHistoryAdapter for why the non-global replace and the
 *      lowercasing are load-bearing.
 */
export function storageKey(accountAddress: string, networkName: string): string {
  return `${accountAddress}-${networkName.toLowerCase().replace(' ', '-')}`.toLowerCase()
}

/**
 * Whether two records describe the same transfer.
 *
 * A transfer legitimately gets stored twice: once locally at send time (no
 * `transactionId` yet) and once from the Read API (which has one). The original
 * looked up only the *first* match, by the most specific key available, so once
 * both copies existed every later poll re-found the API record by
 * `transactionId`, never looked at `hathorTxId`, and the pair never collapsed.
 *
 * Any shared identifier means the same transfer, so all of them are checked.
 */
function identifiesSameTransfer(candidate: StoredTransfer, incoming: StoredTransfer): boolean {
  return (
    (!!incoming.transactionId && candidate.transactionId === incoming.transactionId) ||
    (!!incoming.hathorTxId && candidate.hathorTxId === incoming.hathorTxId) ||
    (!!incoming.backendTxHash && candidate.backendTxHash === incoming.backendTxHash) ||
    (!!incoming.transactionHash && candidate.transactionHash === incoming.transactionHash)
  )
}

function hasChanged(existing: StoredTransfer, incoming: StoredTransfer): boolean {
  // Learning the EVM hash for the first time is a change worth persisting even
  // when nothing else moved.
  if (incoming.backendTxHash && !existing.backendTxHash) return true

  return (
    incoming.status !== existing.status ||
    incoming.votes !== existing.votes ||
    incoming.signatures !== existing.signatures ||
    incoming.blockNumber !== existing.blockNumber
  )
}

/** Fields of a web3 receipt that are large and never read back. */
const RECEIPT_NOISE = [
  'transactionIndex',
  'cumulativeGasUsed',
  'gasUsed',
  'contractAddress',
  'logs',
  'to',
  'root',
  'logsBloom',
] as const

function stripReceiptNoise(transfer: StoredTransfer): StoredTransfer {
  // The original mutated its caller's object with `delete`; copying avoids that.
  const copy: Record<string, unknown> = { ...transfer }
  for (const field of RECEIPT_NOISE) delete copy[field]
  return copy as StoredTransfer
}
