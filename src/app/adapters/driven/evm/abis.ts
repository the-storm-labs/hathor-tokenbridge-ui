import bridgeAbi from '../../../../abis/bridge.json'
import allowTokensAbi from '../../../../abis/allowtokens.json'
import erc20Abi from '../../../../abis/erc20.json'
import federationAbi from '../../../../abis/federation.json'

/**
 * Contract ABIs, imported statically so Vite inlines them into the bundle.
 *
 * This replaces four fire-and-forget `fetch('../abis/*.json')` calls that had no
 * await and no ready signal. That was a real race: `updateNetwork` constructs
 * `new web3.eth.Contract(BRIDGE_ABI, ...)`, and on a fast auto-reconnect it
 * could run while `BRIDGE_ABI` was still `undefined`. The race is now
 * structurally impossible rather than merely unlikely — the module graph is
 * evaluated before any of this code can run, so there is no window in which an
 * ABI is missing.
 *
 * It also removes a fragile path: `../abis/` was resolved against the document
 * URL and only worked because it clamped at the site root.
 */
export const ABIS = {
  bridge: bridgeAbi as readonly AbiItem[],
  allowTokens: allowTokensAbi as readonly AbiItem[],
  erc20: erc20Abi as readonly AbiItem[],
  federation: federationAbi as readonly AbiItem[],
} as const
