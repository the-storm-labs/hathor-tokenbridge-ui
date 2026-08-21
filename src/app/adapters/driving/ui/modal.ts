/**
 * Showing and hiding the one modal on the page.
 *
 * Bootstrap's modal plugin did this, and it was the last thing keeping
 * Bootstrap's JS — and therefore jQuery and Popper — on the page. Its CSS is
 * still what styles the dialog; only the four class toggles it performed are
 * reimplemented here.
 *
 * The backdrop is created and removed rather than left in the DOM, which is
 * what the plugin did too: a permanent `.modal-backdrop` swallows every click
 * on the page behind it.
 */

const BACKDROP_ID = 'modal-backdrop'

export function showModal(modal: HTMLElement): void {
  const document = modal.ownerDocument

  modal.classList.add('show')
  modal.style.display = 'block'
  modal.removeAttribute('aria-hidden')
  document.body.classList.add('modal-open')

  if (!document.getElementById(BACKDROP_ID)) {
    const backdrop = document.createElement('div')
    backdrop.id = BACKDROP_ID
    backdrop.className = 'modal-backdrop fade show'
    document.body.append(backdrop)
  }
}

export function hideModal(modal: HTMLElement): void {
  const document = modal.ownerDocument

  modal.classList.remove('show')
  modal.style.display = 'none'
  modal.setAttribute('aria-hidden', 'true')
  document.body.classList.remove('modal-open')
  document.getElementById(BACKDROP_ID)?.remove()
}

/**
 * Wires the ways a modal closes: its own dismiss buttons, a click on the
 * backdrop area, and Escape.
 *
 * All three came free with the plugin, and losing any of them leaves a dialog
 * the user cannot get out of.
 */
export function bindModalDismiss(modal: HTMLElement): void {
  modal.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    // The modal element itself is the scrollable area around the dialog, so a
    // click landing on it — rather than inside .modal-dialog — is a click out.
    if (target === modal || target?.closest('[data-dismiss="modal"]')) hideModal(modal)
  })

  modal.ownerDocument.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('show')) hideModal(modal)
  })
}
