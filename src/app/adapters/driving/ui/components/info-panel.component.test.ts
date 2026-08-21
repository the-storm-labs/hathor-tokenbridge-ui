// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountInfoPanel } from './info-panel.component'
import { ROUTES } from '../../../../config/networks'
import type { BridgeParameters } from '../../../../application/use-cases/load-bridge-parameters'

const PARAMETERS: BridgeParameters = {
  minTokensAllowed: 1,
  maxTokensAllowed: 100_000,
  maxDailyLimit: 1_000_000,
  feeRate: 0.002,
  feePercentage: 20,
  federatorCount: 5,
  federatorsRequired: 3,
}

const FIELDS = [
  'config-min',
  'config-max',
  'config-to-spend',
  'config-fee',
  'config-federators-count',
  'config-federators-required',
  'config-whitelisted-enabled',
]

const text = (id: string) => document.getElementById(id)?.textContent

beforeEach(() => {
  document.body.innerHTML = FIELDS.map((id) => `<span id="${id}">-</span>`).join('')
})

describe('mountInfoPanel', () => {
  it('shows the crossing period without waiting for a wallet', () => {
    // Route configuration, known at load. setInfoTab wrote it, so it stayed a
    // dash until a token was selected — which needs a connected wallet.
    mountInfoPanel(document, { route: ROUTES.mainnet, loadParameters: vi.fn() })
    expect(text('config-whitelisted-enabled')).toBe('10 minutes')
  })

  it('renders every parameter of the token it is refreshed for', async () => {
    const loadParameters = vi.fn(async () => PARAMETERS)
    const panel = mountInfoPanel(document, { route: ROUTES.mainnet, loadParameters })

    await panel.refresh('0xtoken')

    expect(loadParameters).toHaveBeenCalledWith('0xtoken')
    expect(text('config-min')).toBe('1')
    expect(text('config-max')).toBe('100,000')
    expect(text('config-to-spend')).toBe('1,000,000')
    expect(text('config-fee')).toBe('0.20%')
    expect(text('config-federators-count')).toBe('5')
    expect(text('config-federators-required')).toBe('3')
  })

  it('resolves to null and leaves the panel alone when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const panel = mountInfoPanel(document, {
      route: ROUTES.mainnet,
      loadParameters: async () => {
        throw new Error('rpc down')
      },
    })

    // The token-change handler awaits this; a rejection there would abort the
    // allowance check that follows it.
    await expect(panel.refresh('0xtoken')).resolves.toBeNull()
    expect(text('config-min')).toBe('-')
  })

  it('does not throw on a page that lacks the panel', async () => {
    document.body.innerHTML = ''
    const panel = mountInfoPanel(document, {
      route: ROUTES.mainnet,
      loadParameters: async () => PARAMETERS,
    })
    await expect(panel.refresh('0xtoken')).resolves.toEqual(PARAMETERS)
  })
})
