import { describe, it, expect } from 'vitest'
import { approvalProgress, REQUIRED_SIGNATURES_TO_RELAY, REQUIRED_VOTES_TO_CLAIM } from './vote-progress'

describe('approvalProgress', () => {
  it('counts Hathor signatures during the Hathor phase', () => {
    const p = approvalProgress({ signatures: 2, votes: 4 }, true)
    expect(p.phase).toBe('hathor-signatures')
    expect(p.count).toBe(2)
    expect(p.required).toBe(REQUIRED_SIGNATURES_TO_RELAY)
    expect(p.label).toBe('signature')
    expect(p.title).toBe('Hathor federation signatures')
  })

  it('counts EVM votes after the Hathor phase', () => {
    const p = approvalProgress({ signatures: 4, votes: 3 }, false)
    expect(p.phase).toBe('evm-votes')
    expect(p.count).toBe(3)
    expect(p.required).toBe(REQUIRED_VOTES_TO_CLAIM)
    expect(p.label).toBe('vote')
    expect(p.title).toBe('Arbitrum federation votes')
  })

  it('clamps a count above the threshold', () => {
    // The federation can report more signatures than the threshold; the bar
    // must not overflow.
    expect(approvalProgress({ signatures: 9 }, true).count).toBe(4)
  })

  it('treats missing and unparseable counts as zero', () => {
    expect(approvalProgress({}, true).count).toBe(0)
    expect(approvalProgress({ signatures: null }, true).count).toBe(0)
    expect(approvalProgress({ signatures: undefined }, true).count).toBe(0)
    expect(approvalProgress({ votes: 'not-a-number' }, false).count).toBe(0)
  })

  it('accepts numeric strings, which the API sends', () => {
    expect(approvalProgress({ votes: '3' }, false).count).toBe(3)
  })
})
