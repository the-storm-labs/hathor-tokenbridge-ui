import { describe, it, expect } from 'vitest'
import { mapApiTransfer, needsClaimCheck } from './api-transfer.mapper'
import { findToken } from '../../config/tokens'
import type { ApiTransfer } from '../../ports/driven/bridge-api.port'
import type { StoredTransfer } from '../../ports/driven/transfer-history.port'

const USDC = findToken('mainnet', 'USDC')!
const AHTR = findToken('mainnet', 'aHTR')!

const HATHOR_TX = '00002f8b4c63a0cf95c0d8279b77145f6e6fb42acc19046c5bdd888c738b5532'
const KECCAK = '0x289a0c69e8ccdb445018b43293ff03609cb05633c2590cb6c7753003f59d24ff'
const EVM_TX = '0x3649d02e31bc8ec0e0ca27c2968a38c49e3ab49ff19b8f36ef453a4c1c1441dd'
const RELAYER = '0x89612c955624281a4B3aa41b8b2994A77EDAcEaD'
const HATHOR_SENDER = 'HT55cV5JEQXL8pN7LQ9j19ZuPDELZxH4NM'
const RECEIVER = '0x4359217fD9761AC1308E905c8b596777Efb20a1B'

const apiRecord = (over: Partial<ApiTransfer> = {}): ApiTransfer => ({
  transactionId: EVM_TX,
  transactionHash: EVM_TX,
  backendTxHash: EVM_TX,
  originTransactionHash: null,
  originalTokenAddress: '0xE3f0Ae350EE09657933CD8202A4dd563c5af941F',
  sender: RELAYER,
  receiver: RECEIVER,
  amount: '2000000000000000000',
  votes: 2,
  signatures: 0,
  status: 'evm_voting',
  direction: 'hathor_to_evm',
  hathorFederationStatus: null,
  blockNumber: 493546013,
  blockHash: KECCAK,
  logIndex: 129,
  originChainId: 31,
  destinationChainId: 42161,
  updatedAt: null,
  ...over,
})

const map = (over: Partial<ApiTransfer> = {}, local: StoredTransfer[] = [], claimable = false) =>
  mapApiTransfer({
    remote: apiRecord(over),
    local,
    token: AHTR,
    hash: () => KECCAK,
    claimable,
  })

describe('rule 1 — the amount scale depends on the stage', () => {
  it('keeps the amount raw, never formatted', () => {
    expect(map().amount).toBe('2000000000000000000')
  })

  it('reports Hathor units while hathor_voting', () => {
    const transfer = map({ status: 'hathor_voting', amount: '500' })
    expect(transfer.amountDecimals).toBe(2)
    expect(transfer.amount).toBe('500')
  })

  it('reports the wire scale afterwards', () => {
    for (const status of ['evm_voting', 'awaiting_claim', 'claimed']) {
      expect(map({ status }).amountDecimals, status).toBe(18)
    }
  })

  it('carries the token precision for display', () => {
    expect(map().tokenDecimals).toBe(2)
  })
})

describe('rule 2 — the Hathor origin is identified two ways', () => {
  it('takes the id straight from originTransactionHash when present', () => {
    const transfer = map({ originTransactionHash: `0x${HATHOR_TX}` })
    expect(transfer.hathorTxId).toBe(HATHOR_TX)
  })

  it('recovers the id from a local record matched on blockHash', () => {
    // The case that produced duplicate rows: the API omits the origin hash and
    // identifies it as keccak256(hathorTxId) in the blockHash slot.
    const transfer = map({ originTransactionHash: null }, [{ hathorTxId: HATHOR_TX }])
    expect(transfer.hathorTxId).toBe(HATHOR_TX)
  })

  it('leaves the id null when nothing local matches', () => {
    // Transfers made before local history existed: there is genuinely nothing
    // to recover.
    const transfer = mapApiTransfer({
      remote: apiRecord(),
      local: [],
      token: AHTR,
      hash: () => 'unrelated',
      claimable: false,
    })
    expect(transfer.hathorTxId).toBeNull()
  })

  it('links to the Hathor id when known, and to the EVM hash otherwise', () => {
    expect(map({}, [{ hathorTxId: HATHOR_TX }]).displayedTxHash).toBe(HATHOR_TX)
    expect(
      mapApiTransfer({
        remote: apiRecord(),
        local: [],
        token: AHTR,
        hash: () => 'unrelated',
        claimable: false,
      }).displayedTxHash,
    ).toBe(EVM_TX)
  })
})

describe('rule 3 — sender may be the relayer, not the user', () => {
  it('prefers the locally captured Hathor sender over the relayer address', () => {
    const transfer = map({ sender: RELAYER }, [{ hathorTxId: HATHOR_TX, sender: HATHOR_SENDER }])
    expect(transfer.sender).toBe(HATHOR_SENDER)
  })

  it('trusts a Hathor sender reported by the API', () => {
    expect(map({ sender: HATHOR_SENDER }).sender).toBe(HATHOR_SENDER)
  })

  it('falls back to the relayer when nothing better exists', () => {
    expect(map({ sender: RELAYER }).sender).toBe(RELAYER)
  })
})

describe('claim parameters', () => {
  it('are absent unless the transfer is confirmed claimable', () => {
    expect(map({ status: 'awaiting_claim' }, [], false).claim).toBeNull()
  })

  it('carry the blockHash the data hash is built from', () => {
    const claim = map({ status: 'awaiting_claim' }, [], true).claim!
    expect(claim.blockHash).toBe(KECCAK)
    expect(claim.to).toBe(RECEIVER)
    expect(claim.amount).toBe('2000000000000000000')
    expect(claim.logIndex).toBe(129)
    expect(claim.originChainId).toBe(31)
    expect(claim.destinationChainId).toBe(42161)
  })

  it('are absent when the record is missing a required field', () => {
    // Better no Claim button than one that builds a hash matching nothing.
    expect(map({ blockHash: null }, [], true).claim).toBeNull()
    expect(map({ logIndex: null }, [], true).claim).toBeNull()
    expect(map({ receiver: null }, [], true).claim).toBeNull()
  })
})

describe('needsClaimCheck', () => {
  it('is true only for awaiting_claim', () => {
    // The API keeps reporting awaiting_claim after a transfer is claimed, so
    // this status alone must never render a Claim button.
    expect(needsClaimCheck('awaiting_claim')).toBe(true)
    for (const status of ['hathor_voting', 'evm_voting', 'claimed', null]) {
      expect(needsClaimCheck(status), String(status)).toBe(false)
    }
  })
})

describe('token fields', () => {
  it('uses the Hathor symbol and precision of the mapped token', () => {
    const transfer = mapApiTransfer({
      remote: apiRecord(),
      local: [],
      token: USDC,
      hash: () => KECCAK,
      claimable: false,
    })
    expect(transfer.tokenSymbol).toBe('hUSDC')
    expect(transfer.tokenDecimals).toBe(2)
  })
})
