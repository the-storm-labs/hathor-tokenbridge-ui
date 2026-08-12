/**
 * Ambient declarations for the libraries loaded from CDN <script> tags.
 *
 * These are hand-rolled on purpose rather than pulled from @types/*:
 *
 *  - The page loads **jquery.slim**, which has no $.ajax and no effects
 *    (.fadeIn, .animate). @types/jquery would type-check code that fails at
 *    runtime, and it is ~10k lines that make jQuery look permanent.
 *  - Web3 1.x ships typings that are widely known to be wrong; they would fight
 *    `strict`. All Web3 looseness stays confined to web3-contracts.adapter.ts,
 *    which is the point of having a port.
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

// ---------------------------------------------------------------------------
// Web3 1.10.4
// ---------------------------------------------------------------------------

/** Minimal ABI element shape — enough to pass ABIs to the Contract constructor. */
interface AbiItem {
  readonly type: string
  readonly name?: string
  readonly inputs?: readonly unknown[]
  readonly outputs?: readonly unknown[]
  readonly stateMutability?: string
  readonly anonymous?: boolean
  readonly [key: string]: unknown
}

/**
 * Contract calls return `unknown`: Web3 1.x cannot know the return type from the
 * ABI, and pretending otherwise is how wrong types get trusted. Narrow at the
 * adapter boundary.
 */
interface Web3ContractMethod {
  call(options?: { from?: string }): Promise<unknown>
  send(options: { from: string; gasPrice?: string; gas?: number }): Web3SendEmitter
  encodeABI(): string
}

interface Web3SendEmitter extends Promise<Web3TransactionReceipt> {
  on(event: 'transactionHash', handler: (hash: string) => void): Web3SendEmitter
  on(event: 'receipt', handler: (receipt: Web3TransactionReceipt) => void): Web3SendEmitter
  on(event: 'error', handler: (error: Error, receipt?: Web3TransactionReceipt) => void): Web3SendEmitter
}

interface Web3TransactionReceipt {
  status: boolean
  transactionHash: string
  blockNumber: number
  [key: string]: unknown
}

interface Web3Contract {
  readonly methods: Record<string, (...args: readonly unknown[]) => Web3ContractMethod>
}

interface Web3Eth {
  Contract: new (abi: readonly AbiItem[], address: string) => Web3Contract
  net: { getId(): Promise<number> }
  getBlockNumber(): Promise<number>
  getBlock(block: 'latest' | number): Promise<{ minimumGasPrice?: string; number: number }>
  getGasPrice(): Promise<string>
  getTransactionReceipt(txHash: string): Promise<Web3TransactionReceipt | null>
  getAccounts(): Promise<string[]>
}

interface Web3Utils {
  toWei(value: string, unit?: string): string
  fromWei(value: string, unit?: string): string
  keccak256(value: string): string
  BN: new (value: string | number) => { toString(base?: number): string }
}

interface Web3Instance {
  readonly eth: Web3Eth
  readonly utils: Web3Utils
}

declare const Web3: {
  new (provider: unknown): Web3Instance
  readonly utils: Web3Utils
}

// ---------------------------------------------------------------------------
// Small CDN utilities
// ---------------------------------------------------------------------------

declare const ClipboardJS: new (selector: string) => { destroy(): void }

declare const bs58: {
  encode(bytes: Uint8Array | number[]): string
  decode(str: string): Uint8Array
}

declare const CryptoJS: {
  SHA256(message: unknown): { toString(encoder?: unknown): string }
  enc: {
    Hex: { parse(hex: string): unknown; stringify(words: unknown): string }
  }
}
