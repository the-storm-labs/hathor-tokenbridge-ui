/**
 * Timers, behind a port.
 *
 * Two reasons this is not just `setInterval`: polling becomes testable without
 * waiting in real time, and every repeating task returns a disposer instead of
 * an interval id that has to be tracked in a global — the pattern that leaked an
 * interval on the reject path of the old waitForReceipt.
 */
export interface SchedulerPort {
  /** @returns a disposer that stops the repetition. */
  every(intervalMs: number, task: () => void): () => void
  /** @returns a disposer that cancels the pending run. */
  after(delayMs: number, task: () => void): () => void
  /** Milliseconds since the epoch. Injected so time-dependent logic is testable. */
  now(): number
}
