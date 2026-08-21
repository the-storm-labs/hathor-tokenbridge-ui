import type { SchedulerPort } from '../../../ports/driven/scheduler.port'

/**
 * Transfer feedback as dismissable toasts in the corner of the page.
 *
 * These messages used to be alert blocks inside the transfer form, which had two
 * problems beyond the styling: they sat below the fold on a long form, and they
 * lived inside the direction-specific form, so switching direction hid the
 * outcome of what you had just done.
 *
 * A toast auto-hides, and the timer is the whole reason this is a class rather
 * than two DOM calls: showing the same toast again has to *restart* its timer,
 * and hiding it has to cancel the pending one. Without that bookkeeping a second
 * message inherits the first one's countdown and vanishes early.
 */

/** How long a toast stays up. Long, because these report money movements. */
export const TOAST_TIMEOUT_MS = 12_000

/** The DOM operations a toast needs — kept this narrow so this is testable. */
export interface ToastElement {
  setVisible(visible: boolean): void
}

export interface ToastsDeps {
  /** Resolves a toast by id, or null if this page does not have it. */
  readonly find: (id: string) => ToastElement | null
  readonly scheduler: SchedulerPort
  readonly timeoutMs?: number
}

export class Toasts {
  private readonly pending = new Map<string, () => void>()
  private readonly timeoutMs: number

  constructor(private readonly deps: ToastsDeps) {
    this.timeoutMs = deps.timeoutMs ?? TOAST_TIMEOUT_MS
  }

  /**
   * Shows a toast and (re)starts its dismissal timer.
   *
   * @param options.autoDismiss Pass false for a message that describes something
   *        still in progress. Those have no natural duration — a Hathor
   *        confirmation waits for the user to open their wallet, which can take
   *        minutes — so they stay until the caller hides them. The close button
   *        still works.
   */
  show(id: string, options: { readonly autoDismiss?: boolean } = {}): void {
    const element = this.deps.find(id)
    if (!element) return

    // Always cancel first: a toast previously shown with a timer must not keep
    // that timer when it is shown again as a sticky one.
    this.cancel(id)
    element.setVisible(true)

    if (options.autoDismiss === false) return

    this.pending.set(
      id,
      this.deps.scheduler.after(this.timeoutMs, () => {
        this.pending.delete(id)
        element.setVisible(false)
      }),
    )
  }

  /** Hides a toast now, whether the timer has fired or not. */
  hide(id: string): void {
    this.cancel(id)
    this.deps.find(id)?.setVisible(false)
  }

  private cancel(id: string): void {
    const dispose = this.pending.get(id)
    if (!dispose) return

    dispose()
    this.pending.delete(id)
  }
}

/** The ids of the toasts, so no call site spells one wrong. */
export const TOAST = {
  transferSuccess: 'success',
  transferError: 'alert-danger',
  /** Sticky: the Hathor wallet does not notify, so this one waits for the user. */
  hathorSendPending: 'htrSendPending',
  hathorSendSuccess: 'htrSendSuccess',
  hathorSendError: 'htrSendError',
  /** A seven-day session ran out, or the wallet ended it from its own side. */
  hathorSessionExpired: 'htrSessionExpired',
} as const

/**
 * Binds {@link Toasts} to the page: resolves ids through the DOM and wires the
 * close buttons.
 *
 * The dismissal is delegated from the container and toggles a class rather than
 * using Bootstrap's `data-dismiss="alert"`, which *removes* the element — after
 * one dismissal the next transfer would have nothing left to report into.
 */
export function bindToasts(root: Document, scheduler: SchedulerPort): Toasts {
  const toasts = new Toasts({
    scheduler,
    find: (id) => {
      const element = root.getElementById(id)
      if (!element) return null

      // Display only: the entrance animation is CSS, restarted by the switch
      // out of display:none. Nothing here has to wait for a frame, so a toast is
      // never left invisible-but-displayed.
      return { setVisible: (visible) => void (element.style.display = visible ? 'block' : 'none') }
    },
  })

  root.getElementById('toastArea')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    const button = target?.closest('[data-toast-dismiss]')
    const toast = button?.closest('.toast-item')

    if (toast?.id) toasts.hide(toast.id)
  })

  return toasts
}
