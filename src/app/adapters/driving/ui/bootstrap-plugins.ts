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

/**
 * Turns every `.selectpicker` on the page into a bootstrap-select widget.
 *
 * Called once, **after** the components have filled their dropdowns: the plugin
 * copies the options it finds into its own markup, so initialising it first
 * would produce an empty widget over a populated `<select>`. This is the one
 * ordering constraint the ready block used to enforce, and the reason it is
 * called last in mountUi.
 */
export function initSelectpickers(root: Document): void {
  if (!hasJQuery()) return

  for (const select of root.querySelectorAll<HTMLSelectElement>('select.selectpicker')) {
    $(select).selectpicker()
  }
}

/**
 * Subscribes to a `change` that a jQuery plugin may be the one raising.
 *
 * The reason this exists: **a jQuery-triggered event does not reach
 * `addEventListener`.** `$(el).trigger('change')` runs jQuery's own handler list
 * and, for a type with no matching native method, dispatches nothing. Binding
 * through jQuery instead catches both — jQuery registers a real listener, so
 * native changes arrive too, and there is no double fire.
 *
 * bootstrap-select 1.13 does call `triggerNative`, so its dropdowns would work
 * either way; Bootstrap's button-group toggle does not. Going through here
 * everywhere means no call site has to know which is which.
 */
export function onChange(element: HTMLElement, handler: () => void): void {
  if (!hasJQuery()) {
    element.addEventListener('change', () => handler())
    return
  }

  $(element).on('change', () => handler())
}

/**
 * Subscribes to the selected radio of a Bootstrap button-group toggle.
 *
 * This one genuinely cannot use `addEventListener`: the plugin calls
 * `preventDefault()` on the click, so the radio is never activated natively,
 * then assigns `input.checked` itself — which raises no event — and triggers a
 * jQuery `change`.
 */
export function onRadioToggle(container: HTMLElement, handler: (value: string) => void): void {
  const read = (target: EventTarget | null) => {
    const input = target as HTMLInputElement | null
    if (input?.type === 'radio') handler(input.value)
  }

  if (!hasJQuery()) {
    container.addEventListener('change', (event) => read(event.target))
    return
  }

  $(container).on('change', 'input[type=radio]', (event) => read(event.target))
}

export function showModal(element: HTMLElement): void {
  if (!hasJQuery()) return
  $(element).modal('show')
}

export function hideModal(element: HTMLElement): void {
  if (!hasJQuery()) return
  $(element).modal('hide')
}
