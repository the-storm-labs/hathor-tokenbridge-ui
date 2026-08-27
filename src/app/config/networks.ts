import type { Deployment } from '../domain/model/deployment'
import type { BridgeRoute, EvmNetwork, HathorNetwork } from '../domain/model/network'

/**
 * Network configuration, ported verbatim from index.js. Values are unchanged;
 * only the shape is — see domain/model/network.ts for why the circular
 * `crossToNetwork` reference is gone.
 */

const SEPOLIA: EvmNetwork = {
  chainId: 11155111,
  name: 'Sepolia',
  bridge: '0xfc218f3feae75359eeb40d2490760f72faa01abd',
  allowTokens: '0x68a26d1586c2eabc05c09a90d31c93994c5954b2',
  federation: '0x91716baeca14f8d8be6c563c148ac158f23b973d',
  explorer: 'https://sepolia.etherscan.io',
  explorerTokenTab: '#tokentxns',
  confirmations: 10,
  confirmationTime: '10 minutes',
  secondsPerBlock: 5,
}

const ARBITRUM_ONE: EvmNetwork = {
  chainId: 42161,
  name: 'Arbitrum One',
  bridge: '0xB85573bb0D1403Ed56dDF12540cc57662dfB3351',
  allowTokens: '0x140ccdea1D96EcEDAdC2CD27713f452a50942A19',
  federation: '0xE379DfB03E07ff4F1029698C219faB0B56a2bf67',
  explorer: 'https://arbiscan.io',
  explorerTokenTab: '#tokentxns',
  confirmations: 900,
  confirmationTime: '10 minutes',
  secondsPerBlock: 0.25,
}

const HATHOR_TESTNET: HathorNetwork = {
  networkId: 31,
  // The live Hathor testnet is 'testnet-india'; this name dates from the 'golf'
  // testnet, which was reset. See the note in tokens.ts — the testnet token UIDs
  // are from that same era and no longer resolve.
  name: 'Golf',
  federation: '0xcE0226ACcDFBd32Dd723F927330f1952fB993c0d',
  explorer: 'https://explorer.testnet.hathor.network',
  explorerTokenTab: 'token_detail',
  confirmations: 2,
  confirmationTime: '10 minutes',
  secondsPerBlock: 30,
  bridgeHathorAddress: 'wYr7GUqHFDCan2WBN1f6JPJYUWPtpVhb22',
}

const HATHOR_MAINNET: HathorNetwork = {
  networkId: 31,
  name: 'Hathor Mainnet',
  federation: '0xC2d2318dEa546D995189f14a0F9d39fB1f56D966',
  explorer: 'https://explorer.hathor.network',
  explorerTokenTab: 'token_detail',
  confirmations: 2,
  confirmationTime: '10 minutes',
  secondsPerBlock: 30,
  bridgeHathorAddress: 'hQj6skwZY9RT3bRvFuRjioJP5ZbLSRYeuD',
}

export const ROUTES: Record<Deployment, BridgeRoute> = {
  mainnet: {
    deployment: 'mainnet',
    evm: ARBITRUM_ONE,
    hathor: HATHOR_MAINNET,
    signaturesRequired: 4,
  },
  // Golf testnet runs a single federator, not mainnet's four — the approval
  // meter waited on 4/4 here until this was split out of vote-progress.ts's
  // shared constant.
  testnet: { deployment: 'testnet', evm: SEPOLIA, hathor: HATHOR_TESTNET, signaturesRequired: 1 },
}

/**
 * The route for a connected wallet's chain id, or `null` if the wallet is on a
 * chain this deployment does not bridge — which is what drives the
 * "Wrong Network" message.
 */
export function routeForChainId(chainId: number, deployment: Deployment): BridgeRoute | null {
  const route = ROUTES[deployment]
  return route.evm.chainId === chainId ? route : null
}

/** The chain this deployment expects the wallet to be connected to. */
export function expectedChainId(deployment: Deployment): number {
  return ROUTES[deployment].evm.chainId
}
