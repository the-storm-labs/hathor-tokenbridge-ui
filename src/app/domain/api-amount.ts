import { API_AMOUNT_DECIMALS } from '../config/constants'
import { TransferStatus } from '../ports/driven/bridge-api.port'

/**
 * How many decimals the Read API's `amount` is scaled by — which is **not
 * constant**, and getting it wrong renders a real transfer as `0.00`.
 *
 * Measured on live mainnet records:
 *
 * ```
 * status           amount                 signatures  votes
 * hathor_voting    500                    4           0      <- Hathor units
 * evm_voting       2000000000000000000    0           2      <- 18 decimals
 * claimed          5000000000000000000    5           4      <- 18 decimals
 * ```
 *
 * The reason is the pipeline, not an inconsistency. While a transfer is still
 * `hathor_voting` the EVM side has not seen it at all (`votes: 0`), so the only
 * amount the API can report is the one from the Hathor transaction, in that
 * token's Hathor units. Once the EVM federation votes, the amount comes from the
 * EVM event, which the bridge normalises to 18 decimals for every token.
 *
 * Note the same transfer changes scale as it progresses: the `claimed` record
 * above is the very transfer that was `hathor_voting` with `amount: 500`.
 */
export function apiAmountDecimals(status: string | null, hathorDecimals: number): number {
  return status === TransferStatus.HathorVoting ? hathorDecimals : API_AMOUNT_DECIMALS
}
