// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mountTokenSelect, type TokenSelect } from './token-select.component'

const OPTIONS = [
  { value: 'USDC', label: 'USDC', icon: './usdc.png' },
  { value: 'aHTR', label: 'aHTR', icon: './htr.png' },
  { value: 'SLT7', label: 'SLT7', icon: './slt.png' },
]

let widget: TokenSelect

beforeEach(() => {
  document.body.innerHTML = '<label for="t">Select token</label><select id="t"></select>'
  widget = mountTokenSelect(document, 't', 'Select token')!
  widget.setOptions(OPTIONS)
})

const select = () => document.getElementById('t') as HTMLSelectElement
const toggle = () => document.querySelector('.token-select-toggle') as HTMLButtonElement
const menu = () => document.querySelector('.token-select-menu') as HTMLUListElement
const items = () => [...menu().querySelectorAll<HTMLElement>('[data-value]')]

describe('the native control', () => {
  it('stays in the DOM and stays authoritative', () => {
    // The value has to live in exactly one place, and it has to be the one the
    // rest of the app already reads.
    expect(select().isConnected).toBe(true)
    expect([...select().options].map((o) => o.value)).toEqual(['USDC', 'aHTR', 'SLT7'])
  })

  it('keeps its id, so the label still points at a real control', () => {
    expect(document.querySelector('label')!.htmlFor).toBe('t')
    expect(select().id).toBe('t')
  })
})

describe('choosing an option', () => {
  it('writes through to the select and fires a native change', () => {
    // Every listener in the app is bound to the select, not to this widget.
    const heard = vi.fn()
    select().addEventListener('change', heard)

    toggle().click()
    items()[1]!.click()

    expect(select().value).toBe('aHTR')
    expect(heard).toHaveBeenCalledOnce()
  })

  it('shows the chosen token, with its icon, and closes', () => {
    toggle().click()
    items()[1]!.click()

    expect(toggle().textContent).toContain('aHTR')
    expect(toggle().querySelector('img')?.getAttribute('src')).toBe('./htr.png')
    expect(menu().hidden).toBe(true)
  })

  it('shows the placeholder while nothing is chosen', () => {
    document.body.innerHTML = '<select id="t"></select>'
    const empty = mountTokenSelect(document, 't', 'Select token')!
    empty.setOptions([])

    expect(toggle().textContent).toBe('Select token')
  })
})

describe('the icons, which are the whole reason this exists', () => {
  it('renders one per option — a native <option> cannot hold an image', () => {
    toggle().click()
    expect(menu().querySelectorAll('img.token-logo')).toHaveLength(3)
  })
})

describe('keyboard', () => {
  const key = (target: HTMLElement, k: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))

  it('opens on Enter and lands on the selected option', () => {
    select().value = 'SLT7'
    widget.render()

    key(toggle(), 'Enter')

    expect(menu().hidden).toBe(false)
    expect(document.activeElement).toBe(items()[2])
  })

  it('moves with the arrows and stops at the ends', () => {
    key(toggle(), 'ArrowDown')
    key(menu(), 'ArrowDown')
    expect(document.activeElement).toBe(items()[1])

    key(menu(), 'ArrowUp')
    key(menu(), 'ArrowUp')
    expect(document.activeElement).toBe(items()[0])
  })

  it('jumps to the ends with Home and End', () => {
    key(toggle(), 'Enter')
    key(menu(), 'End')
    expect(document.activeElement).toBe(items()[2])

    key(menu(), 'Home')
    expect(document.activeElement).toBe(items()[0])
  })

  it('picks with Enter', () => {
    key(toggle(), 'ArrowDown')
    key(menu(), 'ArrowDown')
    key(menu(), 'Enter')

    expect(select().value).toBe('aHTR')
    expect(menu().hidden).toBe(true)
  })

  it('closes on Escape and gives focus back to the button', () => {
    key(toggle(), 'Enter')
    key(menu(), 'Escape')

    expect(menu().hidden).toBe(true)
    expect(document.activeElement).toBe(toggle())
  })
})

describe('closing', () => {
  it('closes on a click anywhere else', () => {
    toggle().click()
    expect(menu().hidden).toBe(false)

    document.body.click()
    expect(menu().hidden).toBe(true)
  })
})

describe('disabling', () => {
  it('disables both halves and shuts the menu', () => {
    toggle().click()
    widget.setDisabled(true)

    expect(select().disabled).toBe(true)
    expect(toggle().disabled).toBe(true)
    expect(menu().hidden).toBe(true)
  })
})

describe('a page without the select', () => {
  it('mounts nothing rather than throwing', () => {
    document.body.innerHTML = ''
    expect(mountTokenSelect(document, 'missing', 'Select token')).toBeNull()
  })
})
