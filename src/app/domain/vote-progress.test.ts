import { describe, it, expect } from 'vitest'
import { approvalProgress } from './vote-progress'

describe('approvalProgress', () => {
  it('counts Hathor signatures during the Hathor phase', () => {
    const p = approvalProgress({ signatures: 2, votes: 4 }, true, 4)
    expect(p.phase).toBe('hathor-signatures')
    expect(p.count).toBe(2)
    expect(p.required).toBe(4)
    expect(p.label).toBe('signature')
    expect(p.title).toBe('Hathor federation signatures')
  })

  it('counts EVM votes after the Hathor phase', () => {
    const p = approvalProgress({ signatures: 4, votes: 3 }, false, 4)
    expect(p.phase).toBe('evm-votes')
    expect(p.count).toBe(3)
    expect(p.required).toBe(4)
    expect(p.label).toBe('vote')
    expect(p.title).toBe('Arbitrum federation votes')
  })

  it('uses the required count the caller passes, not a shared constant', () => {
    // Golf testnet runs a single federator — this used to be a hardcoded 4
    // regardless of which route was asking.
    const p = approvalProgress({ signatures: 1 }, true, 1)
    expect(p.count).toBe(1)
    expect(p.required).toBe(1)
  })

  it('clamps a count above the threshold', () => {
    // The federation can report more signatures than the threshold; the bar
    // must not overflow.
    expect(approvalProgress({ signatures: 9 }, true, 4).count).toBe(4)
  })

  it('treats missing and unparseable counts as zero', () => {
    expect(approvalProgress({}, true, 4).count).toBe(0)
    expect(approvalProgress({ signatures: null }, true, 4).count).toBe(0)
    expect(approvalProgress({ signatures: undefined }, true, 4).count).toBe(0)
    expect(approvalProgress({ votes: 'not-a-number' }, false, 4).count).toBe(0)
  })

  it('accepts numeric strings, which the API sends', () => {
    expect(approvalProgress({ votes: '3' }, false, 4).count).toBe(3)
  })
})
