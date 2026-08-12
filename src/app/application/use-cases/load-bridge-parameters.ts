import type {
  AllowTokensPort,
  BridgeContractPort,
  FederationPort,
} from '../../ports/driven/contracts.port'

/**
 * Reads the bridge's operating parameters from the chain.
 *
 * Absorbs the contract half of setInfoTab, which mixed three contract calls,
 * five global writes and eight DOM writes into one function. This returns
 * values; presenting them is the info panel's job.
 */

export interface BridgeParameters {
  readonly minTokensAllowed: number
  readonly maxTokensAllowed: number
  readonly maxDailyLimit: number
  /** Fractional rate, e.g. 0.002 for 0.2%. */
  readonly feeRate: number
  /** The same fee in basis points, as the contract reports it. */
  readonly feePercentage: number
  readonly federatorCount: number
  /** Federator signatures needed for a decision: majority of the members. */
  readonly federatorsRequired: number
}

export interface LoadBridgeParametersDeps {
  readonly bridge: BridgeContractPort
  readonly allowTokens: AllowTokensPort
  readonly federation: FederationPort
  /** Divisor the contract expresses its fee against. */
  readonly feePercentageDivider: number
  /** Converts an 18-decimal contract value to a whole-token number. */
  readonly fromWei: (value: string) => string
}

export function createLoadBridgeParameters(deps: LoadBridgeParametersDeps) {
  /**
   * @param tokenAddress the EVM token the limits are read for. They are
   *        configured per token, so this is not a page-level constant — it
   *        changes with the dropdown.
   */
  return async function loadBridgeParameters(tokenAddress: string): Promise<BridgeParameters> {
    const [limits, federators, feePercentageRaw] = await Promise.all([
      deps.allowTokens.getInfoAndLimits(tokenAddress),
      deps.federation.getMembers(),
      deps.bridge.getFeePercentage(),
    ])

    const feePercentage = Number(feePercentageRaw)

    return {
      minTokensAllowed: parseInt(deps.fromWei(limits.min), 10),
      maxTokensAllowed: parseInt(deps.fromWei(limits.max), 10),
      maxDailyLimit: parseInt(deps.fromWei(limits.daily), 10),
      feePercentage,
      feeRate: feePercentage / deps.feePercentageDivider,
      federatorCount: federators.length,
      // Matches the original: a simple majority, floor(n/2) + 1.
      federatorsRequired: Math.floor(federators.length / 2 + 1),
    }
  }
}

/** The fee as the info panel shows it, e.g. `'0.20%'`. */
export function formatFeeRate(feeRate: number): string {
  return `${(feeRate * 100).toFixed(2)}%`
}
