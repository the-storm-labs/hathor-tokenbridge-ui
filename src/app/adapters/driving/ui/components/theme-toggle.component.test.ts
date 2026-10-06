// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { applyStoredTheme, mountThemeToggle, readTheme } from './theme-toggle.component'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme')
  document.body.innerHTML = '<button id="themeToggle" type="button"></button>'
})

describe('theme toggle', () => {
  it('defaults to dark, the look the page has always had', () => {
    mountThemeToggle(document, memoryStorage())
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(document.getElementById('themeToggle')!.getAttribute('title')).toBe(
      'Switch to the light theme',
    )
  })

  it('switches to light and back, and remembers the choice', () => {
    const storage = memoryStorage()
    mountThemeToggle(document, storage)
    const button = document.getElementById('themeToggle')!

    button.click()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(storage.data.get('bridge.theme')).toBe('light')
    expect(button.getAttribute('aria-label')).toBe('Switch to the dark theme')

    button.click()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(storage.data.get('bridge.theme')).toBe('dark')
  })

  it('starts in light when that was the last choice', () => {
    mountThemeToggle(document, memoryStorage({ 'bridge.theme': 'light' }))
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('still switches when storage throws (private mode, blocked storage)', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readTheme(broken)).toBe('dark')
    mountThemeToggle(document, broken)
    document.getElementById('themeToggle')!.click()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('applies a stored choice before any component mounts', () => {
    window.localStorage.setItem('bridge.theme', 'light')
    applyStoredTheme(document)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    window.localStorage.removeItem('bridge.theme')
  })
})
