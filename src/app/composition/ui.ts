import type { Container } from './container'
import { tokensFor } from '../config/tokens'
import { mountTokenList } from '../adapters/driving/ui/components/token-list.component'

/**
 * Mounts the driving adapters — the components that own a piece of the page.
 *
 * The counterpart of container.ts: that one decides which adapter satisfies
 * which driven port, this one decides which component owns which part of the
 * DOM. It grows as phase 8 moves markup out of js/index.js, and when the last
 * component lands here the legacy script and its shim are deleted.
 *
 * Called from a `type="module"` script, which runs after the document is parsed
 * and before `DOMContentLoaded` — so every element already exists, and every
 * component is mounted before jQuery's ready block runs.
 */
export function mountUi(container: Container, root: Document): void {
  mountTokenList(root, tokensFor(container.deployment), container.route)
}
