/**
 * The header's light/dark switch.
 *
 * Dark is the default and the look the stylesheets have always had; light-theme.css applies only
 * while `<html data-theme="light">`. The choice is the visitor's and lives in localStorage, read
 * once by `applyStoredTheme` at the very top of main.ts - before the container is built - so the
 * page switches before anything else renders. Storage can be unavailable (private mode, blocked
 * cookies); then the toggle still works for the page's lifetime and nothing throws.
 */

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'bridge.theme'

const LABEL: Record<Theme, { icon: string; title: string }> = {
  // The icon shows where a click takes you, not where you are.
  dark: { icon: '☀', title: 'Switch to the light theme' },
  light: { icon: '☾', title: 'Switch to the dark theme' },
}

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>

function storageOf(view: Window | null): ThemeStorage | null {
  try {
    return view?.localStorage ?? null
  } catch {
    return null
  }
}

export function readTheme(storage: ThemeStorage | null): Theme {
  try {
    return storage?.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(root: Document, theme: Theme): void {
  if (theme === 'light') root.documentElement.setAttribute('data-theme', 'light')
  else root.documentElement.removeAttribute('data-theme')
}

/** Called first thing in main.ts, so a light-theme visitor does not see the page paint dark. */
export function applyStoredTheme(root: Document): void {
  applyTheme(root, readTheme(storageOf(root.defaultView)))
}

export function mountThemeToggle(root: Document, storage = storageOf(root.defaultView)): void {
  const button = root.getElementById('themeToggle')
  if (!button) return

  let theme = readTheme(storage)
  const render = () => {
    applyTheme(root, theme)
    button.textContent = LABEL[theme].icon
    button.setAttribute('title', LABEL[theme].title)
    button.setAttribute('aria-label', LABEL[theme].title)
  }

  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark'
    try {
      storage?.setItem(STORAGE_KEY, theme)
    } catch {
      // Not persisted; still switched for this visit.
    }
    render()
  })
  render()
}
