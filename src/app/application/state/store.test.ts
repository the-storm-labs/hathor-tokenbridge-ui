import { describe, it, expect, vi } from 'vitest'
import { createStore } from './store'
import { initialAppState } from './app-state'

describe('createStore', () => {
  it('exposes the initial state', () => {
    const store = createStore({ a: 1, b: 'x' })
    expect(store.getState()).toEqual({ a: 1, b: 'x' })
  })

  it('merges a patch without dropping other keys', () => {
    const store = createStore({ a: 1, b: 'x' })
    store.patch({ a: 2 })
    expect(store.getState()).toEqual({ a: 2, b: 'x' })
  })

  it('notifies subscribers with the new state', () => {
    const store = createStore({ a: 1 })
    const listener = vi.fn()
    store.subscribe(listener)

    store.patch({ a: 2 })
    expect(listener).toHaveBeenCalledWith({ a: 2 })
  })

  it('does not notify when nothing changed', () => {
    // The block-number poller patches the same value every tick; notifying
    // would re-render the history table for nothing.
    const store = createStore({ a: 1 })
    const listener = vi.fn()
    store.subscribe(listener)

    store.patch({ a: 1 })
    store.patch({})
    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies when a new object is assigned, even if it looks equal', () => {
    // Reference equality on purpose: the app replaces lists wholesale, and a
    // deep compare would miss a mutated-then-replaced array.
    const store = createStore<{ items: number[] }>({ items: [] })
    const listener = vi.fn()
    store.subscribe(listener)

    store.patch({ items: [] })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stops notifying after unsubscribe', () => {
    const store = createStore({ a: 1 })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    store.patch({ a: 2 })
    expect(listener).not.toHaveBeenCalled()
  })

  it('tolerates a listener unsubscribing during dispatch', () => {
    const store = createStore({ a: 1 })
    const second = vi.fn()
    const unsubscribeFirst = store.subscribe(() => unsubscribeFirst())
    store.subscribe(second)

    expect(() => store.patch({ a: 2 })).not.toThrow()
    expect(second).toHaveBeenCalledOnce()
  })

  it('does not let callers mutate state through the initial object', () => {
    const initial = { a: 1 }
    const store = createStore(initial)
    initial.a = 99
    expect(store.getState().a).toBe(1)
  })
})

describe('initialAppState', () => {
  it('reproduces the values the globals were initialised with', () => {
    const state = initialAppState()
    expect(state.evmAddress).toBe('')
    expect(state.route).toBeNull()
    expect(state.minTokensAllowed).toBe(1)
    expect(state.maxTokensAllowed).toBe(100_000)
    expect(state.maxDailyLimit).toBe(1_000_000)
    expect(state.feeRate).toBe(0)
    expect(state.feePercentageDivider).toBe(10_000)
    expect(state.hathorToEvmPage).toBe(1)
    expect(state.evmToHathorPage).toBe(1)
    expect(state.blockNumber).toBeNull()
    expect(state.pollingIntervalId).toBeNull()
  })

  it('returns a fresh object each time, so tests cannot leak state', () => {
    expect(initialAppState()).not.toBe(initialAppState())
  })
})
