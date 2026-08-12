import type { Container } from './container'
import { tokensFor } from '../config/tokens'
import { createLoadTransferHistory } from '../application/use-cases/load-transfer-history'
import { createLoadBridgeParameters } from '../application/use-cases/load-bridge-parameters'
import { createWatchBlockNumber } from '../application/use-cases/watch-block-number'
import {
  createCheckAllowance,
  createGetMaxTransferable,
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

    loadBridgeParameters: createLoadBridgeParameters({
      bridge: container.bridge,
      allowTokens: container.allowTokens,
      federation: container.federation,
      feePercentageDivider: store.getState().feePercentageDivider,
      fromWei,
    }),

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

    checkAllowance: createCheckAllowance({ erc20: container.erc20, fromWei }),
  }
}

export type ReadUseCases = ReturnType<typeof createReadUseCases>
