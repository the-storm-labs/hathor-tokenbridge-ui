import { describe, it, expect, vi } from 'vitest'
import { createEvmClients, type EvmClients } from './clients'
import { ViemChainAdapter } from './chain.adapter'

const HASH = '0x1915fcda313919d015e1c6768c9b091e1e34707023e376e7a1dab92795bc99dc'

/** A provider whose answers the test dictates, per JSON-RPC method. */
function fakeNode(answers: Record<string, unknown | (() => unknown)>) {
  const calls: string[] = []

  const clients = () =>
    createEvmClients({
      async request({ method }: { method: string }) {
        calls.push(method)
        const answer = answers[method]
        return typeof answer === 'function' ? (answer as () => unknown)() : (answer ?? null)
      },
    })

  return { clients, calls }
}

const receipt = (overrides: Record<string, unknown> = {}) => ({
  status: '0x1',
  transactionHash: HASH,
  blockNumber: '0x7',
  blockHash: '0x' + '22'.repeat(32),
  transactionIndex: '0x0',
  from: '0x4359217fD9761AC1308E905c8b596777Efb20a1B',
  to: '0xB85573bb0D1403Ed56dDF12540cc57662dfB3351',
  cumulativeGasUsed: '0x1',
  gasUsed: '0x1',
  logs: [],
  logsBloom: '0x' + '00'.repeat(256),
  type: '0x2',
  effectiveGasPrice: '0x1',
  contractAddress: null,
  ...overrides,
})

describe('getGasPriceInputs', () => {
  it('fetches only the average price off the RSK range', async () => {
    const node = fakeNode({ eth_gasPrice: '0x64' })
    const adapter = new ViemChainAdapter(node.clients)

    expect(await adapter.getGasPriceInputs(42161)).toEqual({ averageGasPrice: '100' })
    expect(node.calls).not.toContain('eth_getBlockByNumber')
  })

  it('fetches only the block minimum on the RSK range', async () => {
    // minimumGasPrice is not part of any standard block, so viem's typed
    // getBlock would drop it — this goes out as a raw request.
    const node = fakeNode({ eth_getBlockByNumber: { minimumGasPrice: '59240000' } })
    const adapter = new ViemChainAdapter(node.clients)

    const inputs = await adapter.getGasPriceInputs(31)
    expect(inputs.latestBlockMinimumGasPrice).toBe('59240000')
    expect(node.calls).not.toContain('eth_gasPrice')
  })
})

describe('getBlockNumber', () => {
  it('returns the head as a number, not a bigint', async () => {
    const node = fakeNode({ eth_blockNumber: '0x2a' })
    expect(await new ViemChainAdapter(node.clients).getBlockNumber()).toBe(42)
  })
})

describe('waitForReceipt', () => {
  it('converts the receipt into what the port promises', async () => {
    // The block number arrives as a bigint and the status as a string; the
    // callers compare a boolean and do arithmetic on a number.
    const node = fakeNode({ eth_getTransactionReceipt: () => receipt(), eth_blockNumber: '0x9' })
    const adapter = new ViemChainAdapter(node.clients, 5_000, 10)

    const mined = await adapter.waitForReceipt(HASH)
    expect(mined.blockNumber).toBe(7)
    expect(mined.status).toBe(true)
    expect(mined.transactionHash).toBe(HASH)
  })

  it('reports a reverted transaction as unsuccessful rather than throwing', async () => {
    // The callers turn this boolean into the error the user sees; a revert that
    // arrives as a resolved receipt used to look like a successful transfer.
    const node = fakeNode({
      eth_getTransactionReceipt: () => receipt({ status: '0x0' }),
      eth_blockNumber: '0x9',
    })
    const adapter = new ViemChainAdapter(node.clients, 5_000, 10)

    expect((await adapter.waitForReceipt(HASH)).status).toBe(false)
  })

  it('rejects when the transaction is not mined in time', async () => {
    // The timeout is the adapter's, and it is what stops a stuck transfer from
    // leaving the UI spinning forever.
    let head = 9
    const node = fakeNode({
      eth_getTransactionReceipt: () => null,
      eth_blockNumber: () => `0x${(++head).toString(16)}`,
    })
    const adapter = new ViemChainAdapter(node.clients, 30, 10)

    await expect(adapter.waitForReceipt(HASH)).rejects.toThrow(/Timed out/)
  })
})

describe('provider lifetime', () => {
  it('reads the current clients on every call, not a cached pair', async () => {
    // The clients are rebuilt on wallet or network switch; a captured
    // reference would keep talking to the old provider.
    let current: EvmClients | null = null
    const adapter = new ViemChainAdapter(() => current)

    await expect(adapter.getBlockNumber()).rejects.toThrow(/No EVM provider/)

    current = createEvmClients({ request: vi.fn(async () => '0x2a') })
    expect(await adapter.getBlockNumber()).toBe(42)
  })
})
