import { confirmationProgress } from '../../../../domain/confirmations'
import { formatRowAmount } from './amount'

/**
 * One row of the EVM→Hathor history table.
 *
 * Extracted from a closure inside the render function, where it read the current
 * block off a global and built its status from a ternary over that. The
 * confirmation arithmetic is domain/confirmations; this only paints it.
 */

export interface EvmTransferRowData {
  readonly transactionHash?: string | null
  readonly blockNumber?: number | null
  readonly amount?: string | null
  /** Scale of `amount`; null for the string the user typed. */
  readonly amountDecimals?: number | null
  /** Legacy field name, written by crossToken: the EVM-side symbol. */
  readonly tokenFrom?: string | null
}

export interface EvmTransferRowContext {
  /** Chain head, as last seen by the poller. */
  readonly currentBlock: number
  readonly confirmations: number
  readonly secondsPerBlock: number
  readonly explorer: string
}

export function evmTransferRow(
  transfer: EvmTransferRowData,
  context: EvmTransferRowContext,
): string {
  const progress = confirmationProgress({
    transactionBlock: transfer.blockNumber ?? 0,
    currentBlock: context.currentBlock,
    required: context.confirmations,
    secondsPerBlock: context.secondsPerBlock,
  })

  const status = progress.confirmed ? '<span> Confirmed</span>' : '<span> Pending</span>'
  const amount = formatRowAmount(transfer.amount, transfer.amountDecimals ?? null, 2)

  return `<tr class="black">
            ${hashCell(transfer.transactionHash, context.explorer)}
            <td>${transfer.blockNumber ?? ''}</td>
            <td>${amount} ${transfer.tokenFrom ?? ''}</td>
            <td>${status} ${progress.humanTimeRemaining}</td>
        </tr>`
}

/**
 * A record written before the transaction was mined has no hash yet. The
 * original called `.substring` on it unguarded and threw, taking the whole
 * table's render down with it.
 */
function hashCell(hash: string | null | undefined, explorer: string): string {
  if (!hash) return `<th scope="row">—</th>`

  const short = `${hash.substring(0, 8)}...${hash.slice(-8)}`
  return `<th scope="row"><a href="${explorer}/tx/${hash}">${short}</a></th>`
}
