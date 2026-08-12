import { describe, it, expect, vi } from 'vitest'
import { HathorWalletConnectAdapter } from './walletconnect.adapter'
import type { PreferencesPort } from '../../../ports/driven/preferences.port'

const ADDRESS = 'HDeadbeefDeadbeefDeadbeefDeadbeef01'
const SESSION = {
  topic: 'topic-1',
  namespaces: { hathor: { accounts: [`hathor:mainnet:${ADDRESS}`] } },
}

function fakePreferences(hathorAddress: string | null): PreferencesPort {
  let stored = hathorAddress
  return {
    getLastConnectedWallet: () => null,
    setLastConnectedWallet: () => {},
    clearLastConnectedWallet: () => {},
    getHathorAddress: () => stored,
    setHathorAddress: (address: string) => {
      stored = address
    },
    clearHathorAddress: () => {
      stored = null
    },
  }
}

function setup(storedAddress: string | null, session: unknown = SESSION) {
  const init = vi.fn(async () => ({
    connect: async () => ({ session: SESSION }),
    disconnect: async () => {},
    provider: { session },
  }))

  const preferences = fakePreferences(storedAddress)
  const adapter = new HathorWalletConnectAdapter(
    { init } as never,
    { projectId: 'p', appUrl: 'https://example.test', appIcon: 'icon.png' },
    preferences,
    { getBalance: async () => ({ available: 0, locked: 0 }) } as never,
  )

  return { adapter, init, preferences }
}

describe('restore', () => {
  it('does not touch WalletConnect when no session was ever stored', async () => {
    const { adapter, init } = setup(null)

    await expect(adapter.restore('mainnet')).resolves.toBeNull()

    // Initialising Reown opens a relay connection, boots Lit and the AppKit
    // modal, and replays whatever WalletConnect has queued. A visitor who only
    // uses the ARB→HTR form should pay none of that.
    expect(init).not.toHaveBeenCalled()
    expect(adapter.isConnected()).toBe(false)
  })

  it('reattaches to a stored session and reports its address', async () => {
    const { adapter, init } = setup(ADDRESS)

    await expect(adapter.restore('mainnet')).resolves.toEqual({ address: ADDRESS })
    expect(init).toHaveBeenCalledOnce()
    expect(adapter.isConnected()).toBe(true)
    expect(adapter.getAddress()).toBe(ADDRESS)
  })

  it('forgets the address when the wallet no longer has the session', async () => {
    const { adapter, preferences } = setup(ADDRESS, null)

    await expect(adapter.restore('mainnet')).resolves.toBeNull()
    expect(preferences.getHathorAddress()).toBeNull()
    expect(adapter.isConnected()).toBe(false)
  })

  it('falls back to the stored address when the session carries no accounts', async () => {
    const { adapter } = setup(ADDRESS, { topic: 'topic-1', namespaces: {} })

    await expect(adapter.restore('mainnet')).resolves.toEqual({ address: ADDRESS })
  })

  it('survives a connector that refuses to initialise', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const preferences = fakePreferences(ADDRESS)
    const adapter = new HathorWalletConnectAdapter(
      {
        init: async () => {
          throw new Error('relay unreachable')
        },
      } as never,
      { projectId: 'p', appUrl: 'https://example.test', appIcon: 'icon.png' },
      preferences,
      { getBalance: async () => ({ available: 0, locked: 0 }) } as never,
    )

    // A restore that throws would take the whole module entry down with it.
    await expect(adapter.restore('mainnet')).resolves.toBeNull()
  })
})

describe('connect', () => {
  it('stores the address, which is what a later restore keys off', async () => {
    const { adapter, preferences } = setup(null)

    await expect(adapter.connect('mainnet')).resolves.toEqual({ address: ADDRESS })
    expect(preferences.getHathorAddress()).toBe(ADDRESS)
  })
})
