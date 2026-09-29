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

const ARBITRUM_SEPOLIA: EvmNetwork = {
  chainId: 421614,
  name: 'Arbitrum Sepolia',
  bridge: '0x05b5e8751f2dca1a382069BD50C43d7a98eB4247',
  allowTokens: '0xA1aC84247e03c339Ad4Cd87608751d2477648a50',
  federation: '0x00670ce01042079ae2AFf4C451E379f08FD43f02',
  explorer: 'https://sepolia.arbiscan.io',
  explorerTokenTab: '#tokentxns',
  // The federators wait 300/600/900 blocks by amount tier (≤10, ≤100, above),
  // times each one's order; this is the smallest tier.
  confirmations: 300,
  confirmationTime: '2 minutes',
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

/**
 * The same Hathor testnet as HATHOR_TESTNET, bridged by a different federation:
 * the 2-of-3 multisig deployment paired with Arbitrum Sepolia. The name must
 * differ from HATHOR_TESTNET's — local transfer history is keyed by it, and a
 * shared key would mix the two bridges' records.
 */
const HATHOR_TESTNET_MULTISIG: HathorNetwork = {
  networkId: 31,
  name: 'Hathor Testnet',
  federation: '0xf8E9dE50461AEE95463cc8De28591e7A725E4342',
  explorer: 'https://explorer.testnet.hathor.network',
  explorerTokenTab: 'token_detail',
  confirmations: 1,
  confirmationTime: '1 minute',
  secondsPerBlock: 30,
  bridgeHathorAddress: 'wbihDnF11dfeMRVAWtE6b3MCCy9eSPoi5p',
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
  // Three federators, two signatures to release on either side.
  'testnet-arb': {
    deployment: 'testnet-arb',
    evm: ARBITRUM_SEPOLIA,
    hathor: HATHOR_TESTNET_MULTISIG,
    signaturesRequired: 2,
  },
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
