import { describe, it, expect, vi } from 'vitest'
import { HathorWalletConnectAdapter } from './walletconnect.adapter'
import { UserRejectedError } from '../../../ports/driven/hathor-wallet.port'
import type { PreferencesPort } from '../../../ports/driven/preferences.port'

const ADDRESS = 'HDeadbeefDeadbeefDeadbeefDeadbeef01'

const DAY_MS = 24 * 60 * 60 * 1000
/** `expiry` is unix **seconds**, not milliseconds — the whole point of the check. */
const expiryInDays = (days: number) => Math.floor((Date.now() + days * DAY_MS) / 1000)

const sessionExpiring = (days: number) => ({
  topic: 'topic-1',
  expiry: expiryInDays(days),
  namespaces: { hathor: { accounts: [`hathor:mainnet:${ADDRESS}`] } },
})

/** A freshly opened session: the full seven-day term. */
const SESSION = sessionExpiring(7)

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
  const request = vi.fn(async () => ({ response: { hash: 'deadbeef' } }))
  const extend = vi.fn(async () => ({}))

  // The SDK reports a lost session on two different emitters — the provider and
  // the SignClient underneath it — so the fake keeps both.
  const providerEvents = new Map<string, (payload?: unknown) => void>()
  const clientEvents = new Map<string, (payload: { topic?: string }) => void>()

  // One instance, not a fresh literal per call: a test that reaches in to break
  // the connector has to be breaking the one the adapter is holding.
  const connector = {
    connect: async () => ({ session: SESSION }),
    disconnect: async () => {},
    provider: {
      session,
      client: {
        request,
        extend,
        on: (event: string, listener: (payload: { topic?: string }) => void) =>
          void clientEvents.set(event, listener),
      },
      on: (event: string, listener: (payload?: unknown) => void) =>
        void providerEvents.set(event, listener),
    },
  }
  const init = vi.fn(async () => connector)

  const preferences = fakePreferences(storedAddress)
  const adapter = new HathorWalletConnectAdapter(
    { init } as never,
    { projectId: 'p', appUrl: 'https://example.test', appIcon: 'icon.png' },
    preferences,
    { getBalance: async () => ({ available: 0, locked: 0 }) } as never,
  )

  return { adapter, init, connector, preferences, request, extend, providerEvents, clientEvents }
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
    const { adapter } = setup(ADDRESS, {
      topic: 'topic-1',
      expiry: expiryInDays(7),
      namespaces: {},
    })

    await expect(adapter.restore('mainnet')).resolves.toEqual({ address: ADDRESS })
  })

  it('refuses a session that has run out, and says so', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { adapter, preferences } = setup(ADDRESS, sessionExpiring(-1))

    // Not plain null: the caller has to tell "you were never connected" from
    // "you were, and it lapsed", because only the second is worth a message.
    await expect(adapter.restore('mainnet')).resolves.toEqual({ address: null, expired: true })
    expect(preferences.getHathorAddress()).toBeNull()
    expect(adapter.isConnected()).toBe(false)
    expect(adapter.getAddress()).toBeNull()
  })

  it('refuses a session about to run out, rather than mid-transfer', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    // Thirty seconds of life left: enough to survive the page load, not enough
    // to survive the transfer the user is about to start.
    const { adapter } = setup(ADDRESS, { ...SESSION, expiry: Math.floor(Date.now() / 1000) + 30 })

    await expect(adapter.restore('mainnet')).resolves.toEqual({ address: null, expired: true })
  })

  it('keeps a session whose shape carries no expiry at all', async () => {
    // Signing the user out over a field we failed to read is worse than the
    // failure the check exists for.
    const { adapter } = setup(ADDRESS, {
      topic: 'topic-1',
      namespaces: { hathor: { accounts: [`hathor:mainnet:${ADDRESS}`] } },
    })

    await expect(adapter.restore('mainnet')).resolves.toEqual({ address: ADDRESS })
    expect(adapter.isConnected()).toBe(true)
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

describe('renewal', () => {
  it('extends a session near the end of its term', async () => {
    const { adapter, extend } = setup(ADDRESS, sessionExpiring(1))

    await adapter.restore('mainnet')

    expect(extend).toHaveBeenCalledWith({ topic: 'topic-1' })
  })

  it('leaves a session with time on it alone', async () => {
    const { adapter, extend } = setup(ADDRESS, sessionExpiring(6))

    await adapter.restore('mainnet')

    expect(extend).not.toHaveBeenCalled()
  })

  it('restores anyway when the renewal fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { adapter, connector } = setup(ADDRESS, sessionExpiring(1))
    const extend = vi.fn(async () => {
      throw new Error('wallet unreachable')
    })
    connector.provider.client.extend = extend

    // The renewal is a relay round trip that needs the phone awake. A restore
    // must not wait on one, nor fail because of one.
    await expect(adapter.restore('mainnet')).resolves.toEqual({ address: ADDRESS })
    expect(extend).toHaveBeenCalledOnce()
  })
})

describe('a session lost while the page is open', () => {
  it('tells its listeners when the wallet deletes it', async () => {
    const { adapter, providerEvents } = setup(ADDRESS)
    const lost = vi.fn()
    adapter.onSessionLost(lost)

    await adapter.restore('mainnet')
    expect(adapter.isConnected()).toBe(true)

    providerEvents.get('session_delete')?.({ topic: 'topic-1' })

    expect(lost).toHaveBeenCalledOnce()
    expect(adapter.isConnected()).toBe(false)
    expect(adapter.getAddress()).toBeNull()
  })

  it('announces the death once, however many times the SDK reports it', async () => {
    const { adapter, providerEvents, clientEvents } = setup(ADDRESS)
    const lost = vi.fn()
    adapter.onSessionLost(lost)
    await adapter.restore('mainnet')

    clientEvents.get('session_expire')?.({ topic: 'topic-1' })
    providerEvents.get('session_delete')?.({ topic: 'topic-1' })
    providerEvents.get('disconnect')?.({})

    expect(lost).toHaveBeenCalledOnce()
  })

  it('ignores an expiry reported for somebody else’s topic', async () => {
    const { adapter, clientEvents } = setup(ADDRESS)
    const lost = vi.fn()
    adapter.onSessionLost(lost)
    await adapter.restore('mainnet')

    clientEvents.get('session_expire')?.({ topic: 'a-different-topic' })

    expect(lost).not.toHaveBeenCalled()
    expect(adapter.isConnected()).toBe(true)
  })
})

describe('sending over a dead session', () => {
  const TRANSFER = {
    bridgeAddress: 'HBridgeBridgeBridgeBridgeBridge01',
    tokenUid: '00',
    amountUnits: '100',
    evmDestination: '0x1234567890abcdef1234567890abcdef12345678',
  }

  it('fails immediately instead of waiting out the relay', async () => {
    const session = sessionExpiring(7)
    const { adapter, request } = setup(ADDRESS, session)
    const lost = vi.fn()
    adapter.onSessionLost(lost)
    await adapter.restore('mainnet')

    // The session reaches its expiry with the page still open.
    session.expiry = expiryInDays(-1)

    await expect(adapter.sendBridgeTransfer(TRANSFER, 'mainnet')).rejects.toThrow(/expired/i)
    // Sending it would have hung for the five minutes `wc_sessionRequest` waits,
    // behind a pending toast that never auto-dismisses.
    expect(request).not.toHaveBeenCalled()
    expect(lost).toHaveBeenCalledOnce()
    expect(adapter.isConnected()).toBe(false)
  })

  it('still sends while the session is alive', async () => {
    const { adapter, request } = setup(ADDRESS)
    await adapter.restore('mainnet')

    await expect(adapter.sendBridgeTransfer(TRANSFER, 'mainnet')).resolves.toEqual({
      hash: 'deadbeef',
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('addresses the Hathor testnet, not the deployment name, from testnet-arb', async () => {
    // testnet-arb is ours; the wallet only knows `mainnet` and `testnet`. The
    // session has to be a testnet one: a mainnet session is refused on this page.
    const testnetAddress = 'WDeadbeefDeadbeefDeadbeefDeadbeef01'
    const { adapter, request } = setup(testnetAddress, {
      ...SESSION,
      namespaces: { hathor: { accounts: [`hathor:testnet:${testnetAddress}`] } },
    })
    await expect(adapter.restore('testnet-arb')).resolves.toEqual({ address: testnetAddress })
    await adapter.sendBridgeTransfer(TRANSFER, 'testnet-arb')

    const [call] = request.mock.calls[0] as unknown as [
      { chainId: string; request: { params: { network: string } } },
    ]
    expect(call.chainId).toBe('hathor:testnet')
    expect(call.request.params.network).toBe('testnet')
  })

  it('reports the user declining as UserRejectedError, not the raw JSON-RPC object', async () => {
    // @walletconnect/jsonrpc-provider rejects with the bare error off the wire —
    // WalletConnect's own standard shape for a decline, not an Error instance.
    const { adapter, request } = setup(ADDRESS)
    request.mockRejectedValueOnce({ code: 5000, message: 'User rejected.' })
    await adapter.restore('mainnet')

    await expect(adapter.sendBridgeTransfer(TRANSFER, 'mainnet')).rejects.toThrow(UserRejectedError)
  })

  it('still recognises a decline that carries a different code but says so in the message', async () => {
    const { adapter, request } = setup(ADDRESS)
    request.mockRejectedValueOnce({ code: 4001, message: 'User Rejected Request' })
    await adapter.restore('mainnet')

    await expect(adapter.sendBridgeTransfer(TRANSFER, 'mainnet')).rejects.toThrow(UserRejectedError)
  })

  it('leaves an unrelated failure alone', async () => {
    const { adapter, request } = setup(ADDRESS)
    request.mockRejectedValueOnce({ code: -32000, message: 'insufficient funds' })
    await adapter.restore('mainnet')

    const rejection = adapter.sendBridgeTransfer(TRANSFER, 'mainnet')
    await expect(rejection).rejects.not.toBeInstanceOf(UserRejectedError)
    await expect(rejection).rejects.toMatchObject({ message: 'insufficient funds' })
  })
})

describe('connect', () => {
  it('stores the address, which is what a later restore keys off', async () => {
    const { adapter, preferences } = setup(null)

    await expect(adapter.connect('mainnet')).resolves.toEqual({ address: ADDRESS })
    expect(preferences.getHathorAddress()).toBe(ADDRESS)
  })
})

describe('one origin, two networks', () => {
  // The mainnet and testnet pages share an origin, so they share WalletConnect's storage and the
  // stored address. Found on 2026-10-03: a testnet session showed as connected on the mainnet page.
  const TESTNET_ADDRESS = 'WDeadbeefDeadbeefDeadbeefDeadbeef01'
  const testnetSession = {
    topic: 'topic-testnet',
    expiry: expiryInDays(7),
    namespaces: { hathor: { accounts: [`hathor:testnet:${TESTNET_ADDRESS}`] } },
  }

  it('does not restore a testnet session on the mainnet page, nor drop it for the testnet page', async () => {
    const { adapter, preferences } = setup(ADDRESS, testnetSession)

    await expect(adapter.restore('mainnet')).resolves.toBeNull()
    expect(adapter.isConnected()).toBe(false)
    expect(adapter.getAddress()).toBeNull()
    expect(preferences.getHathorAddress()).toBe(ADDRESS)
  })

  it('does not restore from an address stored by the other network’s page', async () => {
    const { adapter, init, preferences } = setup(TESTNET_ADDRESS)

    await expect(adapter.restore('mainnet')).resolves.toBeNull()
    expect(init).not.toHaveBeenCalled()
    expect(preferences.getHathorAddress()).toBe(TESTNET_ADDRESS)
  })

  it('restores the testnet session on the testnet page', async () => {
    const { adapter } = setup(TESTNET_ADDRESS, testnetSession)

    await expect(adapter.restore('testnet')).resolves.toEqual({ address: TESTNET_ADDRESS })
    expect(adapter.getAddress()).toBe(TESTNET_ADDRESS)
  })

  it('adopts this network’s account when a session carries both', async () => {
    const { adapter } = setup(ADDRESS, {
      topic: 'topic-1',
      expiry: expiryInDays(7),
      namespaces: {
        hathor: { accounts: [`hathor:testnet:${TESTNET_ADDRESS}`, `hathor:mainnet:${ADDRESS}`] },
      },
    })

    await expect(adapter.restore('mainnet')).resolves.toEqual({ address: ADDRESS })
  })

  it('refuses a connect that comes back on the other network', async () => {
    const { adapter, connector, preferences } = setup(null)
    connector.connect = async () => ({ session: testnetSession })

    await expect(adapter.connect('mainnet')).rejects.toThrow(/connected to the testnet/)
    expect(adapter.isConnected()).toBe(false)
    expect(preferences.getHathorAddress()).toBeNull()
  })

  it('will not send over a session it did not adopt', async () => {
    const { adapter, request } = setup(ADDRESS, testnetSession)
    await adapter.restore('mainnet')

    await expect(
      adapter.sendBridgeTransfer(
        {
          bridgeAddress: 'hQj6skwZY9RT3bRvFuRjioJP5ZbLSRYeuD',
          amountUnits: '100',
          tokenUid: '00',
          evmDestination: '0x0',
        },
        'mainnet',
      ),
    ).rejects.toThrow(/not connected/)
    expect(request).not.toHaveBeenCalled()
  })
})
