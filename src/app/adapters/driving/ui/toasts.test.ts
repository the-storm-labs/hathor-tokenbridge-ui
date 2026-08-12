import { describe, it, expect } from 'vitest'
import { Toasts, TOAST_TIMEOUT_MS } from './toasts'
import type { SchedulerPort } from '../../../ports/driven/scheduler.port'

/** A scheduler whose pending tasks fire only when the test says so. */
function fakeScheduler() {
  const tasks: { delayMs: number; task: () => void; cancelled: boolean }[] = []

  const scheduler: SchedulerPort = {
    after: (delayMs, task) => {
      const entry = { delayMs, task, cancelled: false }
      tasks.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    every: () => () => {},
    now: () => 0,
  }

  return {
    scheduler,
    tasks,
    /** Fires every task that has not been cancelled. */
    elapse: () => tasks.filter((t) => !t.cancelled).forEach((t) => t.task()),
    live: () => tasks.filter((t) => !t.cancelled),
  }
}

function fakeToast() {
  const visibility: boolean[] = []
  return {
    element: { setVisible: (visible: boolean) => visibility.push(visible) },
    visibility,
    get visible() {
      return visibility[visibility.length - 1] ?? false
    },
  }
}

function setup(timeoutMs?: number) {
  const timers = fakeScheduler()
  const toast = fakeToast()
  const toasts = new Toasts({
    scheduler: timers.scheduler,
    find: (id) => (id === 'success' ? toast.element : null),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })

  return { toasts, toast, timers }
}

describe('Toasts', () => {
  it('shows a toast and hides it once the timeout elapses', () => {
    const { toasts, toast, timers } = setup()

    toasts.show('success')
    expect(toast.visible).toBe(true)

    timers.elapse()
    expect(toast.visible).toBe(false)
  })

  it('stays up long enough to be read', () => {
    const { toasts, timers } = setup()

    toasts.show('success')

    expect(timers.live()[0]!.delayMs).toBe(TOAST_TIMEOUT_MS)
    expect(TOAST_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000)
  })

  it('restarts the timer when the same toast is shown again', () => {
    const { toasts, toast, timers } = setup()

    toasts.show('success')
    toasts.show('success')

    // Exactly one live timer: the first was cancelled, so the second message
    // gets the full duration instead of inheriting what was left of the first.
    expect(timers.live()).toHaveLength(1)

    timers.elapse()
    expect(toast.visible).toBe(false)
  })

  it('cancels the pending dismissal when hidden early', () => {
    const { toasts, toast, timers } = setup()

    toasts.show('success')
    toasts.hide('success')

    expect(toast.visible).toBe(false)
    expect(timers.live()).toHaveLength(0)
  })

  it('does not reveal a toast again when a stale timer would have fired', () => {
    const { toasts, toast, timers } = setup()

    toasts.show('success')
    toasts.hide('success')
    timers.elapse()

    expect(toast.visible).toBe(false)
  })

  it('can be shown again after being dismissed', () => {
    const { toasts, toast } = setup()

    toasts.show('success')
    toasts.hide('success')
    toasts.show('success')

    expect(toast.visible).toBe(true)
  })

  it('ignores a toast this page does not have, rather than throwing', () => {
    const { toasts } = setup()

    expect(() => toasts.show('nope')).not.toThrow()
    expect(() => toasts.hide('nope')).not.toThrow()
  })

  it('honours an overridden timeout', () => {
    const { toasts, timers } = setup(3_000)

    toasts.show('success')

    expect(timers.live()[0]!.delayMs).toBe(3_000)
  })
})
