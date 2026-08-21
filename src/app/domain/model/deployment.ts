/**
 * Which pair of networks the page is bridging between.
 *
 * `mainnet` = Arbitrum One ↔ Hathor mainnet, `testnet` = Sepolia ↔ Hathor
 * testnet. It is a property of the deployed page, not of the connected wallet.
 *
 * Phase 3 builds the full BridgeRoute model around this; the type lives on its
 * own because the address validator and the env resolver both need it first.
 */
export type Deployment = 'mainnet' | 'testnet'
