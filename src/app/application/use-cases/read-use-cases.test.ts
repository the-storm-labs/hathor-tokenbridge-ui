import { describe, it, expect, vi } from 'vitest'
import BigNumber from 'bignumber.js'
import { createLoadBridgeParameters, formatFeeRate } from './load-bridge-parameters'
import { createWatchBlockNumber } from './watch-block-number'
import {
  createCheckAllowance,
  createGetMaxTransferable,
  createRefreshHathorBalance,
} from './token-balances'
import { findToken } from '../../config/tokens'
import type { SchedulerPort } from '../../ports/driven/scheduler.port'
import type { EvmChainPort } from '../../ports/driven/evm-chain.port'

const USDC = findToken('mainnet', 'USDC')!
const AHTR = findToken('mainnet', 'aHTR')!
const SLT7 = findToken('mainnet', 'SLT7')! // not on mainnet EVM

/** web3's fromWei, for the values these tests use. */
const fromWei = (value: string) => new BigNumber(value).shiftedBy(-18).toFixed()

describe('loadBridgeParameters', () => {
  const askedFor: string[] = []
  const deps = {
    bridge: { getFeePercentage: async () => '20' },
    allowTokens: {
      getInfoAndLimits: async (tokenAddress: string) => {
        askedFor.push(tokenAddress)
        return {
          min: '1000000000000000000',
          max: '100000000000000000000000',
          daily: '1000000000000000000000000',
        }
      },
    },
    federation: { getMembers: async () => ['a', 'b', 'c', 'd', 'e'] },
    feePercentageDivider: 10_000,
    fromWei,
  }

  it('converts the contract limits to whole tokens', async () => {
    const params = await createLoadBridgeParameters(deps as never)(USDC.evm!.address)
    expect(params.minTokensAllowed).toBe(1)
    expect(params.maxTokensAllowed).toBe(100_000)
    expect(params.maxDailyLimit).toBe(1_000_000)
  })

  it('reads the limits of the token it was asked about', async () => {
    // They are configured per token on the contract, so this is not a
    // page-level constant: it changes with the dropdown.
    askedFor.length = 0
    await createLoadBridgeParameters(deps as never)(AHTR.evm!.address)
    expect(askedFor).toEqual([AHTR.evm!.address])
  })

  it('derives the fractional fee rate from the basis points', async () => {
    const params = await createLoadBridgeParameters(deps as never)(USDC.evm!.address)
    expect(params.feePercentage).toBe(20)
    expect(params.feeRate).toBe(0.002)
  })

  it('reports a simple majority of federators as required', async () => {
    const params = await createLoadBridgeParameters(deps as never)(USDC.evm!.address)
    expect(params.federatorCount).toBe(5)
    expect(params.federatorsRequired).toBe(3)
  })

  it('rounds the requirement the way the original did', async () => {
    const withFour = { ...deps, federation: { getMembers: async () => ['a', 'b', 'c', 'd'] } }
    const params = await createLoadBridgeParameters(withFour as never)(USDC.evm!.address)
    expect(params.federatorsRequired).toBe(3)
  })
})

describe('formatFeeRate', () => {
  it('renders the rate as a percentage', () => {
    expect(formatFeeRate(0.002)).toBe('0.20%')
    expect(formatFeeRate(0)).toBe('0.00%')
  })
})

describe('watchBlockNumber', () => {
  function manualScheduler() {
    const tasks = new Set<() => void>()
    const scheduler: SchedulerPort = {
      every: (_ms, task) => {
        tasks.add(task)
        return () => tasks.delete(task)
      },
      after: (_ms, task) => {
        tasks.add(task)
        return () => tasks.delete(task)
      },
      now: () => 0,
    }
    return {
      scheduler,
      active: () => tasks.size,
      async tick() {
        // oxlint-disable-next-line no-useless-spread -- a task may cancel itself
        for (const task of [...tasks]) task()
        await Promise.resolve()
        await Promise.resolve()
      },
    }
  }

  const chainAt = (...blocks: number[]): EvmChainPort => {
    let i = 0
    return {
      getBlockNumber: async () => blocks[Math.min(i++, blocks.length - 1)]!,
      getGasPriceInputs: async () => ({ averageGasPrice: '1' }),
      waitForReceipt: async () => ({ status: true, transactionHash: '0x', blockNumber: 1 }),
    }
  }

  it('reports the first block immediately, without waiting for a tick', async () => {
    const clock = manualScheduler()
    const seen: number[] = []
    createWatchBlockNumber({ chain: chainAt(100), scheduler: clock.scheduler })((b) => seen.push(b))

    await Promise.resolve()
    await Promise.resolve()
    expect(seen).toEqual([100])
  })

  it('does not report the same block twice', async () => {
    const clock = manualScheduler()
    const seen: number[] = []
    createWatchBlockNumber({ chain: chainAt(100, 100, 101), scheduler: clock.scheduler })((b) =>
      seen.push(b),
    )

    await Promise.resolve()
    await Promise.resolve()
    await clock.tick()
    await clock.tick()

    expect(seen).toEqual([100, 101])
  })

  it('stops when disposed', async () => {
    const clock = manualScheduler()
    const seen: number[] = []
    const stop = createWatchBlockNumber({
      chain: chainAt(100, 101, 102),
      scheduler: clock.scheduler,
    })((b) => seen.push(b))

    await Promise.resolve()
    await Promise.resolve()
    stop()
    await clock.tick()

    expect(clock.active()).toBe(0)
    expect(seen).toEqual([100])
  })

  it('keeps polling after a transient RPC failure', async () => {
    const clock = manualScheduler()
    let calls = 0
    const chain = {
      getBlockNumber: async () => {
        if (++calls === 1) throw new Error('rpc down')
        return 200
      },
    } as EvmChainPort

    const seen: number[] = []
    createWatchBlockNumber({ chain, scheduler: clock.scheduler })((b) => seen.push(b))
    await Promise.resolve()
    await Promise.resolve()
    await clock.tick()

    expect(seen).toEqual([200])
  })
})

describe('refreshHathorBalance', () => {
  it('formats the balance at the token precision', async () => {
    const wallet = { getBalance: async () => ({ available: 250, locked: 0 }) }
    const refresh = createRefreshHathorBalance({ wallet: wallet as never, deployment: 'mainnet' })

    expect(await refresh(AHTR)).toBe('2.50')
  })

  it('returns zero for a token not bridgeable on Hathor, without calling the wallet', async () => {
    const getBalance = vi.fn()
    const refresh = createRefreshHathorBalance({
      wallet: { getBalance } as never,
      deployment: 'mainnet',
    })

    expect(await refresh(SLT7)).toBe('0')
    expect(getBalance).not.toHaveBeenCalled()
  })
})

describe('getMaxTransferable', () => {
  const deps = (balance: string, maxWithdraw: string) => ({
    erc20: { balanceOf: async () => balance } as never,
    allowTokens: { calcMaxWithdraw: async () => maxWithdraw } as never,
    fromWei,
  })

  it('caps at the bridge withdraw limit', async () => {
    // balance 100 USDC (6 dec), cap 50
    const max = createGetMaxTransferable(deps('100000000', '50000000000000000000'))
    expect(await max(USDC, '0xowner', 0.002)).toBe('49.900000')
  })

  it('uses the balance when it is the lower of the two', async () => {
    const max = createGetMaxTransferable(deps('10000000', '1000000000000000000000'))
    expect(await max(USDC, '0xowner', 0)).toBe('10.000000')
  })

  it('returns zero for a token absent from this EVM chain', async () => {
    const max = createGetMaxTransferable(deps('1', '1'))
    expect(await max(SLT7, '0xowner', 0)).toBe('0')
  })
})

describe('checkAllowance', () => {
  const check = (allowance: string) =>
    createCheckAllowance({ erc20: { allowance: async () => allowance } as never, fromWei })

  it('approves when the allowance covers the total cost', async () => {
    const result = await check('100000000000000000000')(
      USDC,
      '0xowner',
      '0xbridge',
      new BigNumber('50'),
    )
    expect(result.approved).toBe(true)
  })

  it('rejects when the allowance covers the amount but not the fee', async () => {
    // 100 approved, but 100.2004 leaves the wallet once the fee is added.
    const result = await check('100000000000000000000')(
      USDC,
      '0xowner',
      '0xbridge',
      new BigNumber('100.2004'),
    )
    expect(result.approved).toBe(false)
  })

  it('treats an exactly-equal allowance as sufficient', async () => {
    const result = await check('50000000000000000000')(
      USDC,
      '0xowner',
      '0xbridge',
      new BigNumber('50'),
    )
    expect(result.approved).toBe(true)
  })
})
