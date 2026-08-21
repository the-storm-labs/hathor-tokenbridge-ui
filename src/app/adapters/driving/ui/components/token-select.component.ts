/**
 * The token dropdown, with an icon per option.
 *
 * This exists because a native `<option>` cannot contain an image, and the
 * dropdowns are the one place in the app where the token logo is the fastest
 * way to read the row. It is the whole reason bootstrap-select — and therefore
 * jQuery, Popper and Bootstrap's JS — were on the page.
 *
 * The native `<select>` stays in the DOM and stays authoritative. This paints a
 * button and a listbox over it and writes back through it, so:
 *
 *  - the value lives in exactly one place;
 *  - picking an option fires a **native** `change`, which is what every
 *    listener in the app is bound to;
 *  - the form still has a real form control, with its name and its label.
 *
 * Keyboard behaviour is the part a custom widget usually loses, so it is
 * implemented rather than approximated: the button opens on Enter, Space or
 * either arrow, and the open listbox handles Up/Down/Home/End/Escape/Tab.
 */

const OPEN_KEYS = new Set(['Enter', ' ', 'ArrowDown', 'ArrowUp'])

export interface TokenSelectOption {
  readonly value: string
  readonly label: string
  readonly icon: string
}

export class TokenSelect {
  private readonly root: HTMLElement
  private readonly toggle: HTMLButtonElement
  private readonly menu: HTMLUListElement
  private options: readonly TokenSelectOption[] = []
  /** Index the keyboard is on, which is not yet the selected one. */
  private active = -1

  constructor(
    private readonly select: HTMLSelectElement,
    private readonly placeholder: string,
  ) {
    const document = select.ownerDocument

    this.root = document.createElement('div')
    this.root.className = 'token-select'

    this.toggle = document.createElement('button')
    this.toggle.type = 'button'
    this.toggle.className = 'token-select-toggle'
    this.toggle.setAttribute('aria-haspopup', 'listbox')
    this.toggle.setAttribute('aria-expanded', 'false')

    this.menu = document.createElement('ul')
    this.menu.className = 'token-select-menu'
    this.menu.setAttribute('role', 'listbox')
    this.menu.hidden = true

    // The native control keeps its id and name for the label and the form; it
    // is only hidden from sight, never removed.
    this.select.classList.add('token-select-native')
    this.select.setAttribute('tabindex', '-1')
    this.select.setAttribute('aria-hidden', 'true')

    select.parentElement?.insertBefore(this.root, select)
    this.root.append(this.select, this.toggle, this.menu)
  }

  mount(): void {
    this.toggle.addEventListener('click', () => this.setOpen(this.menu.hidden === true))
    this.toggle.addEventListener('keydown', (event) => {
      if (!OPEN_KEYS.has(event.key)) return
      event.preventDefault()
      this.setOpen(true)
      this.moveTo(event.key === 'ArrowUp' ? this.options.length - 1 : this.selectedIndex())
    })

    this.menu.addEventListener('click', (event) => {
      const item = (event.target as HTMLElement | null)?.closest('[data-value]')
      const value = item?.getAttribute('data-value')
      if (value !== null && value !== undefined) this.choose(value)
    })

    this.menu.addEventListener('keydown', (event) => this.onMenuKey(event))

    // Any click elsewhere closes it. Registered on the document because the
    // point is precisely the clicks this component does not own.
    this.select.ownerDocument.addEventListener('click', (event) => {
      if (!this.root.contains(event.target as Node)) this.setOpen(false)
    })

    this.render()
  }

  /** Replaces the options and repaints. The `<select>` is rebuilt from these. */
  setOptions(options: readonly TokenSelectOption[]): void {
    this.options = options

    this.select.innerHTML = options
      .map((option) => `<option value="${option.value}">${option.label}</option>`)
      .join('')

    this.render()
  }

  /** Reflects the native control's disabled state onto the widget. */
  setDisabled(disabled: boolean): void {
    this.select.disabled = disabled
    this.toggle.disabled = disabled
    this.root.classList.toggle('disabled', disabled)
    if (disabled) this.setOpen(false)
  }

  /** Repaints from the `<select>`, for when something else changed its value. */
  render(): void {
    const selected = this.options.find((option) => option.value === this.select.value)

    this.toggle.innerHTML = selected
      ? `<img src="${selected.icon}" class="token-logo" alt="">${selected.label}`
      : this.placeholder
    this.toggle.classList.toggle('is-placeholder', !selected)

    this.menu.innerHTML = this.options
      .map(
        (option) =>
          `<li role="option" tabindex="-1" data-value="${option.value}"` +
          ` class="token-select-item${option.value === this.select.value ? ' active' : ''}"` +
          ` aria-selected="${option.value === this.select.value}">` +
          `<img src="${option.icon}" class="token-logo" alt="">${option.label}</li>`,
      )
      .join('')
  }

  private choose(value: string): void {
    this.select.value = value
    this.render()
    this.setOpen(false)
    this.toggle.focus()

    // Native and bubbling: every listener in the app is bound to the `<select>`,
    // not to this widget, so this is the only thing that has to be right for the
    // rest of the page to notice.
    this.select.dispatchEvent(new Event('change', { bubbles: true }))
  }

  private setOpen(open: boolean): void {
    this.menu.hidden = !open
    this.root.classList.toggle('open', open)
    this.toggle.setAttribute('aria-expanded', String(open))
    if (!open) this.active = -1
  }

  private onMenuKey(event: KeyboardEvent): void {
    const last = this.options.length - 1

    switch (event.key) {
      case 'ArrowDown':
        this.moveTo(Math.min(this.active + 1, last))
        break
      case 'ArrowUp':
        this.moveTo(Math.max(this.active - 1, 0))
        break
      case 'Home':
        this.moveTo(0)
        break
      case 'End':
        this.moveTo(last)
        break
      case 'Enter':
      case ' ': {
        const option = this.options[this.active]
        if (option) this.choose(option.value)
        break
      }
      case 'Escape':
      case 'Tab':
        this.setOpen(false)
        if (event.key === 'Escape') this.toggle.focus()
        return
      default:
        return
    }

    event.preventDefault()
  }

  private moveTo(index: number): void {
    if (index < 0 || index > this.options.length - 1) return

    this.active = index
    const item = this.menu.children[index]
    if (item instanceof HTMLElement) item.focus()
  }

  private selectedIndex(): number {
    const index = this.options.findIndex((option) => option.value === this.select.value)
    return index === -1 ? 0 : index
  }
}

/**
 * Upgrades a `<select>` into a {@link TokenSelect}, or returns null when the
 * page does not have it.
 */
export function mountTokenSelect(
  root: Document,
  id: string,
  placeholder: string,
): TokenSelect | null {
  const select = root.getElementById(id)
  if (!(select instanceof HTMLSelectElement)) return null

  const widget = new TokenSelect(select, placeholder)
  widget.mount()
  return widget
}
