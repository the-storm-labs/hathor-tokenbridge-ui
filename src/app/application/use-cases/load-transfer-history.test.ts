import { describe, it, expect, vi } from 'vitest'
import { createLoadTransferHistory } from './load-transfer-history'
import { LocalTransferHistoryAdapter } from '../../adapters/driven/storage/local-transfer-history.adapter'
import { ROUTES } from '../../config/networks'
import { tokensFor, findToken } from '../../config/tokens'
import type { ApiTransfer, BridgeApiPort } from '../../ports/driven/bridge-api.port'
import type { BridgeContractPort } from '../../ports/driven/contracts.port'

const ADDRESS = '0x4359217fD9761AC1308E905c8b596777Efb20a1B'
const HATHOR_TX = '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532'
const KECCAK = '0x289a0c69e8ccdb445018b43293ff03609cb05633c2590cb6c7753003f59d24ff'
const EVM_TX = '0x3649d02e31bc8ec0e0ca27c2968a38c49e3ab49ff19b8f36ef453a4c1c1441dd'
const AHTR = findToken('mainnet', 'aHTR')!

function fakeStorage(): Storage {
  const raw = new Map<string, string>()
  return {
    get length() {
      return raw.size
    },
    key: (i: number) => [...raw.keys()][i] ?? null,
    getItem: (k: string) => raw.get(k) ?? null,
    setItem: (k: string, v: string) => void raw.set(k, v),
    removeItem: (k: string) => void raw.delete(k),
    clear: () => raw.clear(),
  } as Storage
}

const apiRecord = (over: Partial<ApiTransfer> = {}): ApiTransfer => ({
  transactionId: EVM_TX,
  transactionHash: EVM_TX,
  backendTxHash: EVM_TX,
  originTransactionHash: null,
  originalTokenAddress: AHTR.hathor.address,
  sender: '0x89612c955624281a4B3aa41b8b2994A77EDAcEaD',
  receiver: ADDRESS,
  amount: '2000000000000000000',
  votes: 4,
  signatures: 0,
  status: 'claimed',
  direction: 'hathor_to_evm',
  hathorFederationStatus: null,
  blockNumber: 100,
  blockHash: KECCAK,
  logIndex: 129,
  originChainId: 31,
  destinationChainId: 42161,
  updatedAt: null,
  delivered: null,
  deliveryTxId: null,
  ...over,
})

function setup(
  options: {
    remote?: ApiTransfer[]
    sent?: ApiTransfer[]
    bridge?: BridgeContractPort | null
  } = {},
) {
  const storage = fakeStorage()
  const history = new LocalTransferHistoryAdapter(storage)
  const bridgeApi: BridgeApiPort = {
    listByReceiver: vi.fn(async () => options.remote ?? []),
    listBySender: vi.fn(async () => options.sent ?? []),
    ping: async () => true,
  }

  const load = createLoadTransferHistory({
    bridgeApi,
    bridge: options.bridge === undefined ? null : options.bridge,
    history,
    tokens: tokensFor('mainnet'),
    route: ROUTES.mainnet,
    hash: () => KECCAK,
  })

  return { load, history, bridgeApi }
}

describe('loadTransferHistory', () => {
  it('returns empty without an address, and makes no request', async () => {
    const { load, bridgeApi } = setup()
    expect(await load('')).toEqual({ hathorToEvm: [], evmToHathor: [] })
    expect(bridgeApi.listByReceiver).not.toHaveBeenCalled()
  })

  it('maps API records into transfers', async () => {
    const { load } = setup({ remote: [apiRecord()] })
    const { hathorToEvm } = await load(ADDRESS)

    expect(hathorToEvm).toHaveLength(1)
    expect(hathorToEvm[0]!.tokenSymbol).toBe('HTR')
    expect(hathorToEvm[0]!.amount).toBe('2000000000000000000')
    expect(hathorToEvm[0]!.amountDecimals).toBe(18)
  })

  it('persists what it mapped, so ids survive the next poll', async () => {
    const { load, history } = setup({ remote: [apiRecord()] })
    await load(ADDRESS)

    const stored = history.list(ADDRESS, ROUTES.mainnet.hathor.name)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.amount).toBe('2000000000000000000')
    // Raw, not a display string — that is what let a formatting change require
    // a data migration before.
    expect(stored[0]!['amountDecimals']).toBe(18)
  })

  it('recovers a Hathor id from a local record the API cannot supply', async () => {
    const { load, history } = setup({ remote: [apiRecord()] })
    history.upsertHathorTransfer(ADDRESS, ROUTES.mainnet.hathor.name, {
      hathorTxId: HATHOR_TX,
      transactionHash: HATHOR_TX,
      sender: 'HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM',
    })

    const { hathorToEvm } = await load(ADDRESS)
    expect(hathorToEvm[0]!.hathorTxId).toBe(HATHOR_TX)
    expect(hathorToEvm[0]!.sender).toBe('HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM')
  })

  it('collapses the local record into the API one', async () => {
    const { load, history } = setup({ remote: [apiRecord()] })
    history.upsertHathorTransfer(ADDRESS, ROUTES.mainnet.hathor.name, {
      hathorTxId: HATHOR_TX,
      transactionHash: HATHOR_TX,
    })

    const { hathorToEvm } = await load(ADDRESS)
    expect(hathorToEvm).toHaveLength(1)
  })

  it('keeps a locally-sent transfer the API has not indexed yet', async () => {
    const { load, history } = setup({ remote: [] })
    history.upsertHathorTransfer(ADDRESS, ROUTES.mainnet.hathor.name, {
      hathorTxId: 'freshly-sent',
      amount: '2.00',
      status: 'hathor_voting',
    })

    const { hathorToEvm } = await load(ADDRESS)
    expect(hathorToEvm).toHaveLength(1)
    expect(hathorToEvm[0]!.hathorTxId).toBe('freshly-sent')
    // No scale recorded: the row template treats it as already formatted.
    expect(hathorToEvm[0]!.amountDecimals).toBeNull()
  })

  it('skips a transfer whose token this deployment does not list', async () => {
    const { load } = setup({ remote: [apiRecord({ originalTokenAddress: '0xdead' })] })
    expect((await load(ADDRESS)).hathorToEvm).toHaveLength(0)
  })

  it('survives an unreachable API without blanking local history', async () => {
    const storage = fakeStorage()
    const history = new LocalTransferHistoryAdapter(storage)
    history.upsertHathorTransfer(ADDRESS, ROUTES.mainnet.hathor.name, { hathorTxId: 'local' })

    const load = createLoadTransferHistory({
      bridgeApi: {
        listByReceiver: async () => {
          throw new Error('offline')
        },
        listBySender: async () => {
          throw new Error('offline')
        },
        ping: async () => false,
      },
      bridge: null,
      history,
      tokens: tokensFor('mainnet'),
      route: ROUTES.mainnet,
      hash: () => KECCAK,
    })

    expect((await load(ADDRESS)).hathorToEvm).toHaveLength(1)
  })

  it('reads EVM-origin transfers from the other network key', async () => {
    const { load, history } = setup({ remote: [] })
    history.addEvmTransfer(ADDRESS, ROUTES.mainnet.evm.name, { transactionHash: '0xevm' })

    const { evmToHathor } = await load(ADDRESS)
    expect(evmToHathor).toHaveLength(1)
  })
})

describe('ARB→HTR progress', () => {
  const USDC = findToken('mainnet', 'USDC')!
  const DEPOSIT = '0xAbCd000000000000000000000000000000000000000000000000000000000001'
  const sentRecord = (over: Partial<ApiTransfer> = {}) =>
    apiRecord({
      direction: 'evm_to_hathor',
      status: 'hathor_voting',
      sender: ADDRESS,
      receiver: 'HUr3CDnARXtYj68xbM6xDuFLBu3JytlPz3',
      originTransactionHash: DEPOSIT,
      originalTokenAddress: USDC.evm!.address,
      amount: '3000000',
      blockNumber: 500,
      signatures: 2,
      hathorFederationStatus: 'ProposalSigned',
      delivered: false,
      ...over,
    })

  it('asks the API for what this account sent, in that direction', async () => {
    const { load, bridgeApi } = setup()
    await load(ADDRESS)
    expect(bridgeApi.listBySender).toHaveBeenCalledWith(ADDRESS, {
      limit: 1000,
      direction: 'evm_to_hathor',
    })
  })

  it('joins the federation progress onto the local record, by deposit hash', async () => {
    const { load, history } = setup({ sent: [sentRecord()] })
    // The hash as the wallet reported it, in a different case from the API's.
    history.addEvmTransfer(ADDRESS, ROUTES.mainnet.evm.name, {
      transactionHash: DEPOSIT.toLowerCase(),
      blockNumber: 500,
      amount: '3',
      tokenFrom: 'USDC',
    })

    const { evmToHathor } = await load(ADDRESS)

    expect(evmToHathor).toHaveLength(1)
    expect(evmToHathor[0]).toMatchObject({
      amount: '3',
      federation: {
        signatures: 2,
        hathorFederationStatus: 'ProposalSigned',
        delivered: false,
        deliveryTxId: null,
      },
    })
  })

  it('carries the delivery and its Hathor tx id', async () => {
    const { load, history } = setup({
      sent: [
        sentRecord({
          delivered: true,
          deliveryTxId: '00bf68c9',
          hathorFederationStatus: 'ProposalSent',
        }),
      ],
    })
    history.addEvmTransfer(ADDRESS, ROUTES.mainnet.evm.name, {
      transactionHash: DEPOSIT,
      blockNumber: 500,
    })

    const { evmToHathor } = await load(ADDRESS)
    expect(evmToHathor[0]!.federation).toMatchObject({ delivered: true, deliveryTxId: '00bf68c9' })
  })

  it('shows a transfer sent from another device, from the API record', async () => {
    const { load } = setup({ sent: [sentRecord()] })

    const { evmToHathor } = await load(ADDRESS)

    expect(evmToHathor).toEqual([
      expect.objectContaining({
        transactionHash: DEPOSIT,
        blockNumber: 500,
        // The deposit in USDC's own 6-decimal base units.
        amount: '3000000',
        amountDecimals: 6,
        tokenFrom: 'USDC',
      }),
    ])
  })

  it('skips an API-only transfer of a token this deployment does not list', async () => {
    const { load } = setup({
      sent: [sentRecord({ originalTokenAddress: '0x0000000000000000000000000000000000000001' })],
    })
    expect((await load(ADDRESS)).evmToHathor).toHaveLength(0)
  })

  it('orders local and API-only transfers together, newest block first', async () => {
    const { load, history } = setup({
      sent: [sentRecord({ originTransactionHash: '0xremote', blockNumber: 700 })],
    })
    history.addEvmTransfer(ADDRESS, ROUTES.mainnet.evm.name, {
      transactionHash: '0xold',
      blockNumber: 600,
    })
    history.addEvmTransfer(ADDRESS, ROUTES.mainnet.evm.name, {
      transactionHash: '0xnew',
      blockNumber: 800,
    })

    const { evmToHathor } = await load(ADDRESS)
    expect(evmToHathor.map((t) => t.transactionHash)).toEqual(['0xnew', '0xremote', '0xold'])
  })

  it('keeps the local records, without progress, when the API is unreachable', async () => {
    const { load, history, bridgeApi } = setup()
    vi.mocked(bridgeApi.listBySender).mockRejectedValueOnce(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    history.addEvmTransfer(ADDRESS, ROUTES.mainnet.evm.name, {
      transactionHash: DEPOSIT,
      blockNumber: 500,
    })

    const { evmToHathor } = await load(ADDRESS)
    expect(evmToHathor).toHaveLength(1)
    expect(evmToHathor[0]!.federation).toBeUndefined()
  })
})

describe('claim resolution', () => {
  const claimable = (isClaimed: boolean): BridgeContractPort =>
    ({
      address: '0xbridge',
      getFeePercentage: async () => '0',
      getTransactionDataHash: async () => '0xdatahash',
      isClaimed: async () => isClaimed,
      claim: async () => '0xtx',
      receiveTokensTo: async () => '0xtx',
    }) as BridgeContractPort

  it('offers a claim when the chain says it is unclaimed', async () => {
    const { load } = setup({
      remote: [apiRecord({ status: 'awaiting_claim' })],
      bridge: claimable(false),
    })
    expect((await load(ADDRESS)).hathorToEvm[0]!.claim).not.toBeNull()
  })

  it('withholds it when the chain says it is already claimed', async () => {
    // awaiting_claim is not authoritative: the API keeps reporting it after the
    // claim succeeds, and offering the button sends the user to a revert.
    const { load } = setup({
      remote: [apiRecord({ status: 'awaiting_claim' })],
      bridge: claimable(true),
    })
    expect((await load(ADDRESS)).hathorToEvm[0]!.claim).toBeNull()
  })

  it('reports it as claimed, not as still voting', async () => {
    // The whole point of re-checking: for the seconds between the claim being
    // mined and the API re-indexing it, the row used to read
    // "Voting — in progress" beside a full 4/4 approval meter — right after the
    // user had claimed it.
    const { load } = setup({
      remote: [apiRecord({ status: 'awaiting_claim' })],
      bridge: claimable(true),
    })
    expect((await load(ADDRESS)).hathorToEvm[0]!.status).toBe('claimed')
  })

  it('persists the claimed status, so a reload does not undo it', async () => {
    const { load, history } = setup({
      remote: [apiRecord({ status: 'awaiting_claim' })],
      bridge: claimable(true),
    })

    await load(ADDRESS)
    expect(history.list(ADDRESS, 'Hathor Mainnet')[0]!.status).toBe('claimed')
  })

  it('does not check the chain for other statuses', async () => {
    const bridge = claimable(false)
    const spy = vi.spyOn(bridge, 'getTransactionDataHash')
    const { load } = setup({ remote: [apiRecord({ status: 'evm_voting' })], bridge })

    await load(ADDRESS)
    expect(spy).not.toHaveBeenCalled()
  })

  it('trusts the API when the chain cannot be reached', async () => {
    const bridge = {
      ...claimable(false),
      getTransactionDataHash: async () => {
        throw new Error('rpc down')
      },
    } as BridgeContractPort
    const { load } = setup({ remote: [apiRecord({ status: 'awaiting_claim' })], bridge })

    expect((await load(ADDRESS)).hathorToEvm[0]!.claim).not.toBeNull()
  })

  it('offers nothing when no contract is connected', async () => {
    const { load } = setup({ remote: [apiRecord({ status: 'awaiting_claim' })], bridge: null })
    expect((await load(ADDRESS)).hathorToEvm[0]!.claim).toBeNull()
  })
})
