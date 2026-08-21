import type { Deployment } from './deployment'

/**
 * Network configuration, modelled as an acyclic pair.
 *
 * The original had four config objects with `crossToNetwork` back-references
 * patched in after declaration, making each one circular — not serialisable, not
 * structurally comparable, and impossible to log or snapshot. The cycle existed
 * only so that `config.crossToNetwork.explorer` was reachable from a single
 * global. A route that holds both sides gives the same reach with no cycle.
 */

export interface EvmNetwork {
  readonly chainId: number
  readonly name: string
  readonly bridge: string
  readonly allowTokens: string
  readonly federation: string
  readonly explorer: string
  readonly explorerTokenTab: string
  readonly confirmations: number
  readonly confirmationTime: string
  readonly secondsPerBlock: number
}

export interface HathorNetwork {
  /** Hathor's pseudo chain id in this app's token tables. */
  readonly networkId: 31
  readonly name: string
  readonly federation: string
  readonly explorer: string
  readonly explorerTokenTab: string
  readonly confirmations: number
  readonly confirmationTime: string
  readonly secondsPerBlock: number
  /** Deposit address — sending tokens here starts an HTR→EVM transfer. */
  readonly bridgeHathorAddress: string
}

/** The two networks a deployment bridges between. */
export interface BridgeRoute {
  readonly deployment: Deployment
  readonly evm: EvmNetwork
  readonly hathor: HathorNetwork
}
