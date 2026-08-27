/**
 * EIP-7702 set-code delegation detection.
 *
 * A delegated EOA's `eth_getCode` no longer returns empty bytecode: it returns
 * a fixed-shape "delegation designator" — `0xef0100` followed by the 20-byte
 * address the account currently delegates execution to (EIP-7702, "Set EOA
 * account code"). That is 23 bytes total, so as the hex string `eth_getCode`
 * returns it is always exactly 48 characters: `0x` + 6 hex chars of prefix +
 * 40 hex chars of address.
 *
 * The bridge cannot process a claim to a delegated account — see
 * SendHathorTransfer — so this only needs to say who (if anyone) an address
 * delegates to; it has no opinion on the delegate contract itself, and a
 * genuinely deployed contract's own bytecode is out of scope (wrong prefix).
 */

const DELEGATION_PREFIX = '0xef0100'
const DELEGATION_DESIGNATOR_LENGTH = 48

/**
 * @param code Raw bytecode from `eth_getCode`, or null/undefined for an
 *   address with none (a plain EOA, or nothing deployed there).
 * @returns the delegate address (lowercase) the account currently delegates
 *   to, or `null` when there is no active EIP-7702 delegation.
 */
export function parseEip7702Delegate(code: string | null | undefined): string | null {
  if (!code) return null

  const normalized = code.toLowerCase()
  if (normalized.length !== DELEGATION_DESIGNATOR_LENGTH) return null
  if (!normalized.startsWith(DELEGATION_PREFIX)) return null

  return `0x${normalized.slice(DELEGATION_PREFIX.length)}`
}
