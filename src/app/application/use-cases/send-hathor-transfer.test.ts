import { describe, it, expect, vi } from 'vitest'
import { createSendHathorTransfer } from './send-hathor-transfer'
import { ROUTES } from '../../config/networks'
import { findToken } from '../../config/tokens'
import { TransferStatus } from '../../ports/driven/bridge-api.port'
import type { StoredTransfer } from '../../ports/driven/transfer-history.port'

const ROUTE = ROUTES.mainnet
const AHTR = findToken('mainnet', 'aHTR')!
const USDC = findToken('mainnet', 'USDC')!
const NOT_BRIDGEABLE = findToken('mainnet', 'SLT7')! // no Hathor uid on mainnet
const EVM_DESTINATION = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
const HATHOR_SENDER = 'HNBUHhzkVuSFUNW21HrajUFNUiX8JrcVwR'

function setup(overrides: Record<string, unknown> = {}) {
  // Parameters are declared so that mock.calls stays typed at the call index.
  const sendBridgeTransfer = vi.fn(async (_params: unknown, _deployment: unknown) => ({
    hash: 'a'.repeat(64),
  }))
  const stored: { address: string; network: string; record: StoredTransfer }[] = []

  const deps = {
    wallet: {
      sendBridgeTransfer,
      getAddress: () => HATHOR_SENDER,
      isConnected: () => true,
      connect: async () => ({ address: HATHOR_SENDER }),
      disconnect: async () => {},
      restore: async () => null,
      getBalance: async () => ({ available: 0, locked: 0 }),
    },
    history: {
      upsertHathorTransfer: (address: string, network: string, record: StoredTransfer) =>
        stored.push({ address, network, record }),
      addEvmTransfer: () => {},
      list: () => [],
      isAvailable: () => true,
    },
    tokens: [AHTR, USDC, NOT_BRIDGEABLE],
    route: ROUTE,
    deployment: 'mainnet',
    ...overrides,
  }

  return { sendBridgeTransfer, stored, sendHathorTransfer: createSendHathorTransfer(deps as never) }
}

const request = (overrides: Record<string, string> = {}) => ({
  tokenKey: 'aHTR',
  amount: '2',
  evmDestination: EVM_DESTINATION,
  ...overrides,
})

describe('sendHathorTransfer', () => {
  it('sends to the bridge deposit address, at the token Hathor precision', async () => {
    const { sendBridgeTransfer, sendHathorTransfer } = setup()

    await sendHathorTransfer(request({ amount: '2' }))

    expect(sendBridgeTransfer).toHaveBeenCalledWith(
      {
        bridgeAddress: ROUTE.hathor.bridgeHathorAddress,
        tokenUid: AHTR.hathor.pureHtrAddress,
        // 2 HTR at 2 decimals.
        amountUnits: '200',
        evmDestination: EVM_DESTINATION,
      },
      'mainnet',
    )
  })

  it('truncates past the token precision instead of rounding up', async () => {
    const { sendBridgeTransfer, sendHathorTransfer } = setup()

    await sendHathorTransfer(request({ amount: '2.999' }))

    // The float version sent 3.00 HTR — more than the user asked for.
    expect(sendBridgeTransfer.mock.calls[0]![0]).toMatchObject({ amountUnits: '299' })
  })

  it('normalises a leading-zero amount the way the wallet expects', async () => {
    const { sendBridgeTransfer, sendHathorTransfer } = setup()

    await sendHathorTransfer(request({ amount: '0.5' }))

    expect(sendBridgeTransfer.mock.calls[0]![0]).toMatchObject({ amountUnits: '50' })
  })

  it('uses each token own Hathor precision, not a shared constant', async () => {
    const { sendBridgeTransfer, sendHathorTransfer } = setup()

    await sendHathorTransfer(request({ tokenKey: 'USDC', amount: '1.5' }))

    expect(sendBridgeTransfer.mock.calls[0]![0]).toMatchObject({
      tokenUid: USDC.hathor.pureHtrAddress,
      // 2 decimals on Hathor, even though USDC has 6 on Arbitrum.
      amountUnits: '150',
    })
  })

  it('records the transfer against the EVM destination and the Hathor network', async () => {
    const { stored, sendHathorTransfer } = setup()

    await sendHathorTransfer(request())

    expect(stored).toHaveLength(1)
    expect(stored[0]!.address).toBe(EVM_DESTINATION)
    expect(stored[0]!.network).toBe(ROUTE.hathor.name)
  })

  it('stores the raw amount and its scale, not a formatted string', async () => {
    const { stored, sendHathorTransfer } = setup()

    await sendHathorTransfer(request({ amount: '2' }))

    expect(stored[0]!.record).toMatchObject({
      amount: '200',
      amountDecimals: 2,
      tokenDecimals: 2,
    })
  })

  it('records the Hathor sender and tx id, which the API cannot report', async () => {
    const { stored, sendHathorTransfer } = setup()

    const result = await sendHathorTransfer(request())

    expect(result.hathorTxId).toBe('a'.repeat(64))
    expect(stored[0]!.record).toMatchObject({
      hathorTxId: 'a'.repeat(64),
      displayedTxHash: 'a'.repeat(64),
      sender: HATHOR_SENDER,
      status: TransferStatus.HathorVoting,
      votes: 0,
      signatures: 0,
      blockNumber: null,
    })
  })

  it('labels the row with the EVM symbol, since that is the side it arrives on', async () => {
    const { stored, sendHathorTransfer } = setup()

    await sendHathorTransfer(request({ tokenKey: 'USDC' }))

    expect(stored[0]!.record['token']).toBe('USDC')
  })

  it('refuses a token that is not bridgeable from Hathor here', async () => {
    const { sendBridgeTransfer, sendHathorTransfer } = setup()

    await expect(sendHathorTransfer(request({ tokenKey: 'SLT7' }))).rejects.toThrow(
      'Selected token is not available on Hathor.',
    )
    await expect(sendHathorTransfer(request({ tokenKey: '' }))).rejects.toThrow(
      'Please select a token.',
    )
    expect(sendBridgeTransfer).not.toHaveBeenCalled()
  })

  it('refuses a non-positive or unparseable amount', async () => {
    const { sendHathorTransfer } = setup()

    for (const amount of ['', '0', '-1', 'abc']) {
      await expect(sendHathorTransfer(request({ amount }))).rejects.toThrow('Enter a valid amount.')
    }
  })

  it('refuses an EVM destination that is not an address', async () => {
    const { sendHathorTransfer } = setup()

    await expect(sendHathorTransfer(request({ evmDestination: '0x123' }))).rejects.toThrow(
      'Enter a valid Arbitrum address (0x...)',
    )
  })

  it('accepts a destination with surrounding whitespace, and sends it trimmed', async () => {
    const { sendBridgeTransfer, sendHathorTransfer } = setup()

    await sendHathorTransfer(request({ evmDestination: `  ${EVM_DESTINATION}  ` }))

    expect(sendBridgeTransfer.mock.calls[0]![0]).toMatchObject({
      evmDestination: EVM_DESTINATION,
    })
  })

  it('refuses to send when the deposit address is not configured', async () => {
    const { sendBridgeTransfer, sendHathorTransfer } = setup({
      route: {
        ...ROUTE,
        hathor: { ...ROUTE.hathor, bridgeHathorAddress: 'HATHOR_BRIDGE_ADDRESS_HERE' },
      },
    })

    await expect(sendHathorTransfer(request())).rejects.toThrow(
      'Bridge Hathor deposit address is not configured.',
    )
    expect(sendBridgeTransfer).not.toHaveBeenCalled()
  })

  it('does not record anything when the wallet returns no transaction id', async () => {
    const { stored, sendHathorTransfer } = setup({
      wallet: {
        sendBridgeTransfer: async () => ({ hash: '' }),
        getAddress: () => HATHOR_SENDER,
      },
    })

    await expect(sendHathorTransfer(request())).rejects.toThrow(
      'Transaction sent but wallet returned no response',
    )
    expect(stored).toHaveLength(0)
  })
})
