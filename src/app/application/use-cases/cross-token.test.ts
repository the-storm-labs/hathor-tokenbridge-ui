import { describe, it, expect, vi } from 'vitest'
import BigNumber from 'bignumber.js'
import { createCrossToken } from './cross-token'
import { TransactionFailedError } from './confirm-transaction'
import { ROUTES } from '../../config/networks'
import { findToken } from '../../config/tokens'
import type { EvmChainPort, EvmReceipt } from '../../ports/driven/evm-chain.port'
import type { StoredTransfer } from '../../ports/driven/transfer-history.port'

const ROUTE = ROUTES.mainnet
const USDC = findToken('mainnet', 'USDC')!
const ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'
const HATHOR_ADDRESS = 'HNBUHhzkVuSFUNW21HrajUFNUiX8JrcVwR'

const FEE = { feePercentage: 20, feePercentageDivider: 10_000 }

const fromWei = (value: string) => new BigNumber(value).shiftedBy(-18).toFixed()
const wei = (whole: number) => new BigNumber(whole).shiftedBy(18).toFixed(0)
/** USDC has 6 decimals on Arbitrum. */
const usdc = (whole: number) => new BigNumber(whole).shiftedBy(6).toFixed(0)

const mined = (overrides: Partial<EvmReceipt> = {}): EvmReceipt => ({
  status: true,
  transactionHash: '0xcrossed',
  blockNumber: 4321,
  ...overrides,
})

function setup(overrides: Record<string, unknown> = {}) {
  const receiveTokensTo = vi.fn(async () => '0xcrossed')
  const stored: { address: string; network: string; record: StoredTransfer }[] = []
  const chain: EvmChainPort = {
    getBlockNumber: async () => 4321,
    getGasPriceInputs: async () => ({ averageGasPrice: '1000000000' }),
    waitForReceipt: async (hash) => mined({ transactionHash: hash }),
  }

  const deps = {
    erc20: { balanceOf: async () => usdc(1_000), allowance: async () => '0', approve: async () => '' },
    bridge: { receiveTokensTo },
    allowTokens: { calcMaxWithdraw: async () => wei(10_000) },
    chain,
    history: {
      addEvmTransfer: (address: string, network: string, record: StoredTransfer) =>
        stored.push({ address, network, record }),
      upsertHathorTransfer: () => {},
      list: () => [],
      isAvailable: () => true,
    },
    tokens: [USDC],
    route: ROUTE,
    resolveGasPrice: async () => '0x4d7c6d00',
    getFee: () => FEE,
    getAccount: () => ACCOUNT,
    isValidHathorAddress: (address: string) => address.startsWith('H'),
    fromWei,
    ...overrides,
  }

  return { receiveTokensTo, stored, crossToken: createCrossToken(deps as never) }
}

const request = (overrides: Partial<Parameters<ReturnType<typeof createCrossToken>>[0]> = {}) => ({
  tokenKey: 'USDC',
  amount: '10',
  hathorAddress: HATHOR_ADDRESS,
  ...overrides,
})

describe('crossToken', () => {
  it('sends the amount grossed up by the bridge fee, at the token EVM precision', async () => {
    const { receiveTokensTo, crossToken } = setup()

    await crossToken(request({ amount: '10' }))

    // 10 USDC = 10000000 base units; + 0.2% fee = 10020040 (truncated).
    expect(receiveTokensTo).toHaveBeenCalledWith(
      {
        destinationChainId: 31,
        tokenAddress: USDC.evm!.address,
        to: HATHOR_ADDRESS,
        amount: '10020040',
      },
      ACCOUNT,
      '0x4d7c6d00',
    )
  })

  it('records the transfer under the EVM network, with the amount as typed', async () => {
    const { stored, crossToken } = setup()

    await crossToken(request({ amount: '10' }))

    expect(stored).toHaveLength(1)
    expect(stored[0]!.address).toBe(ACCOUNT)
    expect(stored[0]!.network).toBe(ROUTE.evm.name)
    expect(stored[0]!.record).toMatchObject({
      networkId: 42161,
      tokenFrom: 'USDC',
      tokenTo: 'hUSDC',
      amount: '10',
      transactionHash: '0xcrossed',
      blockNumber: 4321,
    })
  })

  it('does not store the receipt boolean under the API status field', async () => {
    const { stored, crossToken } = setup()

    await crossToken(request())

    expect(stored[0]!.record['status']).toBeUndefined()
  })

  it('returns what the user will receive, in the symbol it arrives as', async () => {
    const { crossToken } = setup()

    expect((await crossToken(request({ amount: '10' }))).receives).toBe('10 hUSDC')
  })

  it('rejects an amount above the balance, reporting it in whole tokens', async () => {
    const { receiveTokensTo, crossToken } = setup({
      erc20: { balanceOf: async () => usdc(5), allowance: async () => '0', approve: async () => '' },
    })

    await expect(crossToken(request({ amount: '10' }))).rejects.toThrow(
      'Insuficient Balance in your account, your current balance is 5 USDC',
    )
    expect(receiveTokensTo).not.toHaveBeenCalled()
  })

  it('allows an amount exactly equal to the balance', async () => {
    // The gross-up means "all of it" needs slightly more than the amount typed,
    // so the boundary is the grossed-up value, not the input.
    const { receiveTokensTo, crossToken } = setup({
      erc20: {
        balanceOf: async () => '10020040',
        allowance: async () => '0',
        approve: async () => '',
      },
    })

    await crossToken(request({ amount: '10' }))

    expect(receiveTokensTo).toHaveBeenCalled()
  })

  it('rejects an amount above the daily limit left', async () => {
    const { receiveTokensTo, crossToken } = setup({
      allowTokens: { calcMaxWithdraw: async () => wei(4) },
    })

    await expect(crossToken(request({ amount: '10' }))).rejects.toThrow(
      'Amount bigger than the daily limit. Daily limit left 4 tokens',
    )
    expect(receiveTokensTo).not.toHaveBeenCalled()
  })

  it('compares the daily limit in whole tokens, not base units', async () => {
    // The limit is 18-decimal scaled and the amount is 6-decimal: comparing them
    // raw made this check unreachable for USDC, so an over-limit transfer went to
    // the contract and reverted. 100 USDC against a 50-token limit must fail.
    const { crossToken } = setup({
      erc20: {
        balanceOf: async () => usdc(1_000_000),
        allowance: async () => '0',
        approve: async () => '',
      },
      allowTokens: { calcMaxWithdraw: async () => wei(50) },
    })

    await expect(crossToken(request({ amount: '100' }))).rejects.toThrow(/daily limit/)
  })

  it('accepts an amount within the daily limit', async () => {
    const { receiveTokensTo, crossToken } = setup({
      allowTokens: { calcMaxWithdraw: async () => wei(50) },
    })

    await crossToken(request({ amount: '10' }))

    expect(receiveTokensTo).toHaveBeenCalled()
  })

  it('refuses an invalid or missing Hathor destination before spending gas', async () => {
    const { receiveTokensTo, crossToken } = setup()

    await expect(crossToken(request({ hathorAddress: '' }))).rejects.toThrow(
      'Inform the hathor address!',
    )
    await expect(crossToken(request({ hathorAddress: 'Wtestnetaddress' }))).rejects.toThrow(
      'Invalid Hathor address!',
    )
    expect(receiveTokensTo).not.toHaveBeenCalled()
  })

  it('refuses without a wallet, without a token and without an amount', async () => {
    await expect(setup({ getAccount: () => '' }).crossToken(request())).rejects.toThrow(
      'Connect your wallet!',
    )
    await expect(setup().crossToken(request({ tokenKey: 'NOPE' }))).rejects.toThrow(
      'Choose a token to cross',
    )
    await expect(setup().crossToken(request({ amount: '' }))).rejects.toThrow(
      'Complete the Amount field',
    )
  })

  it('does not record a transfer whose transaction reverted', async () => {
    const { stored, crossToken } = setup({
      chain: {
        getBlockNumber: async () => 4321,
        getGasPriceInputs: async () => ({ averageGasPrice: '1000000000' }),
        waitForReceipt: async (hash: string) => mined({ transactionHash: hash, status: false }),
      },
    })

    await expect(crossToken(request())).rejects.toThrow(TransactionFailedError)
    expect(stored).toHaveLength(0)
  })
})
