/**
 * The wallet address menus: click the connected address to reveal "Copy
 * address" and "Disconnect", instead of a lone "×" sitting next to it.
 *
 * Unlike modal.ts's dialog, this has no backdrop — it closes on a click
 * anywhere outside the panel (or another click on the trigger) and on
 * Escape, the way every other account menu on the web behaves. There is only
 * ever one of these open at a time in practice, but nothing here assumes
 * that: each call wires its own trigger/panel pair independently.
 */
export interface Popover {
  readonly isOpen: () => boolean
  readonly close: () => void
}

export function bindPopover(
  trigger: HTMLElement,
  panel: HTMLElement,
  options: { readonly onClose?: () => void } = {},
): Popover {
  const isOpen = () => panel.style.display !== 'none'

  const close = () => {
    if (!isOpen()) return
    panel.style.display = 'none'
    trigger.setAttribute('aria-expanded', 'false')
    options.onClose?.()
  }

  const open = () => {
    panel.style.display = 'block'
    trigger.setAttribute('aria-expanded', 'true')
  }

  trigger.addEventListener('click', (event) => {
    // Stops the same click from immediately reaching the document listener
    // below and closing what this just opened.
    event.stopPropagation()
    if (isOpen()) close()
    else open()
  })

  const document = panel.ownerDocument
  document.addEventListener('click', (event) => {
    if (!isOpen()) return
    const target = event.target as Node | null
    if (target && panel.contains(target)) return
    close()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) close()
  })

  return { isOpen, close }
}
