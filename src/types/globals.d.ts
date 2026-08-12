/**
 * Ambient declarations for the libraries loaded from CDN <script> tags.
 *
 * These are hand-rolled on purpose rather than pulled from @types/*:
 *
 *  - The page loads **jquery.slim**, which has no $.ajax and no effects
 *    (.fadeIn, .animate). @types/jquery would type-check code that fails at
 *    runtime, and it is ~10k lines that make jQuery look permanent.
 *
 * Web3, BigNumber, CryptoJS and bs58 have all left; what remains is jQuery and
 * the three Bootstrap plugins, and they are here only because bootstrap-select
 * is. Nothing else on the page is a global.
 *
 * Treat this file as an inventory of our remaining coupling to global scripts.
 * It should only ever shrink.
 */

// ---------------------------------------------------------------------------
// jQuery (slim build) + Bootstrap 4 plugins + bootstrap-select
// Only reachable from adapters/driving/ui/bootstrap-plugins.ts.
// ---------------------------------------------------------------------------

interface JQuery {
  val(): string
  val(value: string): JQuery
  text(): string
  text(value: string): JQuery
  html(): string
  html(value: string): JQuery

  show(): JQuery
  hide(): JQuery
  focus(): JQuery
  empty(): JQuery
  append(content: JQuery | string): JQuery

  css(property: string, value: string): JQuery
  prop(name: string, value: boolean): JQuery
  attr(name: string): string | undefined
  attr(name: string, value: string): JQuery
  removeAttr(name: string): JQuery

  addClass(className: string): JQuery
  removeClass(className: string): JQuery
  hasClass(className: string): boolean
  is(selector: string): boolean

  find(selector: string): JQuery
  each(callback: (index: number, element: HTMLElement) => void): JQuery

  on(events: string, handler: (event: Event) => void): JQuery
  on(events: string, selector: string, handler: (event: Event) => void): JQuery
  off(events?: string): JQuery
  trigger(eventType: string): JQuery

  /** Bootstrap 4 modal plugin. */
  modal(action: 'show' | 'hide'): JQuery
  /** Bootstrap 4 tooltip plugin. */
  tooltip(): JQuery
  /** Bootstrap 4 tab plugin. */
  tab(action: 'show'): JQuery
  /** bootstrap-select plugin. */
  selectpicker(action?: 'refresh'): JQuery
}

declare const $: (selector: string | HTMLElement | Document) => JQuery
