import { describe, it, expect } from 'vitest'
import { confirmationProgress } from './confirmations'

// Arbitrum One: 120 confirmations at 0.25s per block.
const arbitrum = { required: 120, secondsPerBlock: 0.25 }

describe('confirmationProgress', () => {
  it('marks a transaction confirmed once enough blocks elapsed', () => {
    const p = confirmationProgress({ transactionBlock: 900, currentBlock: 1100, ...arbitrum })
    expect(p.confirmed).toBe(true)
    expect(p.humanTimeRemaining).toBe('')
  })

  it('treats exactly the required count as confirmed', () => {
    const p = confirmationProgress({ transactionBlock: 900, currentBlock: 1020, ...arbitrum })
    expect(p.elapsedBlocks).toBe(120)
    expect(p.confirmed).toBe(true)
  })

  it('renders a sub-hour ETA without an hours part', () => {
    const p = confirmationProgress({ transactionBlock: 900, currentBlock: 1000, ...arbitrum })
    expect(p.remainingBlocks).toBe(20)
    // The double space is the original template's; kept so rows do not change.
    expect(p.humanTimeRemaining).toBe('| ~  1mins')
  })

  it('renders an hours part when over an hour out', () => {
    const p = confirmationProgress({
      transactionBlock: 0,
      currentBlock: 0,
      required: 500,
      secondsPerBlock: 15,
    })
    // 500 * 15 = 7500s = 2h 5m
    expect(p.humanTimeRemaining).toBe('| ~ 2hs  5mins')
  })

  it('clamps the ETA at zero once the remaining count goes negative', () => {
    const p = confirmationProgress({ transactionBlock: 100, currentBlock: 100000, ...arbitrum })
    expect(p.remainingBlocks).toBeLessThan(0)
    expect(p.confirmed).toBe(true)
    expect(p.humanTimeRemaining).toBe('')
  })

  it('handles a transaction in a block ahead of the poller', () => {
    // The poller can lag the wallet by a block right after a send.
    const p = confirmationProgress({ transactionBlock: 1010, currentBlock: 1000, ...arbitrum })
    expect(p.elapsedBlocks).toBe(-10)
    expect(p.confirmed).toBe(false)
  })
})
