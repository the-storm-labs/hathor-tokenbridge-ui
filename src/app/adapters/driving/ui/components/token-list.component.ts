import type { BridgeRoute } from '../../../../domain/model/network'
import { isOnEvm, type Token } from '../../../../domain/model/token'

/**
 * The "Token bridge list" tab: one row per bridgeable token, linking each side
 * to its own explorer.
 *
 * First component of phase 8, and the smallest one on purpose — it fixes the
 * shape the rest follow. Two pieces:
 *
 *  - a **pure** function from data to markup, which is what the tests exercise;
 *  - a `mount` that finds the element and writes into it, and is the only part
 *    that touches the DOM.
 *
 * The legacy version read four globals (`SEPOLIA_CONFIG`, `ETH_CONFIG`,
 * `isTestnet`, `TOKENS`) and re-derived the deployment itself, in a variable
 * named `htrConfig` that in fact held the *EVM* config. The route is now passed
 * in, so which network is on which side is decided by the caller and stated by
 * the types.
 */

/** Renders the whole tab: a header naming both networks, then the token rows. */
export function tokenListMarkup(tokens: readonly Token[], route: BridgeRoute): string {
  const header = headerRow(route.evm.name, route.hathor.name)
  // Only tokens that exist on this deployment's EVM chain can be crossed, which
  // is why SLT7 and HTOG3 do not appear on mainnet.
  const rows = tokens.filter(isOnEvm).map((token) => tokenRow(token, route))

  return [header, ...rows].join('\n')
}

/**
 * Writes the list into `#tokenListTab`.
 *
 * Renders once: the table is static configuration, so there is nothing to
 * subscribe to. It is safe to call before `DOMContentLoaded` — a `type="module"`
 * script runs after the document is parsed, so the element already exists.
 */
export function mountTokenList(
  root: Document,
  tokens: readonly Token[],
  route: BridgeRoute,
): void {
  const element = root.getElementById('tokenListTab')
  if (!element) return

  element.innerHTML = tokenListMarkup(tokens, route)
}

function headerRow(evmName: string, hathorName: string): string {
  return `<div class="row mb-3 justify-content-center text-center">
    <div class="col-5">${evmName}</div>
    <div class="col-1" style="min-width:56px;"></div>
    <div class="col-5">${hathorName}</div>
</div>`
}

function tokenRow(token: Token & { evm: NonNullable<Token['evm']> }, route: BridgeRoute): string {
  const evmUrl = `${route.evm.explorer}/address/${token.evm.address.toLowerCase()}`
  // Hathor's explorer names its token page in the route config
  // (`token_detail`), because the EVM explorers use a fragment instead.
  const hathorUrl =
    `${route.hathor.explorer}/${route.hathor.explorerTokenTab}/` +
    token.hathor.pureHtrAddress.toLowerCase()

  return `<div class="row mb-3 justify-content-center text-center">
    ${tokenCell(evmUrl, token.icon, token.evm.symbol)}
    <div class="col-2 text-center">
        <i class="fas fa-arrows-alt-h"></i>
    </div>
    ${tokenCell(hathorUrl, token.icon, token.hathor.symbol)}
</div>`
}

function tokenCell(url: string, icon: string, symbol: string): string {
  return `<div class="col-5 row">
      <div class="col-12 font-weight-bold">
          <a href="${url}" class="address" target="_blank">
            <span><img src="${icon}" class="token-logo"></span>${symbol}
          </a>
       </div>
    </div>`
}
