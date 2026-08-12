/**
 * Small persisted user preferences — the things that make a reload feel like a
 * continuation rather than a fresh start.
 */
export interface PreferencesPort {
  /** rdns of the EIP-6963 wallet to reconnect to automatically. */
  getLastConnectedWallet(): string | null
  setLastConnectedWallet(rdns: string): void
  clearLastConnectedWallet(): void

  /** Hathor address of the restored WalletConnect session. */
  getHathorAddress(): string | null
  setHathorAddress(address: string): void
  clearHathorAddress(): void
}
