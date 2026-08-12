/**
 * The one module allowed to talk to the jQuery-based CDN plugins.
 *
 * Bootstrap 4's modal/tab and bootstrap-select are jQuery plugins with no
 * module build; the page loads them as `<script>` tags. Components call the
 * functions here instead of reaching for `$` themselves, so the coupling has a
 * single, countable home — and so a component stays testable under jsdom, where
 * none of these globals exist.
 *
 * Every function is a no-op when its plugin is absent. That is not defensive
 * padding: it is what lets the same code run in a test and on the page.
 */

/** Whether jQuery is on the page at all. */
function hasJQuery(): boolean {
  return typeof $ !== 'undefined'
}

/**
 * Repaints a bootstrap-select whose `<option>`s were replaced.
 *
 * Skipped until the plugin has initialised, which is detectable because it
 * wraps the `<select>` in a `.bootstrap-select` element. Calling `refresh` on an
 * uninitialised picker would initialise it instead — early, from a component
 * that mounts before index.js's ready block sets up every `.selectpicker` on the
 * page, which leaves the two disagreeing about the widget's state.
 */
export function refreshSelectpicker(select: HTMLSelectElement): void {
  if (!hasJQuery()) return
  if (!select.parentElement?.classList.contains('bootstrap-select')) return

  $(select).selectpicker('refresh')
}
