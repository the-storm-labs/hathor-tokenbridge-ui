/**
 * The "Track" link a history row shows next to its hash: the transfer on the bridge dashboard,
 * where `/tx/<hash>` resolves any identifier the transfer is known by (EVM Cross hash, Hathor tx id,
 * transfer id) and opens its pipeline. Nothing when the deployment has no dashboard or the row has no
 * hash yet.
 */
export function dashboardLink(
  hash: string | null | undefined,
  dashboardUrl: string | null | undefined,
): string {
  if (!hash || !dashboardUrl || !/^(0x)?[0-9a-fA-F]+$/.test(hash)) return ''
  const href = `${dashboardUrl.replace(/\/+$/, '')}/tx/${encodeURIComponent(hash)}`
  return ` <a class="dashboard-link" href="${href}" target="_blank" rel="noopener noreferrer" title="Follow this transfer on the bridge dashboard">Track&nbsp;&#8599;</a>`
}
