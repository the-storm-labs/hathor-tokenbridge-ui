import BigNumber from 'bignumber.js'
import { ROUTES } from '../config/networks'
import type { Container } from './container'
import { TransferDirection, TransferStatus } from '../ports/driven/bridge-api.port'
import type { StoredTransfer } from '../ports/driven/transfer-history.port'
import { tokensFor } from '../config/tokens'
import { ABIS } from '../adapters/driven/evm/abis'
import { API_AMOUNT_DECIMALS } from '../config/constants'
import type { BridgeRoute } from '../domain/model/network'
import type { Deployment } from '../domain/model/deployment'
import type { Token } from '../domain/model/token'
import { validateHathorAddress } from '../domain/hathor-address'
import { toBaseUnits, fromBaseUnits, clampDecimals } from '../domain/amount-math'
import { quote, formatQuoteValue, maxTransferable } from '../domain/fee-math'
import { gasPriceFor, needsLatestBlockMinimum } from '../domain/gas-price'
import {
  toHathorTxId,
  truncateMiddle,
  matchLocalHathorTransfer,
  resolveOriginSender,
  isEvmSideAddress,
} from '../domain/tx-id'
import { paginate } from '../domain/pagination'
import { confirmationProgress } from '../domain/confirmations'
import { approvalProgress } from '../domain/vote-progress'
import { validateAmount, rejectionMessage } from '../domain/limits'
import { isEvmAddress } from '../domain/evm-address'
import { apiAmountDecimals } from '../domain/api-amount'
import type { UseCases } from './use-cases'
import type { MountedUi } from './ui'
import { CdnCryptoAdapter } from '../adapters/driven/crypto/cdn-crypto.adapter'
import { hathorTransferRow } from '../adapters/driving/ui/templates/hathor-transfer-row'
import { transferStatusCell } from '../adapters/driving/ui/templates/transfer-status'
import { formatRowAmount } from '../adapters/driving/ui/templates/amount'
import { bindToasts } from '../adapters/driving/ui/toasts'
import { formatFeeRate } from '../application/use-cases/load-bridge-parameters'
import { routeForChainId } from '../config/networks'
import type { Store } from '../application/state/store'
import type { AppState } from '../application/state/app-state'

/**
 * Temporary bridge between the new module graph and the legacy classic script.
 *
 * Why this works: classic scripts run in document order, `type="module"` scripts
 * are deferred and run after all of them but before DOMContentLoaded, and jQuery's
 * `$(document).ready` fires on DOMContentLoaded. So everything published here is
 * visible to every function body in js/index.js, including its whole ready block.
 *
 * The one rule that must be obeyed: a top-level `let`/`const`/`function` in a
 * classic script creates a *script-scope* binding that shadows the same-named
 * window property. Publishing `window.X` while `function X` still exists in
 * index.js does nothing. **Every symbol added here must have its declaration
 * deleted from index.js in the same commit.**
 *
 * This file grows through the migration and is deleted with js/index.js.
 */

/** The bs58 + CryptoJS translation now lives in its own adapter. */
const cdnCrypto = new CdnCryptoAdapter()

/**
 * Rebuilds the circular config pair the legacy code reads as `config` and
 * `config.crossToNetwork`.
 *
 * The cycle now exists in exactly one function, at the boundary, for a bounded
 * time — it dies with this file.
 */
function toLegacyConfigs(route: BridgeRoute): { evm: object; hathor: object } {
  const evm: Record<string, unknown> = { ...route.evm, networkId: route.evm.chainId }
  const hathor: Record<string, unknown> = { ...route.hathor, crossToNetwork: evm }
  evm['crossToNetwork'] = hathor
  return { evm, hathor }
}

/**
 * Rebuilds the numeric-chain-id-keyed token shape (`token[42161]`, `token[31]`).
 *
 * Two behaviours are load-bearing and preserved exactly:
 *  - a token absent from this deployment's EVM chain has **no** numeric key, so
 *    `token[networkId] != undefined` skips it in the dropdown;
 *  - the Hathor half is always present, using empty strings when unavailable,
 *    because populateHtrTokenDropdown reads `token[31].pureHtrAddress` unguarded
 *    and would throw on undefined.
 */
function toLegacyTokens(tokens: readonly Token[], evmChainId: number): object[] {
  return tokens.map((token) => {
    const legacy: Record<string | number, unknown> = {
      token: token.key,
      name: token.name,
      icon: token.icon,
      31: { ...token.hathor },
    }
    if (token.evm) legacy[evmChainId] = { ...token.evm }
    return legacy
  })
}

/**
 * Re-publishes the three globals that js/bridge-api.js, src/txns-storage.js and
 * js/hathor-wallet.js used to define, now backed by the adapters.
 *
 * The signatures are the legacy ones, not the ports': `getBalance` returns a
 * map keyed by token uid, `sendBridgeTx` wraps its result in `{ response }`, and
 * TXN_Storage is an object with the same *static* method names because index.js
 * calls it as a class. Adapting here rather than editing index.js keeps the
 * translation in the file that gets deleted.
 */
function publishLegacyServices(container: Container): Record<string, unknown> {
  const { deployment, transferHistory, bridgeApi, hathorWallet } = container

  return {
    BridgeAPI: {
      DIRECTION: {
        HATHOR_TO_EVM: TransferDirection.HathorToEvm,
        EVM_TO_HATHOR: TransferDirection.EvmToHathor,
      },
      STATUS: {
        HATHOR_VOTING: TransferStatus.HathorVoting,
        EVM_VOTING: TransferStatus.EvmVoting,
        AWAITING_CLAIM: TransferStatus.AwaitingClaim,
        CLAIMED: TransferStatus.Claimed,
      },
      getTransactionsByReceiver: (
        receiver: string,
        options: { limit?: number; direction?: TransferDirection } = {},
      ) => bridgeApi.listByReceiver(receiver, options),
      ping: () => bridgeApi.ping(),
      formatAmount: (raw: unknown, decimals = 18, displayDecimals = 4) => {
        try {
          return new BigNumber((raw as string) || 0)
            .shiftedBy(-decimals)
            .toFormat(displayDecimals, BigNumber.ROUND_DOWN)
        } catch {
          return '0'
        }
      },
    },

    TXN_Storage: {
      isStorageAvailable: () => transferHistory.isAvailable(),
      getAllTxns4Address: (address: string, network = '') => transferHistory.list(address, network),
      addTxn: (address: string, network = '', data: StoredTransfer = {}) =>
        transferHistory.addEvmTransfer(address, network, data),
      addHathorTxn: (address: string, network = '', data: StoredTransfer = {}) =>
        transferHistory.upsertHathorTransfer(address, network, data),
    },

    HathorWallet: {
      connect: async () => ({ address: (await hathorWallet.connect(deployment)).address }),
      disconnect: () => hathorWallet.disconnect(),
      restoreSession: () => hathorWallet.restore(deployment),
      // Legacy shape: a map keyed by token uid.
      getBalance: async (tokenUid: string) => ({
        [tokenUid]: await hathorWallet.getBalance(tokenUid, deployment),
      }),
      // Legacy shape: the result wrapped in `{ response }`.
      sendBridgeTx: async (
        bridgeAddress: string,
        tokenUid: string,
        amountUnits: string,
        evmDestination: string,
      ) => ({
        response: await hathorWallet.sendBridgeTransfer(
          { bridgeAddress, tokenUid, amountUnits: String(amountUnits), evmDestination },
          deployment,
        ),
      }),
      getAddress: () => hathorWallet.getAddress(),
      isConnected: () => hathorWallet.isConnected(),
    },
  }
}

/**
 * Legacy global name → AppState key, for every mutable global that used to be
 * declared at the top of js/index.js.
 *
 * **This table is the safety contract of this phase.** A global whose
 * declaration is deleted from index.js without an entry here becomes an implicit
 * global on its first write and a ReferenceError on its first read — and the
 * failure may only show up on a rare path like `accountsChanged`. Reviewing this
 * list against index.js's old declarations is the check that matters.
 *
 * Note the transfer-list names: the legacy ones are inverted with respect to
 * what they hold. `activeAddresseth2HtrTxns` is loaded with the *Hathor* network
 * name and therefore holds Hathor→EVM transfers. See app-state.ts.
 */
const STATE_ALIASES = {
  address: 'evmAddress',

  bridgeContract: 'bridgeContract',
  allowTokensContract: 'allowTokensContract',
  federationContract: 'federationContract',
  tokenContract: 'tokenContract',

  minTokensAllowed: 'minTokensAllowed',
  maxTokensAllowed: 'maxTokensAllowed',
  maxDailyLimit: 'maxDailyLimit',
  fee: 'feeRate',
  feePercentage: 'feePercentage',
  feePercentageDivider: 'feePercentageDivider',

  currentBlockNumber: 'blockNumber',
  poolingIntervalId: 'pollingIntervalId',

  activeAddresseth2HtrTxns: 'hathorToEvmTransfers',
  activeAddresshtr2EthTxns: 'evmToHathorTransfers',
  eth2HtrTablePage: 'hathorToEvmPage',
  htr2EthTablePage: 'evmToHathorPage',
  eth2HtrPaginationObj: 'hathorToEvmPagination',
  htr2EthPaginationObj: 'evmToHathorPagination',
} as const satisfies Record<string, keyof AppState>

/**
 * Publishes each state slice as a `window` accessor.
 *
 * This is what makes a half-migrated app coherent rather than merely working. A
 * plain value on `window` would be readable by index.js, but its writes would go
 * nowhere the new code can see. With an accessor, `config = null` in a legacy
 * function *is* a store mutation, and anything subscribed to the store observes
 * it.
 */
function bindStateAccessors(
  store: Store<AppState>,
  deployment: Deployment,
  legacyConfigForRoute: LegacyConfigLookup,
): void {
  for (const [legacyName, stateKey] of Object.entries(STATE_ALIASES)) {
    Object.defineProperty(window, legacyName, {
      configurable: true,
      get: () => store.getState()[stateKey as keyof AppState],
      set: (value: unknown) => store.patch({ [stateKey]: value } as unknown as Partial<AppState>),
    })
  }

  // `config` is the one alias that needs translation in both directions: the
  // store holds a typed, acyclic BridgeRoute while index.js expects the legacy
  // object with its `crossToNetwork` cycle.
  Object.defineProperty(window, 'config', {
    configurable: true,
    get: () => {
      const route = store.getState().route
      return route ? legacyConfigForRoute(route) : null
    },
    set: (value: { networkId?: number } | null) => {
      // Legacy code only ever assigns null or one of the EVM config objects
      // this file produced, so the chain id round-trips back to its route.
      // The deployment comes from the page, not from the current route — the
      // route is null exactly when this is first assigned.
      const route = value?.networkId ? routeForChainId(value.networkId, deployment) : null
      store.patch({ route })
    },
  })
}

type LegacyConfigLookup = (route: BridgeRoute) => object

export function installLegacyBridge(
  container: Container,
  useCases: UseCases,
  ui: MountedUi,
): void {
  const deployment = container.deployment
  const route = ROUTES[deployment]
  const legacyConfigs = toLegacyConfigs(route)
  const otherRoute = ROUTES[deployment === 'mainnet' ? 'testnet' : 'mainnet']
  const otherConfigs = toLegacyConfigs(otherRoute)

  const mainnetConfigs = deployment === 'mainnet' ? legacyConfigs : otherConfigs
  const testnetConfigs = deployment === 'testnet' ? legacyConfigs : otherConfigs

  // Memoised: `config` is read on the order of forty times per render, some of
  // them inside row loops, and rebuilding the cyclic object each time would be
  // both wasteful and a source of surprising identity mismatches.
  const legacyConfigForRoute = (candidate: BridgeRoute): object =>
    candidate.deployment === deployment ? legacyConfigs.evm : otherConfigs.evm

  bindStateAccessors(container.store, deployment, legacyConfigForRoute)

  // Toasts own their own dismissal timers, so index.js shows and hides by id
  // instead of calling .show()/.hide() on the elements directly.
  const toasts = bindToasts(window.document, container.scheduler)

  Object.assign(window, publishLegacyServices(container), {
    // --- config, in the shape index.js still reads ---
    ETH_CONFIG: mainnetConfigs.evm,
    HTR_MAINNET_CONFIG: mainnetConfigs.hathor,
    SEPOLIA_CONFIG: testnetConfigs.evm,
    HTR_TESTNET_CONFIG: testnetConfigs.hathor,

    isTestnet: deployment === 'testnet',
    TOKENS: toLegacyTokens(tokensFor(deployment), route.evm.chainId),

    // --- ABIs, now guaranteed present before any contract is constructed ---
    BRIDGE_ABI: ABIS.bridge,
    ALLOW_TOKENS_ABI: ABIS.allowTokens,
    ERC20_ABI: ABIS.erc20,
    FEDERATION_ABI: ABIS.federation,

    // --- pure helpers, called by index.js under their original names ---
    truncateMiddle,
    toHathorTxId,
    Paginator: paginate,

    /** index.js calls this with one argument; deployment is bound here. */
    validateHathorAddress: (address: string) =>
      validateHathorAddress(address, deployment, cdnCrypto),

    /**
     * The domain takes an injected hasher; the legacy call site does not have
     * one, so the Web3 global is supplied at the boundary.
     */
    matchLocalHathorTxn: (
      localTxns: readonly { hathorTxId?: string | null }[],
      tx: {
        originTransactionHash?: string | null
        backendTxHash?: string | null
        blockHash?: string | null
      },
    ) => matchLocalHathorTransfer(localTxns, tx, (value) => Web3.utils.keccak256(value)),

    __useCases: useCases,

    // The components index.js still has to drive, until the forms around them
    // are components too.
    __ui: {
      toast: {
        show: (id: string, options?: { autoDismiss?: boolean }) => toasts.show(id, options),
        hide: (id: string) => toasts.hide(id),
      },
      infoPanel: {
        refresh: (tokenAddress: string) => ui.infoPanel.refresh(tokenAddress),
      },
    },
    __templates: { hathorTransferRow, transferStatusCell, formatRowAmount, formatFeeRate },

    // --- domain functions the legacy code now delegates to ---
    __domain: {
      toBaseUnits,
      fromBaseUnits,
      clampDecimals,
      quote,
      formatQuoteValue,
      maxTransferable,
      gasPriceFor,
      needsLatestBlockMinimum,
      confirmationProgress,
      approvalProgress,
      validateAmount,
      rejectionMessage,
      isEvmAddress,
      API_AMOUNT_DECIMALS,
      apiAmountDecimals,
      resolveOriginSender,
      isEvmSideAddress,
      deployment,
    },
  })
}
