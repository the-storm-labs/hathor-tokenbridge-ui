import { describe, it, expect } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, type Abi, type Hex } from 'viem'
import { createEvmClients } from './clients'
import { ABIS } from './abis'
import {
  ViemAllowTokensAdapter,
  ViemBridgeAdapter,
  ViemErc20Adapter,
  ViemFederationAdapter,
} from './contracts.adapter'
import type { ClaimRequest } from '../../../ports/driven/contracts.port'

const BRIDGE = '0xB85573bb0D1403Ed56dDF12540cc57662dfB3351'
const TOKEN = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const FROM = '0x4359217fD9761AC1308E905c8b596777Efb20a1B'

/**
 * A fake wallet, at the JSON-RPC boundary.
 *
 * The previous harness stubbed web3's `methods` proxy, which meant the
 * assertions never went through ABI encoding. Here the adapter produces real
 * calldata and the test decodes it, so an argument in the wrong slot — the one
 * failure that makes a claim hash match nothing — cannot pass.
 */
function fakeWallet(results: Record<string, unknown> = {}) {
  const calls: { method: string; params: unknown }[] = []
  const decoded: Record<string, readonly unknown[] | undefined> = {}

  const provider = {
    async request({ method, params }: { method: string; params?: unknown }) {
      calls.push({ method, params })

      if (method === 'eth_call') {
        const [{ data, to }] = params as [{ data: Hex; to: Hex }]
        const abi = abiFor(to)
        const call = decodeFunctionData({ abi, data })
        decoded[call.functionName] = call.args

        if (!(call.functionName in results)) return '0x'
        return encodeFunctionResult({
          abi,
          functionName: call.functionName,
          // The value itself for a single-output function; an array of values
          // for several, which is what getInfoAndLimits returns.
          result: results[call.functionName] as never,
        })
      }

      if (method === 'eth_sendTransaction') {
        const [{ data, to }] = params as [{ data: Hex; to: Hex }]
        const call = decodeFunctionData({ abi: abiFor(to), data })
        decoded[call.functionName] = call.args
        return '0xsent'
      }

      if (method === 'eth_chainId') return '0xa4b1'
      return null
    },
  }

  return { clients: () => createEvmClients(provider), calls, decoded }
}

function abiFor(address: string): Abi {
  const at = address.toLowerCase()
  if (at === BRIDGE.toLowerCase()) return ABIS.bridge as Abi
  if (at === TOKEN.toLowerCase()) return ABIS.erc20 as Abi
  if (at === ALLOW_TOKENS.toLowerCase()) return ABIS.allowTokens as Abi
  return ABIS.federation as Abi
}

const ALLOW_TOKENS = '0x140ccdea1D96EcEDAdC2CD27713f452a50942A19'
const FEDERATION = '0xE379DfB03E07ff4F1029698C219faB0B56a2bf67'

const CLAIM: ClaimRequest = {
  to: FROM,
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
    const wallet = fakeWallet({ getTransactionDataHash: ('0x' + '11'.repeat(32)) as Hex })
    const bridge = new ViemBridgeAdapter(wallet.clients, BRIDGE)

    await bridge.getTransactionDataHash(CLAIM)

    expect(wallet.decoded['getTransactionDataHash']).toEqual([
      CLAIM.to,
      BigInt(CLAIM.amount),
      CLAIM.blockHash,
      CLAIM.blockHash,
      CLAIM.logIndex,
      BigInt(CLAIM.originChainId),
      BigInt(CLAIM.destinationChainId),
    ])
  })

  it('passes the data hash twice, and picks the bytes32 overload', async () => {
    // isClaimed is overloaded — the other variant takes the claim tuple — and
    // the overload is resolved from the argument types.
    const hash = ('0x' + 'ab'.repeat(32)) as Hex
    const wallet = fakeWallet({ isClaimed: true })
    const bridge = new ViemBridgeAdapter(wallet.clients, BRIDGE)

    expect(await bridge.isClaimed(hash)).toBe(true)
    expect(wallet.decoded['isClaimed']).toEqual([hash, hash])
  })

  it('duplicates blockHash into transactionHash when submitting a claim', async () => {
    const wallet = fakeWallet()
    const bridge = new ViemBridgeAdapter(wallet.clients, BRIDGE)

    await bridge.claim(CLAIM, FROM, '0x7bfa480')

    const [payload] = wallet.decoded['claim'] as [Record<string, unknown>]
    expect(payload['blockHash']).toBe(CLAIM.blockHash)
    expect(payload['transactionHash']).toBe(CLAIM.blockHash)
  })

  it('sends with the caller-provided from and gasPrice', async () => {
    const wallet = fakeWallet()
    const bridge = new ViemBridgeAdapter(wallet.clients, BRIDGE)

    await bridge.claim(CLAIM, FROM, '0x7bfa480')

    const sent = wallet.calls.find((c) => c.method === 'eth_sendTransaction')!
    const [tx] = sent.params as [{ from: string; gasPrice: string; gas: string }]
    expect(tx.from.toLowerCase()).toBe(FROM.toLowerCase())
    expect(BigInt(tx.gasPrice)).toBe(BigInt('0x7bfa480'))
    // Explicit gas, so no eth_estimateGas round trip is added.
    expect(BigInt(tx.gas)).toBe(400_000n)
    expect(wallet.calls.some((c) => c.method === 'eth_estimateGas')).toBe(false)
  })
})

describe('receiveTokensTo', () => {
  it('passes the destination chain, token, receiver and amount in order', async () => {
    const wallet = fakeWallet()
    const bridge = new ViemBridgeAdapter(wallet.clients, BRIDGE)

    await bridge.receiveTokensTo(
      { destinationChainId: 31, tokenAddress: TOKEN, to: 'Habc', amount: '1230000' },
      FROM,
      '0x1',
    )

    expect(wallet.decoded['receiveTokensTo']).toEqual([31n, TOKEN, 'Habc', 1230000n])
  })
})

describe('what a write resolves with', () => {
  it('returns the hash without waiting for the transaction to be mined', async () => {
    // The hash is what the caller needs to link to the explorer and to poll;
    // waiting here would hide it for as long as the chain takes.
    const wallet = fakeWallet()
    const bridge = new ViemBridgeAdapter(wallet.clients, BRIDGE)

    expect(await bridge.claim(CLAIM, FROM, '0x1')).toBe('0xsent')
    expect(wallet.calls.some((c) => c.method === 'eth_getTransactionReceipt')).toBe(false)
  })

  it('rejects when the wallet refuses to sign', async () => {
    const clients = () =>
      createEvmClients({
        async request({ method }: { method: string }) {
          if (method === 'eth_sendTransaction') {
            throw new Error('User denied transaction signature')
          }
          return method === 'eth_chainId' ? '0xa4b1' : null
        },
      })

    const bridge = new ViemBridgeAdapter(clients, BRIDGE)
    await expect(bridge.claim(CLAIM, FROM, '0x1')).rejects.toThrow(/User denied/)
  })
})

describe('ERC20', () => {
  it('reads a balance as a plain integer string', async () => {
    const wallet = fakeWallet({ balanceOf: 250_500_000n })
    const erc20 = new ViemErc20Adapter(wallet.clients)

    expect(await erc20.balanceOf(TOKEN, FROM)).toBe('250500000')
  })

  it('approves the spender for the amount it was given', async () => {
    const wallet = fakeWallet()
    const erc20 = new ViemErc20Adapter(wallet.clients)

    await erc20.approve(TOKEN, BRIDGE, '1000000', FROM, '0x1')
    expect(wallet.decoded['approve']).toEqual([BRIDGE, 1_000_000n])
  })
})

describe('AllowTokens', () => {
  it('reads the limits out of the second returned tuple', async () => {
    // getInfoAndLimits returns (info, limit). Reading min off the top level —
    // as this did before it was wired to anything — yields undefined for all
    // three, and calling it without the token address reverts outright.
    const wallet = fakeWallet({
      getInfoAndLimits: [
        { allowed: true, typeId: 1n, spentToday: 0n, lastDay: 0n },
        { min: 1n, max: 2n, daily: 3n, mediumAmount: 0n, largeAmount: 0n },
      ] as const,
    })
    const allowTokens = new ViemAllowTokensAdapter(wallet.clients, ALLOW_TOKENS)

    expect(await allowTokens.getInfoAndLimits(TOKEN)).toEqual({
      min: '1',
      max: '2',
      daily: '3',
    })
    expect(wallet.decoded['getInfoAndLimits']).toEqual([TOKEN])
  })
})

describe('Federation', () => {
  it('returns the member addresses', async () => {
    const wallet = fakeWallet({ getMembers: [FROM, BRIDGE] })
    const federation = new ViemFederationAdapter(wallet.clients, FEDERATION)

    expect(await federation.getMembers()).toEqual([FROM, BRIDGE])
  })
})

describe('provider lifetime', () => {
  it('fails clearly when no provider is connected', async () => {
    const bridge = new ViemBridgeAdapter(() => null, BRIDGE)
    await expect(bridge.getFeePercentage()).rejects.toThrow(/No EVM provider/)
  })
})
