import { approvalProgress, type ApprovalCounts } from '../../../../domain/vote-progress'

/**
 * The little row of squares showing federation approvals.
 *
 * Pure markup from a pure calculation, extracted from the render loop it was
 * defined inside. The counting rules live in domain/vote-progress; this only
 * paints them.
 */
export function approvalMeter(counts: ApprovalCounts, isHathorPhase: boolean): string {
  const { count, required, label, title } = approvalProgress(counts, isHathorPhase)

  let segments = ''
  for (let i = 1; i <= required; i++) {
    const filled = i <= count
    const background = filled ? '#28a745' : '#e9ecef'
    segments +=
      `<div role="img" aria-label="${label} ${i} ${filled ? 'filled' : 'empty'}"` +
      ` style="width:14px; height:14px; background:${background}; border-radius:3px; margin-right:6px;"></div>`
  }

  return `
        <div class="d-flex align-items-center justify-content-end" style="gap:8px;" title="${title}">
          <div style="display:flex; align-items:center">${segments}</div>
          <small style="margin-left:8px;color:#6c757d; font-size:12px;">${count}/${required}</small>
        </div>
      `
}
