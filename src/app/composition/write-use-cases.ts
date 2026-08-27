import type { Container } from './container'
import { fromWei } from '../adapters/driven/evm/units'
import { tokensFor } from '../config/tokens'
import { validateHathorAddress } from '../domain/hathor-address'
import { AddressCryptoAdapter } from '../adapters/driven/crypto/address-crypto.adapter'
import { createResolveGasPrice } from '../application/use-cases/resolve-gas-price'
import { createApproveSpend } from '../application/use-cases/approve-spend'
import { createCrossToken } from '../application/use-cases/cross-token'
import { createClaimTransfer } from '../application/use-cases/claim-transfer'
import { createSendHathorTransfer } from '../application/use-cases/send-hathor-transfer'
import {
  createConnectEvmWallet,
  createForgetEvmWallet,
  createReconnectEvmWallet,
} from '../application/use-cases/connect-evm-wallet'

/**
 * Wires the write-path use cases — the ones that submit transactions.
 *
 * Three things are read from the store per call rather than captured: the
 * connected account, the fee, and the chain id. All three change while the page
 * is open (connect, network switch, the fee load that follows both), and a
 * captured value would price or address a transaction for a state that no longer
 * holds. That is also why these are getters rather than parameters: the call
 * sites in the UI should not have to remember to re-read them.
 */
export function createWriteUseCases(container: Container) {
  const { route, deployment, store } = container

  const tokens = tokensFor(deployment)

  const getAccount = () => store.getState().evmAddress
  const getFee = () => {
    const { feePercentage, feePercentageDivider } = store.getState()
    return { feePercentage, feePercentageDivider }
  }

  const resolveGasPrice = createResolveGasPrice({
    chain: container.chain,
    // The route in the store is the network the wallet is actually on; it is null
    // only when disconnected or on an unsupported chain, when no write is
    // reachable anyway.
    getChainId: () => store.getState().route?.evm.chainId ?? route.evm.chainId,
  })

  const crypto = new AddressCryptoAdapter()

  return {
    resolveGasPrice,

    approveSpend: createApproveSpend({
      erc20: container.erc20,
      chain: container.chain,
      tokens,
      route,
      resolveGasPrice,
      getFee,
      getAccount,
    }),

    crossToken: createCrossToken({
      erc20: container.erc20,
      bridge: container.bridge,
      allowTokens: container.allowTokens,
      chain: container.chain,
      history: container.transferHistory,
      tokens,
      route,
      resolveGasPrice,
      getFee,
      getAccount,
      isValidHathorAddress: (address) => validateHathorAddress(address, deployment, crypto),
      fromWei,
    }),

    claimTransfer: createClaimTransfer({
      bridge: container.bridge,
      chain: container.chain,
      route,
      resolveGasPrice,
      getAccount,
    }),

    sendHathorTransfer: createSendHathorTransfer({
      wallet: container.hathorWallet,
      history: container.transferHistory,
      tokens,
      route,
      deployment,
      eip7702: container.eip7702,
    }),

    // --- wallet connection -------------------------------------------------
    discoveredWallets: () => container.evmWallet.discovered(),
    walletEvents: (rdns: string) => container.evmWallet.events(rdns),
    connectEvmWallet: createConnectEvmWallet({
      wallet: container.evmWallet,
      preferences: container.preferences,
    }),
    reconnectEvmWallet: createReconnectEvmWallet({
      wallet: container.evmWallet,
      preferences: container.preferences,
    }),
    forgetEvmWallet: createForgetEvmWallet({ preferences: container.preferences }),
  }
}

export type WriteUseCases = ReturnType<typeof createWriteUseCases>
