/**
 * Detects an EIP-7702 delegation on an EVM address.
 *
 * Exists so SendHathorTransfer can refuse a destination the bridge could never
 * let the user claim to, before a Hathor transaction is sent — not after
 * Hathor voting finishes, which is where this was discovered until now.
 */
export interface Eip7702Port {
  /**
   * @returns the delegate address `address` currently delegates execution to,
   *   or `null` — for a plain EOA, an address with nothing deployed, a real
   *   contract's own bytecode, *or* when the check itself could not be
   *   completed. Callers that need to tell "confirmed clean" apart from
   *   "unreachable" cannot, by design: see the adapter.
   */
  getDelegate(address: string): Promise<string | null>
}
