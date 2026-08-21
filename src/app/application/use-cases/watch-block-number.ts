import type { EvmChainPort } from '../../ports/driven/evm-chain.port'
import type { SchedulerPort } from '../../ports/driven/scheduler.port'

/**
 * Polls the chain head and reports it.
 *
 * Returns a **disposer** rather than an interval id. The old poller stored its
 * id in a global that claiming had to reach into and clear before submitting,
 * and the receipt waiter never cleared its own on the timeout path — a class of
 * leak that disappears when stopping is a function you are handed.
 */

export const BLOCK_POLL_INTERVAL_MS = 30_000

export interface WatchBlockNumberDeps {
  readonly chain: EvmChainPort
  readonly scheduler: SchedulerPort
  readonly intervalMs?: number
}

export function createWatchBlockNumber(deps: WatchBlockNumberDeps) {
  /**
   * @param onBlock called with each new block number; not called again for the
   *                same one.
   * @returns a disposer that stops polling.
   */
  return function watchBlockNumber(onBlock: (blockNumber: number) => void): () => void {
    let stopped = false
    let last: number | null = null

    const tick = async () => {
      try {
        const blockNumber = await deps.chain.getBlockNumber()
        // A late response after disposal must not resurrect the watcher.
        if (stopped || blockNumber === last) return
        last = blockNumber
        onBlock(blockNumber)
      } catch (error) {
        // A transient RPC failure must not kill the poll; the next tick retries.
        console.error('Error while polling for the latest block number', error)
      }
    }

    void tick()
    const stopInterval = deps.scheduler.every(deps.intervalMs ?? BLOCK_POLL_INTERVAL_MS, () => {
      void tick()
    })

    return () => {
      stopped = true
      stopInterval()
    }
  }
}
