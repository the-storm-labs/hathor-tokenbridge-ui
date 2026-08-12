import type { Container } from './container'
import { createWriteUseCases, type WriteUseCases } from './write-use-cases'
import { tokensFor } from '../config/tokens'
import { createLoadTransferHistory } from '../application/use-cases/load-transfer-history'
import {
  createLoadBridgeParameters,
  type BridgeParameters,
} from '../application/use-cases/load-bridge-parameters'
import type { Store } from '../application/state/store'
import type { AppState } from '../application/state/app-state'
import { createWatchBlockNumber } from '../application/use-cases/watch-block-number'
import {
  createCheckAllowance,
  createGetMaxTransferable,
  createGetTokenBalance,
  createRefreshHathorBalance,
} from '../application/use-cases/token-balances'

/**
 * Wires the read-path use cases to the adapters.
 *
 * Each use case receives exactly the ports it needs, so what it can reach is
 * visible at the call site rather than implied by what happens to be global.
 */
export function createReadUseCases(container: Container) {
  const { route, deployment, store } = container

  // web3's helpers are only available once the CDN script has run, so they are
  // reached lazily rather than captured at construction.
  const fromWei = (value: string) => Web3.utils.fromWei(value, 'ether')
  const keccak256 = (value: string) => Web3.utils.keccak256(value)

  return {
    loadTransferHistory: createLoadTransferHistory({
      bridgeApi: container.bridgeApi,
      // Only re-check claims on-chain once a wallet is connected; without one
      // every call would throw and be swallowed.
      get bridge() {
        return store.getState().evmAddress ? container.bridge : null
      },
      history: container.transferHistory,
      tokens: tokensFor(deployment),
      route,
      hash: keccak256,
    }),

    loadBridgeParameters: withStoredParameters(
      createLoadBridgeParameters({
        bridge: container.bridge,
        allowTokens: container.allowTokens,
        federation: container.federation,
        feePercentageDivider: store.getState().feePercentageDivider,
        fromWei,
      }),
      store,
    ),

    watchBlockNumber: createWatchBlockNumber({
      chain: container.chain,
      scheduler: container.scheduler,
    }),

    refreshHathorBalance: createRefreshHathorBalance({
      wallet: container.hathorWallet,
      deployment,
    }),

    getMaxTransferable: createGetMaxTransferable({
      erc20: container.erc20,
      allowTokens: container.allowTokens,
      fromWei,
    }),

    getTokenBalance: createGetTokenBalance({ erc20: container.erc20 }),

    checkAllowance: createCheckAllowance({ erc20: container.erc20, fromWei }),
  }
}

export type ReadUseCases = ReturnType<typeof createReadUseCases>

/**
 * Every use case the app can reach, composed once.
 *
 * Read and write are wired separately because they need different things from
 * the store, and joined here because no call site cares which half a call
 * belongs to. Built once in main.ts and handed to both the components and the
 * legacy shim, so the two halves drive the same instances — and the same
 * store — for as long as they coexist.
 */
export function createUseCases(container: Container): UseCases {
  return { ...createReadUseCases(container), ...createWriteUseCases(container) }
}

export type UseCases = ReadUseCases & WriteUseCases

/**
 * Keeps the store's copy of the bridge parameters in step with the last read.
 *
 * The fee and the limits are not only displayed: the amount validation, the
 * quote and the approval gross-up all read them, so loading them has to be a
 * state change and not just a value handed to the info panel. setInfoTab did
 * this by assigning five globals; here the write happens once, at the seam
 * between the use case and its callers, so no component has to remember it.
 */
function withStoredParameters(
  load: (tokenAddress: string) => Promise<BridgeParameters>,
  store: Store<AppState>,
) {
  return async function loadBridgeParameters(tokenAddress: string): Promise<BridgeParameters> {
    const parameters = await load(tokenAddress)

    store.patch({
      minTokensAllowed: parameters.minTokensAllowed,
      maxTokensAllowed: parameters.maxTokensAllowed,
      maxDailyLimit: parameters.maxDailyLimit,
      feeRate: parameters.feeRate,
      feePercentage: parameters.feePercentage,
    })

    return parameters
  }
}
