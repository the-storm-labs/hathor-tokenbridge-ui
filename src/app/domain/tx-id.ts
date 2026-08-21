/**
 * Recovering Hathor-side identity from records that may only carry EVM-side data.
 *
 * The Read API reports a Hathor tx id 0x-prefixed, but the Hathor wallet and
 * explorer both use the bare 64-char hex. Getting this wrong produces explorer
 * links that 404 and history rows that never match their local record. The same
 * boundary problem applies to the sender — see {@link resolveOriginSender}.
 */

/**
 * Hathor addresses are base58 and never 0x-prefixed, so the prefix is enough to
 * tell which side of the bridge an address belongs to.
 */
export function isEvmSideAddress(address: string | null | undefined): boolean {
  return !!address && address.startsWith('0x')
}

/** Strip the API's 0x prefix to get the id Hathor itself uses. */
export function toHathorTxId(originTransactionHash: string | null | undefined): string | null {
  if (!originTransactionHash) return null
  return originTransactionHash.replace(/^0x/, '')
}

/** Shorten a hash or address for display: `12345678...abcdef`. */
export function truncateMiddle(str: string, start = 8, end = 6): string {
  if (!str || str.length <= start + end + 3) return str
  return str.slice(0, start) + '...' + str.slice(-end)
}

export interface LocalHathorTransfer {
  readonly hathorTxId?: string | null
}

/**
 * The Hathor address that originated a Hathor→EVM transfer.
 *
 * The Read API only reports a real Hathor sender on records the Hathor
 * federation relayed. On the rest it reports the **federation relayer's EVM
 * address**, which is not the user's sender and is what the history table
 * renders as "Not available".
 *
 * Crucially that value is truthy, so a plain `remote.sender || local.sender`
 * never falls through — the locally captured address was always discarded. When
 * we sent the transfer ourselves we know the real sender, and an API update must
 * not overwrite it.
 *
 * @returns the most meaningful sender available, or null.
 */
export function resolveOriginSender(
  remote: { readonly sender?: string | null },
  local: { readonly sender?: string | null } | null,
): string | null {
  // A Hathor sender straight from the API is authoritative.
  if (remote.sender && !isEvmSideAddress(remote.sender)) return remote.sender

  // Otherwise prefer what we captured locally at send time over the relayer.
  if (local?.sender) return local.sender

  return remote.sender ?? null
}

export interface RemoteTransfer {
  readonly originTransactionHash?: string | null
  readonly backendTxHash?: string | null
  readonly blockHash?: string | null
}

/**
 * Find the locally stored Hathor send that produced an API transaction.
 *
 * The Read API identifies the Hathor origin in one of two ways, and which one
 * depends on how the record reached the bridge:
 *
 *  - `originTransactionHash` — the Hathor tx id, 0x-prefixed. Present only on
 *    records the Hathor federation reported (those also carry a Hathor `sender`
 *    and a non-zero `signatures`).
 *  - `blockHash` — `keccak256(hathorTxId)`. A Hathor-origin transfer has no EVM
 *    block of its own, so the federation puts this synthetic id in the blockHash
 *    slot. It is the same value the claim data hash is built from.
 *
 * Measured against live mainnet data (28 API records, 388 bridge transactions):
 * 11 matched on `originTransactionHash`, the other 17 on `blockHash`, and none
 * were left unmatched. **Zero matched on `transactionHash`** — which is all the
 * hashed branch used to compare against, so it never fired and every record
 * missing `originTransactionHash` silently became a duplicate row.
 *
 * @param hash keccak256, injected rather than reached for via the `Web3` global
 *             so this stays a pure function that tests can drive. Note it must
 *             hash the *bare* id as text — the bridge does not treat it as bytes.
 */
export function matchLocalHathorTransfer<T extends LocalHathorTransfer>(
  localTransfers: readonly T[],
  remote: RemoteTransfer,
  hash: (value: string) => string,
): T | null {
  const originTxId = toHathorTxId(remote.originTransactionHash)

  const match = localTransfers.find((local) => {
    if (!local.hathorTxId) return false
    if (local.hathorTxId === originTxId) return true

    const hashed = hash(local.hathorTxId)
    return (
      hashed === remote.blockHash ||
      // Kept as a fallback for record shapes not seen in the sample above.
      hashed === remote.backendTxHash ||
      hashed === remote.originTransactionHash
    )
  })

  return match ?? null
}
