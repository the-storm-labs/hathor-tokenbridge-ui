import { describe, it, expect, vi } from 'vitest'
import { createResolveGasPrice } from './resolve-gas-price'
import { createApproveSpend } from './approve-spend'
import { createClaimTransfer } from './claim-transfer'
import { confirmTransaction, TransactionFailedError } from './confirm-transaction'
import {
  createConnectEvmWallet,
  createForgetEvmWallet,
  createReconnectEvmWallet,
} from './connect-evm-wallet'
import { ROUTES } from '../../config/networks'
import { findToken } from '../../config/tokens'
import type { ClaimRequest } from '../../ports/driven/contracts.port'
import type { EvmChainPort, EvmReceipt } from '../../ports/driven/evm-chain.port'

const ROUTE = ROUTES.mainnet
const USDC = findToken('mainnet', 'USDC')!
const FEE = { feePercentage: 20, feePercentageDivider: 10_000 }
const ACCOUNT = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'

const mined = (overrides: Partial<EvmReceipt> = {}): EvmReceipt => ({
  status: true,
  transactionHash: '0xhash',
  blockNumber: 100,
  ...overrides,
})

/** A chain port that confirms every hash it is given. */
function fakeChain(receipt = mined()): EvmChainPort {
  return {
    getBlockNumber: async () => 100,
    getGasPriceInputs: async () => ({ averageGasPrice: '1000000000' }),
    waitForReceipt: async (hash) => ({ ...receipt, transactionHash: hash }),
  }
}

describe('resolveGasPrice', () => {
  it('applies the chain rule to the inputs the chain reports', async () => {
    const resolve = createResolveGasPrice({
      chain: fakeChain(),
      getChainId: () => 42161,
    })

    // 1 gwei * 1.3 = 1.3 gwei, hex-encoded.
    expect(await resolve()).toBe(`0x${(1.3e9).toString(16)}`)
    expect(await resolve()).toBe('0x4d7c6d00')
  })

  it('reads the chain id per call, so a network switch is priced correctly', async () => {
    let chainId = 42161
    const getGasPriceInputs = vi.fn(async () => ({
      averageGasPrice: '1000000000',
      latestBlockMinimumGasPrice: '1000000000',
    }))
    const resolve = createResolveGasPrice({
      chain: { ...fakeChain(), getGasPriceInputs },
      getChainId: () => chainId,
    })

    await resolve()
    chainId = 31 // RSK: a different multiplier, and a different input
    await resolve()

    expect(getGasPriceInputs).toHaveBeenNthCalledWith(1, 42161)
    expect(getGasPriceInputs).toHaveBeenNthCalledWith(2, 31)
  })
})

describe('confirmTransaction', () => {
  it('returns the receipt of a successful transaction', async () => {
    expect(await confirmTransaction(fakeChain(), ROUTE.evm.explorer, '0xabc')).toMatchObject({
      status: true,
      transactionHash: '0xabc',
    })
  })

  it('reports a revert as a failure with a link to the transaction', async () => {
    const chain = fakeChain(mined({ status: false }))

    await expect(confirmTransaction(chain, 'https://arbiscan.io', '0xabc')).rejects.toThrow(
      TransactionFailedError,
    )
    await expect(confirmTransaction(chain, 'https://arbiscan.io', '0xabc')).rejects.toThrow(
      'Execution failed <a target="_blank" href="https://arbiscan.io/tx/0xabc">see Tx</a>',
    )
  })

  it('keeps the hash reachable without parsing the message', async () => {
    const chain = fakeChain(mined({ status: false }))

    await expect(confirmTransaction(chain, ROUTE.evm.explorer, '0xabc')).rejects.toMatchObject({
      transactionHash: '0xabc',
    })
  })
})

describe('approveSpend', () => {
  function setup(overrides: Record<string, unknown> = {}) {
    const approve = vi.fn(async (..._args: unknown[]) => '0xapproval')
    const deps = {
      erc20: { approve, balanceOf: async () => '0', allowance: async () => '0' },
      chain: fakeChain(),
      tokens: [USDC],
      route: ROUTE,
      resolveGasPrice: async () => '0x4d786380',
      getFee: () => FEE,
      getAccount: () => ACCOUNT,
      ...overrides,
    }
    return { approve, approveSpend: createApproveSpend(deps as never) }
  }

  it('approves the bridge for the amount plus fee and headroom', async () => {
    const { approve, approveSpend } = setup()

    await approveSpend({ tokenKey: 'USDC', amount: '1', unlimited: false })

    // 1 USDC at 6 decimals, grossed up by 0.2% and then by 1%.
    expect(approve).toHaveBeenCalledWith(
      USDC.evm!.address,
      ROUTE.evm.bridge,
      '1012024',
      ACCOUNT,
      '0x4d786380',
    )
  })

  it('approves an effectively unbounded amount when asked to', async () => {
    const { approve, approveSpend } = setup()

    await approveSpend({ tokenKey: 'USDC', amount: '1', unlimited: true })

    expect(approve.mock.calls[0]![2]).toBe('9097271247288400910000000000000000')
  })

  it('waits for the approval to be mined before reporting success', async () => {
    const waitForReceipt = vi.fn(async (hash: string) => mined({ transactionHash: hash }))
    const { approveSpend } = setup({ chain: { ...fakeChain(), waitForReceipt } })

    const receipt = await approveSpend({ tokenKey: 'USDC', amount: '1', unlimited: false })

    expect(waitForReceipt).toHaveBeenCalledWith('0xapproval')
    expect(receipt.status).toBe(true)
  })

  it('fails when the approval reverts', async () => {
    const { approveSpend } = setup({ chain: fakeChain(mined({ status: false })) })

    await expect(approveSpend({ tokenKey: 'USDC', amount: '1', unlimited: false })).rejects.toThrow(
      TransactionFailedError,
    )
  })

  it('refuses without a connected wallet, before touching the chain', async () => {
    const { approve, approveSpend } = setup({ getAccount: () => '' })

    await expect(approveSpend({ tokenKey: 'USDC', amount: '1', unlimited: false })).rejects.toThrow(
      'Connect your wallet!',
    )
    expect(approve).not.toHaveBeenCalled()
  })

  it('refuses an unknown token and an empty amount', async () => {
    const { approveSpend } = setup()

    await expect(approveSpend({ tokenKey: 'NOPE', amount: '1', unlimited: false })).rejects.toThrow(
      'Choose a token to cross',
    )
    await expect(approveSpend({ tokenKey: 'USDC', amount: '', unlimited: false })).rejects.toThrow(
      'Complete the Amount field',
    )
  })

  it('refuses a token this deployment does not have on the EVM side', async () => {
    const notOnMainnet = findToken('mainnet', 'SLT7')!
    const { approveSpend } = setup({ tokens: [notOnMainnet] })

    await expect(approveSpend({ tokenKey: 'SLT7', amount: '1', unlimited: false })).rejects.toThrow(
      'Choose a token to cross',
    )
  })
})

describe('claimTransfer', () => {
  const CLAIM: ClaimRequest = {
    to: ACCOUNT,
    amount: '5000000000000000000',
    blockHash: '0xa'.padEnd(66, 'b'),
    logIndex: 0,
    originChainId: 31,
    destinationChainId: 42161,
  }

  function setup(overrides: Record<string, unknown> = {}) {
    const claim = vi.fn(async () => '0xclaim')
    const deps = {
      bridge: { claim },
      chain: fakeChain(),
      route: ROUTE,
      resolveGasPrice: async () => '0x4d786380',
      getAccount: () => ACCOUNT,
      ...overrides,
    }
    return { claim, claimTransfer: createClaimTransfer(deps as never) }
  }

  it('submits the claim request exactly as the history use case built it', async () => {
    const { claim, claimTransfer } = setup()

    await claimTransfer(CLAIM)

    expect(claim).toHaveBeenCalledWith(CLAIM, ACCOUNT, '0x4d786380')
  })

  it('reports a reverted claim, which the previous code silently accepted', async () => {
    const { claimTransfer } = setup({ chain: fakeChain(mined({ status: false })) })

    await expect(claimTransfer(CLAIM)).rejects.toThrow(TransactionFailedError)
  })

  it('refuses without a connected wallet', async () => {
    const { claim, claimTransfer } = setup({ getAccount: () => '' })

    await expect(claimTransfer(CLAIM)).rejects.toThrow('Connect your wallet!')
    expect(claim).not.toHaveBeenCalled()
  })
})

describe('connecting and reconnecting the EVM wallet', () => {
  const METAMASK = { rdns: 'io.metamask', name: 'MetaMask', icon: 'data:,' }
  const RABBY = { rdns: 'io.rabby', name: 'Rabby', icon: 'data:,' }
  const CONNECTION = { accounts: [ACCOUNT], chainId: 42161, provider: {} }

  function fakePreferences(stored: string | null = null) {
    let value = stored
    return {
      getLastConnectedWallet: () => value,
      setLastConnectedWallet: (rdns: string) => {
        value = rdns
      },
      clearLastConnectedWallet: () => {
        value = null
      },
      getHathorAddress: () => null,
      setHathorAddress: () => {},
      clearHathorAddress: () => {},
    }
  }

  function fakeWallet(available = [METAMASK], connect = vi.fn(async () => CONNECTION)) {
    return {
      discovered: () => available,
      waitForWallets: async () => available,
      connect,
      events: () => null,
    }
  }

  it('remembers the wallet that was connected', async () => {
    const preferences = fakePreferences()
    const connect = createConnectEvmWallet({ wallet: fakeWallet() as never, preferences })

    await connect('io.metamask')

    expect(preferences.getLastConnectedWallet()).toBe('io.metamask')
  })

  it('does not remember a wallet the user refused to connect', async () => {
    const preferences = fakePreferences()
    const rejecting = fakeWallet(
      [METAMASK],
      vi.fn(async () => {
        throw new Error('User rejected the request')
      }) as never,
    )
    const connect = createConnectEvmWallet({ wallet: rejecting as never, preferences })

    await expect(connect('io.metamask')).rejects.toThrow('User rejected')
    expect(preferences.getLastConnectedWallet()).toBeNull()
  })

  it('reconnects the remembered wallet', async () => {
    const wallet = fakeWallet([RABBY, METAMASK])
    const reconnect = createReconnectEvmWallet({
      wallet: wallet as never,
      preferences: fakePreferences('io.metamask'),
    })

    const result = await reconnect()

    expect(result?.wallet).toEqual(METAMASK)
    expect(wallet.connect).toHaveBeenCalledWith('io.metamask')
  })

  it('still reconnects a preference stored by an earlier build, which held the name', async () => {
    const preferences = fakePreferences('MetaMask')
    const wallet = fakeWallet([METAMASK])
    const reconnect = createReconnectEvmWallet({ wallet: wallet as never, preferences })

    const result = await reconnect()

    expect(result?.wallet).toEqual(METAMASK)
    // Migrated, so the next visit matches on the stable id.
    expect(preferences.getLastConnectedWallet()).toBe('io.metamask')
  })

  it('does nothing when there is no remembered wallet', async () => {
    const wallet = fakeWallet()
    const reconnect = createReconnectEvmWallet({
      wallet: wallet as never,
      preferences: fakePreferences(null),
    })

    expect(await reconnect()).toBeNull()
    expect(wallet.connect).not.toHaveBeenCalled()
  })

  it('gives up quietly when the remembered wallet is no longer installed', async () => {
    const reconnect = createReconnectEvmWallet({
      wallet: fakeWallet([RABBY]) as never,
      preferences: fakePreferences('io.metamask'),
    })

    expect(await reconnect()).toBeNull()
  })

  it('never throws when the wallet refuses: page load must not break', async () => {
    const refusing = fakeWallet(
      [METAMASK],
      vi.fn(async () => {
        throw new Error('Already processing eth_requestAccounts')
      }) as never,
    )
    const reconnect = createReconnectEvmWallet({
      wallet: refusing as never,
      preferences: fakePreferences('io.metamask'),
    })

    expect(await reconnect()).toBeNull()
  })

  it('forgetting stops the automatic reconnect', async () => {
    const preferences = fakePreferences('io.metamask')

    createForgetEvmWallet({ preferences })()

    expect(preferences.getLastConnectedWallet()).toBeNull()
  })
})
