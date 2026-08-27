import { describe, it, expect } from 'vitest'
import { maxSendableHathorAmount, HATHOR_DATA_OUTPUT_FEE } from './hathor-network-fee'
import type { Token } from './model/token'

const HTR: Token = {
  key: 'aHTR',
  name: 'Hathor Token',
  icon: '',
  evm: { symbol: 'aHTR', address: '0x1', decimals: 18 },
  hathor: { symbol: 'HTR', address: '0x2', hathorAddr: '00', pureHtrAddress: '00', decimals: 2 },
}

const USDC: Token = {
  key: 'USDC',
  name: 'USDC',
  icon: '',
  evm: { symbol: 'USDC', address: '0x1', decimals: 6 },
  hathor: {
    symbol: 'hUSDC',
    address: '0x2',
    hathorAddr: '0xabc',
    pureHtrAddress: 'abc',
    decimals: 2,
  },
}

describe('maxSendableHathorAmount', () => {
  it('reserves the data-output fee out of a native HTR balance', () => {
    expect(maxSendableHathorAmount('24.99', HTR)).toBe('24.98')
  })

  it('truncates rather than rounds, matching every other amount conversion', () => {
    expect(maxSendableHathorAmount('24.995', HTR)).toBe('24.98')
  })

  it('never goes negative when the balance is at or under the fee', () => {
    expect(maxSendableHathorAmount(HATHOR_DATA_OUTPUT_FEE, HTR)).toBe('0')
    expect(maxSendableHathorAmount('0.005', HTR)).toBe('0')
  })

  it('leaves a non-HTR token balance untouched -- its fee comes out of a separate HTR UTXO', () => {
    expect(maxSendableHathorAmount('5', USDC)).toBe('5')
  })
})
