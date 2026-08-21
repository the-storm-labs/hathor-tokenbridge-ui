/**
 * The `.active` class on a Bootstrap button-group toggle.
 *
 * Bootstrap's button plugin did two things to a `data-toggle="buttons"` group:
 * it moved that class between the labels, and it called `preventDefault()` on
 * the click and set `input.checked` itself. Only the first is worth keeping —
 * the second is what stopped a native `change` from ever firing and made every
 * listener on these radios go through jQuery.
 *
 * With the plugin gone the radios behave like radios, so the class is all this
 * has to do.
 */
export function bindButtonGroup(container: HTMLElement): void {
  const paint = () => {
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type=radio]')) {
      input.closest('label')?.classList.toggle('active', input.checked)
    }
  }

  container.addEventListener('change', paint)
  paint()
}
