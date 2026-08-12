import type { BridgeRoute } from '../../domain/model/network'
import type { StoredTransfer } from '../../ports/driven/transfer-history.port'

/**
 * Everything the app knows at a point in time — the typed replacement for the
 * mutable globals that used to live at the top of js/index.js.
 *
 * Deliberately flat. Nesting would read better, but every slice is currently
 * reached through a `window` accessor keyed by name, and a flat map keeps that
 * translation mechanical while both halves coexist.
 *
 * ## The transfer lists are named for what they hold
 *
 * The legacy names are inverted, and it has misled every reader of this code:
 * `activeAddresseth2HtrTxns` holds the **Hathor→EVM** transfers (it is loaded
 * with the *Hathor* network name and rendered into `#eth-htr-tbody`, whose tab
 * is labelled "HTR → ARB"). The mapping is spelled out in legacy-bridge.ts.
 */
export interface AppState {
  /** Connected EVM account, or `''` when disconnected. */
  evmAddress: string

  /**
   * The route for the network the wallet is on. `null` when disconnected or on
   * a chain this deployment does not bridge — which is what drives the
   * "Wrong Network" state.
   */
  route: BridgeRoute | null

  // --- contracts -----------------------------------------------------------
  // Held as `unknown`: these are web3 Contract instances, and the store has no
  // business knowing their shape. Consumers narrow at the adapter boundary.
  bridgeContract: unknown
  allowTokensContract: unknown
  federationContract: unknown
  /** Contract of the token currently selected in the ARB→HTR form. */
  tokenContract: unknown

  // --- bridge parameters, read from the contracts on connect ---------------
  minTokensAllowed: number
  maxTokensAllowed: number
  maxDailyLimit: number
  /** Fractional fee rate, e.g. 0.002 for 0.2%. */
  feeRate: number
  /** The same fee as basis points out of feePercentageDivider. */
  feePercentage: number
  feePercentageDivider: number

  // --- chain ---------------------------------------------------------------
  blockNumber: number | null
  /**
   * Handle of the history poller. Held here because claiming has to stop the
   * poll before submitting and restart it afterwards.
   */
  pollingIntervalId: number | null

  // --- transfer history ----------------------------------------------------
  /** Hathor-origin transfers. Legacy name: `activeAddresseth2HtrTxns`. */
  hathorToEvmTransfers: readonly StoredTransfer[]
  /** EVM-origin transfers. Legacy name: `activeAddresshtr2EthTxns`. */
  evmToHathorTransfers: readonly StoredTransfer[]
  /** Legacy name: `eth2HtrTablePage`. */
  hathorToEvmPage: number
  /** Legacy name: `htr2EthTablePage`. */
  evmToHathorPage: number
  /** Legacy name: `eth2HtrPaginationObj`. */
  hathorToEvmPagination: unknown
  /** Legacy name: `htr2EthPaginationObj`. */
  evmToHathorPagination: unknown
}

/** The values the globals were initialised with, preserved exactly. */
export function initialAppState(): AppState {
  return {
    evmAddress: '',
    route: null,

    bridgeContract: null,
    allowTokensContract: null,
    federationContract: null,
    tokenContract: null,

    minTokensAllowed: 1,
    maxTokensAllowed: 100_000,
    maxDailyLimit: 1_000_000,
    feeRate: 0,
    feePercentage: 0,
    feePercentageDivider: 10_000,

    blockNumber: null,
    pollingIntervalId: null,

    hathorToEvmTransfers: [],
    evmToHathorTransfers: [],
    hathorToEvmPage: 1,
    evmToHathorPage: 1,
    hathorToEvmPagination: {},
    evmToHathorPagination: {},
  }
}
