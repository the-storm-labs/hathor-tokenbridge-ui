import type { SchedulerPort } from '../../../ports/driven/scheduler.port'

/** Timers backed by the browser. */
export class WindowSchedulerAdapter implements SchedulerPort {
  every(intervalMs: number, task: () => void): () => void {
    const id = setInterval(task, intervalMs)
    return () => clearInterval(id)
  }

  after(delayMs: number, task: () => void): () => void {
    const id = setTimeout(task, delayMs)
    return () => clearTimeout(id)
  }

  now(): number {
    return Date.now()
  }
}
