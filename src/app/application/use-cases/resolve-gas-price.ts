import { gasPriceFor } from '../../domain/gas-price'
import type { EvmChainPort } from '../../ports/driven/evm-chain.port'

/**
 * Gas price for a write, as the three write paths each used to compute it.
 *
 * The rule itself is pure and lives in domain/gas-price.ts; this is the two-line
 * orchestration that fetches its inputs. It exists as a use case so that the
 * write use cases depend on "give me a gas price" rather than on the chain port
 * plus the rule plus the knowledge of which input to fetch.
 */

export interface ResolveGasPriceDeps {
  readonly chain: EvmChainPort
  /**
   * Chain the transaction will be sent on. Read per call: it changes when the
   * user switches networks, and a captured value would price for the old one.
   */
  readonly getChainId: () => number
}

export function createResolveGasPrice(deps: ResolveGasPriceDeps) {
  /** @returns hex-encoded gas price, ready for a transaction's `gasPrice`. */
  return async function resolveGasPrice(): Promise<string> {
    const chainId = deps.getChainId()

    return gasPriceFor(chainId, await deps.chain.getGasPriceInputs(chainId))
  }
}
