import { describe, it, expect, vi } from 'vitest'
import { Web3ChainAdapter } from './web3-chain.adapter'
import type { SchedulerPort } from '../../../ports/driven/scheduler.port'

/** Scheduler that runs pending tasks on demand instead of on a clock. */
function manualScheduler() {
  const tasks = new Set<() => void>()
  const disposed: number[] = []
  let disposeCount = 0

  const scheduler: SchedulerPort = {
    every(_intervalMs, task) {
      tasks.add(task)
      const id = ++disposeCount
      return () => {
        tasks.delete(task)
        disposed.push(id)
      }
    },
    after: (_delayMs, task) => {
      tasks.add(task)
      return () => tasks.delete(task)
    },
    now: () => 0,
  }

  return {
    scheduler,
    disposed,
    activeCount: () => tasks.size,
    async tick() {
      for (const task of [...tasks]) task()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

const web3With = (eth: Partial<Web3Eth>) => () => ({ eth, utils: {} }) as unknown as Web3Instance

describe('getGasPriceInputs', () => {
  it('fetches only the average price off the RSK range', async () => {
    const getGasPrice = vi.fn(async () => '100')
    const getBlock = vi.fn()
    const adapter = new Web3ChainAdapter(
      web3With({ getGasPrice, getBlock } as unknown as Web3Eth),
      manualScheduler().scheduler,
    )

    expect(await adapter.getGasPriceInputs(42161)).toEqual({ averageGasPrice: '100' })
    expect(getBlock).not.toHaveBeenCalled()
  })

  it('fetches only the block minimum on the RSK range', async () => {
    const getGasPrice = vi.fn()
    const getBlock = vi.fn(async () => ({ minimumGasPrice: '59240000', number: 1 }))
    const adapter = new Web3ChainAdapter(
      web3With({ getGasPrice, getBlock } as unknown as Web3Eth),
      manualScheduler().scheduler,
    )

    const inputs = await adapter.getGasPriceInputs(31)
    expect(inputs.latestBlockMinimumGasPrice).toBe('59240000')
    expect(getGasPrice).not.toHaveBeenCalled()
  })
})

describe('waitForReceipt', () => {
  it('resolves once the receipt appears, and stops polling', async () => {
    const clock = manualScheduler()
    let calls = 0
    const getTransactionReceipt = vi.fn(async () =>
      ++calls < 2 ? null : { status: true, transactionHash: '0xabc', blockNumber: 7 },
    )
    const adapter = new Web3ChainAdapter(
      web3With({ getTransactionReceipt } as unknown as Web3Eth),
      clock.scheduler,
    )

    const pending = adapter.waitForReceipt('0xabc')
    await clock.tick()
    expect(clock.activeCount()).toBe(1)
    await clock.tick()

    expect((await pending).blockNumber).toBe(7)
    expect(clock.activeCount()).toBe(0)
  })

  it('stops polling when it times out — the original leaked here', async () => {
    const clock = manualScheduler()
    const adapter = new Web3ChainAdapter(
      web3With({ getTransactionReceipt: async () => null } as unknown as Web3Eth),
      clock.scheduler,
      20_000,
      10_000,
    )

    const pending = adapter.waitForReceipt('0xabc')
    await clock.tick()
    await clock.tick()

    await expect(pending).rejects.toThrow(/not mined in time/)
    expect(clock.activeCount()).toBe(0)
  })

  it('stops polling when the provider errors', async () => {
    const clock = manualScheduler()
    const adapter = new Web3ChainAdapter(
      web3With({
        getTransactionReceipt: async () => {
          throw new Error('provider down')
        },
      } as unknown as Web3Eth),
      clock.scheduler,
    )

    const pending = adapter.waitForReceipt('0xabc')
    await clock.tick()

    await expect(pending).rejects.toThrow('provider down')
    expect(clock.activeCount()).toBe(0)
  })
})

describe('provider lifetime', () => {
  it('reads the current web3 on every call, not a cached one', async () => {
    // web3 is replaced on wallet or network switch; a cached reference would
    // keep talking to the old provider.
    let current: Web3Instance | null = null
    const adapter = new Web3ChainAdapter(() => current, manualScheduler().scheduler)

    await expect(adapter.getBlockNumber()).rejects.toThrow(/No EVM provider/)

    current = { eth: { getBlockNumber: async () => 42 }, utils: {} } as unknown as Web3Instance
    expect(await adapter.getBlockNumber()).toBe(42)
  })
})
