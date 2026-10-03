import { isEvmSideAddress, truncateMiddle } from '../../../../domain/tx-id'
import { TransferStatus } from '../../../../ports/driven/bridge-api.port'
import { approvalMeter } from './approval-meter'
import { formatRowAmount } from './amount'
import { dashboardLink } from './dashboard-link'

/**
 * One row of the Hathor→EVM history table.
 *
 * Extracted from a closure defined inside a 145-line render function, where it
 * also shadowed the `config` global with a defaulted parameter — so a caller who
 * forgot to pass it silently rendered "Not available" for every explorer link.
 * The link base is now an explicit argument.
 */

export interface HathorTransferRowData {
  readonly displayedTxHash?: string | null
  readonly hathorTxId?: string | null
  readonly transactionHash?: string | null
  readonly sender?: string | null
  readonly tokenSymbol?: string | null
  readonly amount?: string | null
  /** Scale of `amount`; null for a record written by an earlier build. */
  readonly amountDecimals?: number | null
  readonly tokenDecimals?: number
  readonly status?: string | null
  readonly votes?: number | null
  readonly signatures?: number | null
  /** Ready-made markup for the action cell (badge or Claim button). */
  readonly action?: string
}

export function hathorTransferRow(
  transfer: HathorTransferRowData,
  hathorExplorerUrl: string | null,
  signaturesRequired: number,
  dashboardUrl: string | null = null,
): string {
  const isHathorPhase = transfer.status === TransferStatus.HathorVoting
  const meter = approvalMeter(
    { votes: transfer.votes, signatures: transfer.signatures },
    isHathorPhase,
    signaturesRequired,
  )

  const symbol = transfer.tokenSymbol ?? ''
  const amount = formatRowAmount(
    transfer.amount,
    transfer.amountDecimals ?? null,
    transfer.tokenDecimals ?? 2,
  )

  return `<tr class="black">
        ${hashCell(transfer, hathorExplorerUrl, dashboardUrl)}
        <td class="align-middle">${senderCell(transfer.sender)}</td>
        <td class="align-middle">${amount} ${symbol}</td>
        <td class="align-middle">${meter}</td>
        <td class="align-middle">${transfer.action ?? ''}</td>
    </tr>`
}

/**
 * Only a Hathor id can be linked to the Hathor explorer; an EVM hash has no page there. The
 * dashboard resolves either, so its link shows whenever there is a hash at all.
 */
function hashCell(
  transfer: HathorTransferRowData,
  explorerUrl: string | null,
  dashboardUrl: string | null,
): string {
  const hash = transfer.displayedTxHash || transfer.hathorTxId || transfer.transactionHash
  const isHathorHash = !!hash && !isEvmSideAddress(hash)
  const track = dashboardLink(transfer.hathorTxId || hash, dashboardUrl)

  if (!isHathorHash || !explorerUrl) {
    return track ? `<th scope="row">${unavailableMarkup()}${track}</th>` : unavailableCell('th')
  }

  const short = `${hash.substring(0, 8)}...${hash.slice(-8)}`
  return `<th scope="row"><a href="${explorerUrl}/transaction/${hash}" target="_blank">${short}</a>${track}</th>`
}

/**
 * An EVM address here is the federation relayer, not the user's sender, so
 * there is nothing meaningful to show.
 */
function senderCell(sender: string | null | undefined): string {
  if (isEvmSideAddress(sender)) return unavailableMarkup()
  return truncateMiddle(sender || '—', 6, 4)
}

const unavailableMarkup = () =>
  `<span class="text-muted" style="font-size:0.85em;">Not available</span>`

const unavailableCell = (tag: 'th' | 'td') =>
  tag === 'th' ? `<th scope="row">${unavailableMarkup()}</th>` : `<td>${unavailableMarkup()}</td>`
