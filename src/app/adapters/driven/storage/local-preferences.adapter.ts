import type { PreferencesPort } from '../../../ports/driven/preferences.port'

/**
 * Preferences in Web Storage.
 *
 * The two key names are exactly the ones the previous code used — changing them
 * would silently log every returning user out of both wallets.
 */
const LAST_CONNECTED_WALLET_KEY = 'lastConnectedWallet'
const HATHOR_ADDRESS_KEY = 'htr_wallet_address'

export class LocalPreferencesAdapter implements PreferencesPort {
  constructor(private readonly storage: Storage) {}

  getLastConnectedWallet(): string | null {
    return this.read(LAST_CONNECTED_WALLET_KEY)
  }

  setLastConnectedWallet(rdns: string): void {
    this.write(LAST_CONNECTED_WALLET_KEY, rdns)
  }

  clearLastConnectedWallet(): void {
    this.remove(LAST_CONNECTED_WALLET_KEY)
  }

  getHathorAddress(): string | null {
    return this.read(HATHOR_ADDRESS_KEY)
  }

  setHathorAddress(address: string): void {
    this.write(HATHOR_ADDRESS_KEY, address)
  }

  clearHathorAddress(): void {
    this.remove(HATHOR_ADDRESS_KEY)
  }

  // Storage throws in private-browsing modes and when the quota is full. A
  // preference is never important enough to break the page over.
  private read(key: string): string | null {
    try {
      return this.storage.getItem(key)
    } catch {
      return null
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage.setItem(key, value)
    } catch {
      /* ignored on purpose */
    }
  }

  private remove(key: string): void {
    try {
      this.storage.removeItem(key)
    } catch {
      /* ignored on purpose */
    }
  }
}
