/**
 * Which pair of networks the page is bridging between.
 *
 * `mainnet` = Arbitrum One ↔ Hathor mainnet, `testnet` = Sepolia ↔ Hathor
 * testnet, `testnet-arb` = Arbitrum Sepolia ↔ Hathor testnet (the 2-of-3
 * multisig bridge). The two testnets share the Hathor side but nothing on the
 * EVM side. It is a property of the deployed page, not of the connected wallet.
 *
 * Phase 3 builds the full BridgeRoute model around this; the type lives on its
 * own because the address validator and the env resolver both need it first.
 */
export type Deployment = 'mainnet' | 'testnet' | 'testnet-arb'

/**
 * The Hathor network a deployment runs on — which is **not** the deployment
 * itself once two deployments share one. It is what goes on the wire to the
 * wallet (`network`, the `hathor:<id>` CAIP chain) and what picks the node and
 * the address prefixes; sending `testnet-arb` there would be a network no
 * wallet knows.
 */
export type HathorNetworkId = 'mainnet' | 'testnet'

export function hathorNetworkOf(deployment: Deployment): HathorNetworkId {
  return deployment === 'mainnet' ? 'mainnet' : 'testnet'
}
