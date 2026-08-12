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
  ...over,
})

function setup(options: { remote?: ApiTransfer[]; bridge?: BridgeContractPort | null } = {}) {
  const storage = fakeStorage()
  const history = new LocalTransferHistoryAdapter(storage)
  const bridgeApi: BridgeApiPort = {
    listByReceiver: vi.fn(async () => options.remote ?? []),
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
