import type { BridgeRoute } from '../../../../domain/model/network'
import {
  formatFeeRate,
  type BridgeParameters,
} from '../../../../application/use-cases/load-bridge-parameters'

/**
 * The "Important details" panel: the bridge's operating parameters.
 *
 * Replaces setInfoTab, which mixed three contract calls, five global writes and
 * eight DOM writes in one function. The contract half is the
 * loadBridgeParameters use case; what is left here is presentation.
 *
 * Two of the eight writes had no element to land in — `#fee` and
 * `#config-federators-required` — and jQuery writes to an empty set silently, so
 * the panel had been quietly missing the federation threshold since the page was
 * rebuilt. `#config-federators-required` now exists in both pages; `#fee` was a
 * duplicate of `#config-fee` and is gone.
 */

export interface InfoPanelDeps {
  /** Reads the parameters for one token; limits are configured per token. */
  readonly loadParameters: (tokenAddress: string) => Promise<BridgeParameters>
  readonly route: BridgeRoute
}

/** Panel field id → the value to write into it. */
type Fields = Readonly<Record<string, string>>

export class InfoPanel {
  constructor(
    private readonly write: (id: string, value: string) => void,
    private readonly deps: InfoPanelDeps,
  ) {}

  /**
   * The values that do not depend on a connected wallet.
   *
   * The crossing period is route configuration, but it used to be written only
   * by setInfoTab — so it showed a dash until a token was selected, which needs
   * a wallet. It is known at load, so it is shown at load.
   */
  renderStatic(): void {
    this.render({ 'config-whitelisted-enabled': this.deps.route.hathor.confirmationTime })
  }

  /**
   * Reloads the parameters for `tokenAddress` and repaints.
   *
   * Failures are logged, not surfaced: this panel is informational, and the
   * original swallowed them too. What must not happen is a rejected promise
   * escaping into the token-change handler that calls this.
   */
  async refresh(tokenAddress: string): Promise<BridgeParameters | null> {
    try {
      const parameters = await this.deps.loadParameters(tokenAddress)
      this.render(fieldsFor(parameters))
      return parameters
    } catch (error) {
      console.error('Error loading the bridge parameters', error)
      return null
    }
  }

  private render(fields: Fields): void {
    for (const [id, value] of Object.entries(fields)) this.write(id, value)
  }
}

function fieldsFor(parameters: BridgeParameters): Fields {
  return {
    'config-min': parameters.minTokensAllowed.toLocaleString(),
    'config-max': parameters.maxTokensAllowed.toLocaleString(),
    'config-to-spend': parameters.maxDailyLimit.toLocaleString(),
    'config-fee': formatFeeRate(parameters.feeRate),
    'config-federators-count': String(parameters.federatorCount),
    'config-federators-required': String(parameters.federatorsRequired),
  }
}

/** Binds the panel to the page and paints what is already known. */
export function mountInfoPanel(root: Document, deps: InfoPanelDeps): InfoPanel {
  const panel = new InfoPanel((id, value) => {
    const element = root.getElementById(id)
    if (element) element.textContent = value
  }, deps)

  panel.renderStatic()
  return panel
}
