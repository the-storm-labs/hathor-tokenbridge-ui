import type { BridgeRoute } from '../../domain/model/network'

/**
 * Everything the app knows at a point in time — the typed replacement for the
 * mutable globals that used to live at the top of js/index.js.
 *
 * Deliberately flat. Nesting would read better, but every slice is currently
 * reached through a `window` accessor keyed by name, and a flat map keeps that
 * translation mechanical while both halves coexist.
 *
 * It shrinks as phase 8 proceeds: state that belongs to one component and is
 * read by nothing else moves into that component, where it cannot be mutated
 * from a distance. The transfer lists, the page numbers and the block number
 * went that way with the history table.
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
  }
}
