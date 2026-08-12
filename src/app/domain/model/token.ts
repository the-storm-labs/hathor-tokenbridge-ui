/** A token as it exists on the EVM side of the bridge. */
export interface TokenOnEvm {
  readonly symbol: string
  readonly address: string
  readonly decimals: number
}

/** A token as it exists on the Hathor side. */
export interface TokenOnHathor {
  readonly symbol: string
  /** The EVM-side side-token contract that mirrors this Hathor token. */
  readonly address: string
  /** Token UID, 0x-prefixed. `'00'` for native HTR. */
  readonly hathorAddr: string
  /** Token UID as Hathor itself uses it — bare hex, or `'00'` for native HTR. */
  readonly pureHtrAddress: string
  readonly decimals: number
}

export interface Token {
  /** Stable key: the `<option value>` and the lookup key everywhere. */
  readonly key: string
  readonly name: string
  readonly icon: string

  /**
   * `null` when the token is not deployed on this deployment's EVM chain. The
   * token dropdown skips those, which is why SLT7 and HTOG3 are invisible on
   * mainnet today.
   */
  readonly evm: TokenOnEvm | null

  /**
   * Always present, never null — the HTR dropdown reads
   * `token.hathor.pureHtrAddress` unguarded, so an absent object would throw.
   * Unavailability is expressed as empty strings, exactly as the original did.
   * Use {@link isOnHathor} rather than testing the object.
   */
  readonly hathor: TokenOnHathor
}

/** Whether this token can actually be bridged from Hathor on this deployment. */
export function isOnHathor(token: Token): boolean {
  return token.hathor.pureHtrAddress !== ''
}

/** Whether this token exists on this deployment's EVM chain. */
export function isOnEvm(token: Token): token is Token & { evm: TokenOnEvm } {
  return token.evm !== null
}
