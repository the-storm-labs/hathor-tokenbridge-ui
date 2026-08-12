/**
 * A minimal observable state container.
 *
 * No library: the app needs get, patch and subscribe, and nothing else. Keeping
 * it this small means the interesting behaviour — that a patch which changes
 * nothing does not notify — is visible rather than buried in a dependency.
 */
export interface Store<S> {
  getState(): Readonly<S>
  /** Merges a partial state. Subscribers run only if a value actually changed. */
  patch(changes: Partial<S>): void
  /** @returns an unsubscribe function. */
  subscribe(listener: (state: Readonly<S>) => void): () => void
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = { ...initial }
  const listeners = new Set<(state: Readonly<S>) => void>()

  return {
    getState: () => state,

    patch(changes) {
      // Reference equality is the right test here: state values are either
      // primitives or objects the app replaces wholesale. A no-op patch is
      // common — the poller re-reads the same block number every tick — and
      // notifying on it would re-render the history table for nothing.
      let changed = false
      for (const key of Object.keys(changes) as (keyof S)[]) {
        if (!Object.is(state[key], changes[key])) {
          changed = true
          break
        }
      }
      if (!changed) return

      state = { ...state, ...changes }
      // Copied before iterating: a listener may unsubscribe during dispatch.
      for (const listener of [...listeners]) listener(state)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
