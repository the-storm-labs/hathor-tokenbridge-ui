import { TransferStatus } from '../../../../ports/driven/bridge-api.port'

/**
 * The action cell of a history row: a status badge, or a Claim button.
 *
 * Extracted from setStatusAction. The Claim button no longer carries the claim
 * parameters as `data-*` attributes — they used to be written here and re-parsed
 * out of the DOM by setClaimButtons, which meant an amount made a round trip
 * through a string attribute before reaching a contract call. The button now
 * carries only its index; the component holds the typed ClaimRequest.
 */
export function transferStatusCell(status: string | null, claimIndex: number | null): string {
  switch (status) {
    case TransferStatus.HathorVoting:
      return badge('warning', 'fa-hourglass-half', 'Signing on Hathor')

    // "processing_transfer" was written by earlier builds; stored records still
    // carry it until the API refreshes them.
    case TransferStatus.EvmVoting:
    case 'processing_transfer':
      return badge('warning', 'fa-hourglass-half', 'Voting — in progress')

    case TransferStatus.AwaitingClaim:
      // No claim parameters means we could not build a valid request — no
      // wallet connected, or a record missing a field. Offering the button
      // anyway would send the user to a transaction that reverts.
      //
      // The fallback used to read "Voting — in progress", which contradicted
      // the 4/4 approval meter next to it: a transfer awaiting a claim has
      // finished voting by definition.
      return claimIndex === null
        ? badge('warning', 'fa-hourglass-half', 'Awaiting claim')
        : `<button class="btn btn-primary claim-button" data-claim-index="${claimIndex}">Claim</button>`

    case TransferStatus.Claimed:
      return badge('success', 'fa-check-circle', 'Claimed')

    default:
      return ''
  }
}

const badge = (variant: string, icon: string, label: string): string =>
  `<span class="badge badge-${variant}"><i class="fas ${icon} mr-1"></i>${label}</span>`
