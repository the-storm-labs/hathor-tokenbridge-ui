import { describe, it, expect } from 'vitest'
import { evmToHathorStage, type FederationProgress } from './evm-to-hathor-progress'
import type { ConfirmationProgress } from './confirmations'

const confirming: ConfirmationProgress = {
  elapsedBlocks: 100,
  remainingBlocks: 800,
  confirmed: false,
  humanTimeRemaining: '| ~  4mins',
}
const confirmed: ConfirmationProgress = {
  elapsedBlocks: 900,
  remainingBlocks: 0,
  confirmed: true,
  humanTimeRemaining: '',
}

const federation = (overrides: Partial<FederationProgress> = {}): FederationProgress => ({
  signatures: 0,
  hathorFederationStatus: null,
  delivered: false,
  deliveryTxId: null,
  ...overrides,
})

describe('evmToHathorStage', () => {
  it('counts down the Arbitrum confirmations first', () => {
    expect(evmToHathorStage(confirming, null, 4)).toEqual({
      kind: 'confirming',
      humanTimeRemaining: '| ~  4mins',
    })
  })

  it('waits for the federation once confirmed, with or without the API', () => {
    expect(evmToHathorStage(confirmed, null, 4)).toEqual({ kind: 'awaiting-federation' })
    // A Cross-only row: indexed, but no Hathor event yet.
    expect(evmToHathorStage(confirmed, federation(), 4)).toEqual({ kind: 'awaiting-federation' })
  })

  it('shows the signatures collected while the federation signs', () => {
    expect(
      evmToHathorStage(
        confirmed,
        federation({ hathorFederationStatus: 'ProposalSigned', signatures: 2 }),
        4,
      ),
    ).toEqual({ kind: 'signing', signatures: 2, required: 4 })
  })

  it('trusts federation activity over a lagging local block count', () => {
    const stage = evmToHathorStage(
      confirming,
      federation({ hathorFederationStatus: 'TransactionProposed' }),
      4,
    )
    expect(stage.kind).toBe('signing')
  })

  it('caps the count at the threshold', () => {
    const stage = evmToHathorStage(
      confirmed,
      federation({ hathorFederationStatus: 'ProposalSent', signatures: 6 }),
      4,
    )
    expect(stage).toEqual({ kind: 'signing', signatures: 4, required: 4 })
  })

  it('reports a failed Hathor push as delayed', () => {
    expect(
      evmToHathorStage(
        confirmed,
        federation({ hathorFederationStatus: 'TransactionFailed', signatures: 0 }),
        4,
      ),
    ).toEqual({ kind: 'delayed' })
  })

  it('goes back to signing once the federation re-proposes after a failure', () => {
    const stage = evmToHathorStage(
      confirmed,
      federation({ hathorFederationStatus: 'ProposalSigned', signatures: 1 }),
      4,
    )
    expect(stage.kind).toBe('signing')
  })

  it('is delivered once the Hathor transaction went out, with its id', () => {
    expect(
      evmToHathorStage(
        confirmed,
        federation({
          hathorFederationStatus: 'ProposalSent',
          signatures: 4,
          delivered: true,
          deliveryTxId: '00bf68c9',
        }),
        4,
      ),
    ).toEqual({ kind: 'delivered', hathorTxId: '00bf68c9' })
  })
})
