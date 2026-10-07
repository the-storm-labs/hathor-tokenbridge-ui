import { confirmationProgress } from '../../../../domain/confirmations'
import {
  evmToHathorStage,
  type EvmToHathorStage,
  type FederationProgress,
} from '../../../../domain/evm-to-hathor-progress'
import { truncateMiddle } from '../../../../domain/tx-id'
import { approvalMeter } from './approval-meter'
import { formatRowAmount } from './amount'
import { dashboardLink } from './dashboard-link'

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
  /** What the Hathor federation has done, once the Read API reports it. */
  readonly federation?: FederationProgress | null
}

export interface EvmTransferRowContext {
  /** Chain head, as last seen by the poller. */
  readonly currentBlock: number
  readonly confirmations: number
  readonly secondsPerBlock: number
  readonly explorer: string
  /** The deployment's bridge dashboard, when it has one. */
  readonly dashboardUrl?: string | null
  /** Hathor federation signatures needed on this route. */
  readonly signaturesRequired: number
  /** Hathor explorer base URL, for the delivered transaction. */
  readonly hathorExplorer: string
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

  const stage = evmToHathorStage(progress, transfer.federation ?? null, context.signaturesRequired)
  const amount = formatRowAmount(transfer.amount, transfer.amountDecimals ?? null, 2)

  return `<tr class="black">
            ${hashCell(transfer.transactionHash, context.explorer, context.dashboardUrl)}
            <td>${transfer.blockNumber ?? ''}</td>
            <td>${amount} ${transfer.tokenFrom ?? ''}</td>
            <td class="align-middle">${stageCell(stage, context.hathorExplorer)}</td>
        </tr>`
}

/** The status column: where the transfer is on its way to Hathor. */
function stageCell(stage: EvmToHathorStage, hathorExplorer: string): string {
  switch (stage.kind) {
    case 'confirming':
      return `${badge('secondary', 'fa-hourglass-half', 'Confirming on Arbitrum')} <small class="text-muted">${stage.humanTimeRemaining.replace(/^\|\s*/, '')}</small>`
    case 'awaiting-federation':
      return badge('warning', 'fa-hourglass-half', 'Waiting for the federation')
    case 'signing':
      // One row: the meter is right-aligned on its own, for the Approvals
      // column of the other table.
      return `<div class="d-flex align-items-center" style="gap:8px;">${badge('warning', 'fa-hourglass-half', 'Signing on Hathor')}${approvalMeter({ signatures: stage.signatures }, true, stage.required)}</div>`
    case 'delayed':
      // The Hathor push failed and the federation proposes it again once its
      // owner resets it. Nothing for the user to do, and nothing is lost.
      return `<span title="The Hathor transaction is being sent again. No action is needed.">${badge('warning', 'fa-clock', 'Delayed')}</span>`
    case 'delivered': {
      const label = badge('success', 'fa-check-circle', 'Delivered')
      if (!stage.hathorTxId) return label
      const url = `${hathorExplorer}/transaction/${stage.hathorTxId}`
      return `${label} <a href="${url}" target="_blank" rel="noopener"><small>${truncateMiddle(stage.hathorTxId, 6, 6)}</small></a>`
    }
  }
}

const badge = (variant: string, icon: string, label: string): string =>
  `<span class="badge badge-${variant}"><i class="fas ${icon} mr-1"></i>${label}</span>`

/**
 * A record written before the transaction was mined has no hash yet. The
 * original called `.substring` on it unguarded and threw, taking the whole
 * table's render down with it.
 */
function hashCell(
  hash: string | null | undefined,
  explorer: string,
  dashboardUrl?: string | null,
): string {
  if (!hash) return `<th scope="row">—</th>`

  const short = `${hash.substring(0, 8)}...${hash.slice(-8)}`
  return `<th scope="row"><a class="tx-hash" href="${explorer}/tx/${hash}">${short}</a>${dashboardLink(hash, dashboardUrl)}</th>`
}
