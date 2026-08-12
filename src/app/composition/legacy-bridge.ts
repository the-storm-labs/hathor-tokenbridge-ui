import { ROUTES } from '../config/networks'
import type { Container } from './container'
import { truncateMiddle } from '../domain/tx-id'
import { ABIS } from '../adapters/driven/evm/abis'
import type { BridgeRoute } from '../domain/model/network'
import type { Deployment } from '../domain/model/deployment'
import type { UseCases } from './use-cases'
import type { MountedUi } from './ui'
import { routeForChainId } from '../config/networks'
import type { Store } from '../application/state/store'
import type { AppState } from '../application/state/app-state'

/**
 * Temporary bridge between the new module graph and the legacy classic script.
 *
 * Why this works: classic scripts run in document order, `type="module"` scripts
 * are deferred and run after all of them but before DOMContentLoaded, and jQuery's
 * `$(document).ready` fires on DOMContentLoaded. So everything published here is
 * visible to every function body in js/index.js, including its whole ready block.
 *
 * The one rule that must be obeyed: a top-level `let`/`const`/`function` in a
 * classic script creates a *script-scope* binding that shadows the same-named
 * window property. Publishing `window.X` while `function X` still exists in
 * index.js does nothing. **Every symbol added here must have its declaration
 * deleted from index.js in the same commit.**
 *
 * This file grows through the migration and is deleted with js/index.js.
 */

/**
 * Rebuilds the circular config pair the legacy code reads as `config` and
 * `config.crossToNetwork`.
 *
 * The cycle now exists in exactly one function, at the boundary, for a bounded
 * time — it dies with this file.
 */
function toLegacyConfigs(route: BridgeRoute): { evm: object; hathor: object } {
  const evm: Record<string, unknown> = { ...route.evm, networkId: route.evm.chainId }
  const hathor: Record<string, unknown> = { ...route.hathor, crossToNetwork: evm }
  evm['crossToNetwork'] = hathor
  return { evm, hathor }
}

/**
 * Legacy global name → AppState key, for every mutable global that used to be
 * declared at the top of js/index.js.
 *
 * **This table is the safety contract of this phase.** A global whose
 * declaration is deleted from index.js without an entry here becomes an implicit
 * global on its first write and a ReferenceError on its first read — and the
 * failure may only show up on a rare path like `accountsChanged`. Reviewing this
 * list against index.js's old declarations is the check that matters.
 *
 * The list shrinks as components take ownership of their own state. What is
 * left is the four contract instances, which index.js constructs on a network
 * switch and the driven adapters build for themselves — they go with the
 * network component, and then this table is empty.
 */
const STATE_ALIASES = {
  address: 'evmAddress',

  bridgeContract: 'bridgeContract',
  allowTokensContract: 'allowTokensContract',
  federationContract: 'federationContract',
  tokenContract: 'tokenContract',
} as const satisfies Record<string, keyof AppState>

/**
 * Publishes each state slice as a `window` accessor.
 *
 * This is what makes a half-migrated app coherent rather than merely working. A
 * plain value on `window` would be readable by index.js, but its writes would go
 * nowhere the new code can see. With an accessor, `config = null` in a legacy
 * function *is* a store mutation, and anything subscribed to the store observes
 * it.
 */
function bindStateAccessors(
  store: Store<AppState>,
  deployment: Deployment,
  legacyConfigForRoute: LegacyConfigLookup,
): void {
  for (const [legacyName, stateKey] of Object.entries(STATE_ALIASES)) {
    Object.defineProperty(window, legacyName, {
      configurable: true,
      get: () => store.getState()[stateKey as keyof AppState],
      set: (value: unknown) => store.patch({ [stateKey]: value } as unknown as Partial<AppState>),
    })
  }

  // `config` is the one alias that needs translation in both directions: the
  // store holds a typed, acyclic BridgeRoute while index.js expects the legacy
  // object with its `crossToNetwork` cycle.
  Object.defineProperty(window, 'config', {
    configurable: true,
    get: () => {
      const route = store.getState().route
      return route ? legacyConfigForRoute(route) : null
    },
    set: (value: { networkId?: number } | null) => {
      // Legacy code only ever assigns null or one of the EVM config objects
      // this file produced, so the chain id round-trips back to its route.
      // The deployment comes from the page, not from the current route — the
      // route is null exactly when this is first assigned.
      const route = value?.networkId ? routeForChainId(value.networkId, deployment) : null
      store.patch({ route })
    },
  })
}

type LegacyConfigLookup = (route: BridgeRoute) => object

export function installLegacyBridge(
  container: Container,
  useCases: UseCases,
  ui: MountedUi,
): void {
  const deployment = container.deployment
  const route = ROUTES[deployment]
  const legacyConfigs = toLegacyConfigs(route)
  const otherRoute = ROUTES[deployment === 'mainnet' ? 'testnet' : 'mainnet']
  const otherConfigs = toLegacyConfigs(otherRoute)

  const mainnetConfigs = deployment === 'mainnet' ? legacyConfigs : otherConfigs
  const testnetConfigs = deployment === 'testnet' ? legacyConfigs : otherConfigs

  // Memoised: `config` is read on the order of forty times per render, some of
  // them inside row loops, and rebuilding the cyclic object each time would be
  // both wasteful and a source of surprising identity mismatches.
  const legacyConfigForRoute = (candidate: BridgeRoute): object =>
    candidate.deployment === deployment ? legacyConfigs.evm : otherConfigs.evm

  bindStateAccessors(container.store, deployment, legacyConfigForRoute)

  // Toasts own their own dismissal timers, so index.js shows and hides by id
  // instead of calling .show()/.hide() on the elements directly.
  const toasts = ui.toasts

  Object.assign(window, {
    // --- config, in the shape index.js still reads ---
    ETH_CONFIG: mainnetConfigs.evm,
    SEPOLIA_CONFIG: testnetConfigs.evm,

    isTestnet: deployment === 'testnet',

    // --- ABIs, now guaranteed present before any contract is constructed ---
    BRIDGE_ABI: ABIS.bridge,
    ALLOW_TOKENS_ABI: ABIS.allowTokens,
    FEDERATION_ABI: ABIS.federation,

    // --- the one pure helper index.js still calls under its original name ---
    truncateMiddle,

    __useCases: useCases,

    // The components index.js still has to drive, until the forms around them
    // are components too.
    __ui: {
      toast: {
        show: (id: string, options?: { autoDismiss?: boolean }) => toasts.show(id, options),
        hide: (id: string) => toasts.hide(id),
      },
      history: ui.history,
      crossForm: ui.crossForm,
    },
  })
}
