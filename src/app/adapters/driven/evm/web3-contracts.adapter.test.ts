import { describe, it, expect, vi } from 'vitest'
import { Web3BridgeAdapter } from './web3-contracts.adapter'
import type { ClaimRequest } from '../../../ports/driven/contracts.port'

const BRIDGE = '0xB85573bb0D1403Ed56dDF12540cc57662dfB3351'

/**
 * A stand-in for web3's PromiEvent: a promise that also emits.
 *
 * The write methods resolve on `transactionHash`, so the emitter half is the part
 * that matters — a plain promise here would let the adapter regress to resolving
 * only once the transaction is mined.
 */
function promiEvent(hash: string, receipt: Record<string, unknown>) {
  const promise = Promise.resolve(receipt) as Promise<unknown> & {
    on: (event: string, handler: (value: unknown) => void) => unknown
  }
  promise.on = (event, handler) => {
    if (event === 'transactionHash') handler(hash)
    return promise
  }
  return promise
}

/** Captures the arguments every contract method is called with. */
function web3Spy(returns: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = {}
  const send = vi.fn(() =>
    promiEvent('0xsent', { status: true, transactionHash: '0xsent', blockNumber: 1 }),
  )

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

describe('what a write resolves with', () => {
  it('returns the hash as soon as it exists, without waiting to be mined', async () => {
    // A transaction that is submitted but never mined: the hash is still the
    // answer. Waiting here would hide the hash for as long as the chain takes,
    // and the caller needs it to link to the explorer and to poll.
    const neverMined = () => {
      const promise = new Promise<unknown>(() => {}) as Promise<unknown> & {
        on: (event: string, handler: (value: unknown) => void) => unknown
      }
      promise.on = (event, handler) => {
        if (event === 'transactionHash') handler('0xpending')
        return promise
      }
      return promise
    }

    const web3 = {
      eth: {
        Contract: function () {
          return { methods: new Proxy({}, { get: () => () => ({ send: neverMined }) }) }
        },
      },
    } as unknown as Web3Instance

    const bridge = new Web3BridgeAdapter(() => web3, BRIDGE)

    expect(await bridge.claim(CLAIM, '0xfrom', '0x1')).toBe('0xpending')
  })

  it('rejects when the wallet refuses before producing a hash', async () => {
    const refused = () => {
      const promise = Promise.reject(new Error('User denied transaction signature')) as Promise<
        unknown
      > & { on: (event: string, handler: (value: unknown) => void) => unknown }
      promise.on = () => promise
      return promise
    }

    const web3 = {
      eth: {
        Contract: function () {
          return { methods: new Proxy({}, { get: () => () => ({ send: refused }) }) }
        },
      },
    } as unknown as Web3Instance

    const bridge = new Web3BridgeAdapter(() => web3, BRIDGE)

    await expect(bridge.claim(CLAIM, '0xfrom', '0x1')).rejects.toThrow(/User denied/)
  })
})

describe('provider lifetime', () => {
  it('fails clearly when no provider is connected', async () => {
    const bridge = new Web3BridgeAdapter(() => null, BRIDGE)
    await expect(bridge.getFeePercentage()).rejects.toThrow(/No EVM provider/)
  })
})
