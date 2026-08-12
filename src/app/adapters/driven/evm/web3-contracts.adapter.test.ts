import { describe, it, expect, vi } from 'vitest'
import { Web3BridgeAdapter } from './web3-contracts.adapter'
import type { ClaimRequest } from '../../../ports/driven/contracts.port'

const BRIDGE = '0xB85573bb0D1403Ed56dDF12540cc57662dfB3351'

/** Captures the arguments every contract method is called with. */
function web3Spy(returns: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = {}
  const send = vi.fn(async () => ({ transactionHash: '0xsent' }))

  const web3 = {
    eth: {
      Contract: function (_abi: unknown, _address: string) {
        return {
          methods: new Proxy(
            {},
            {
              get: (_t, name: string) =>
                (...args: unknown[]) => {
                  calls[name] = args
                  return {
                    call: async () => returns[name],
                    send,
                  }
                },
            },
          ),
        }
      },
    },
    utils: {},
  } as unknown as Web3Instance

  return { web3: () => web3, calls, send }
}

const CLAIM: ClaimRequest = {
  to: '0x4359217fD9761AC1308E905c8b596777Efb20a1B',
  amount: '2000000000000000000',
  // keccak256 of the Hathor tx id — there is no EVM block for a Hathor origin.
  blockHash: '0x289a0c69e8ccdb445018b43293ff03609cb05633c2590cb6c7753003f59d24ff',
  logIndex: 129,
  originChainId: 31,
  destinationChainId: 42161,
}

describe('claim data hash — the duplication rule', () => {
  it('passes blockHash in BOTH the blockHash and transactionHash slots', async () => {
    // Verified on-chain against Arbitrum mainnet. Building the hash any other
    // way matches nothing, and every claimed transfer looks unclaimed forever.
    const spy = web3Spy({ getTransactionDataHash: '0xdatahash' })
    const bridge = new Web3BridgeAdapter(spy.web3, BRIDGE)

    await bridge.getTransactionDataHash(CLAIM)

    const args = spy.calls['getTransactionDataHash']!
    expect(args[2]).toBe(CLAIM.blockHash)
    expect(args[3]).toBe(CLAIM.blockHash)
    expect(args).toEqual([
      CLAIM.to,
      CLAIM.amount,
      CLAIM.blockHash,
      CLAIM.blockHash,
      CLAIM.logIndex,
      CLAIM.originChainId,
      CLAIM.destinationChainId,
    ])
  })

  it('passes the data hash twice to isClaimed', async () => {
    const spy = web3Spy({ isClaimed: true })
    const bridge = new Web3BridgeAdapter(spy.web3, BRIDGE)

    expect(await bridge.isClaimed('0xdatahash')).toBe(true)
    expect(spy.calls['isClaimed']).toEqual(['0xdatahash', '0xdatahash'])
  })

  it('duplicates blockHash into transactionHash when submitting a claim', async () => {
    const spy = web3Spy()
    const bridge = new Web3BridgeAdapter(spy.web3, BRIDGE)

    await bridge.claim(CLAIM, '0xfrom', '0x7bfa480')

    const [payload] = spy.calls['claim'] as [Record<string, unknown>]
    expect(payload['blockHash']).toBe(CLAIM.blockHash)
    expect(payload['transactionHash']).toBe(CLAIM.blockHash)
  })

  it('sends with the caller-provided from and gasPrice', async () => {
    const spy = web3Spy()
    const bridge = new Web3BridgeAdapter(spy.web3, BRIDGE)

    await bridge.claim(CLAIM, '0xfrom', '0x7bfa480')
    expect(spy.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: '0xfrom', gasPrice: '0x7bfa480' }),
    )
  })
})

describe('receiveTokensTo', () => {
  it('passes the destination chain, token, receiver and amount in order', async () => {
    const spy = web3Spy()
    const bridge = new Web3BridgeAdapter(spy.web3, BRIDGE)

    await bridge.receiveTokensTo(
      { destinationChainId: 31, tokenAddress: '0xtoken', to: 'Habc', amount: '1230000' },
      '0xfrom',
      '0x1',
    )

    expect(spy.calls['receiveTokensTo']).toEqual([31, '0xtoken', 'Habc', '1230000'])
  })
})

describe('provider lifetime', () => {
  it('fails clearly when no provider is connected', async () => {
    const bridge = new Web3BridgeAdapter(() => null, BRIDGE)
    await expect(bridge.getFeePercentage()).rejects.toThrow(/No EVM provider/)
  })
})
