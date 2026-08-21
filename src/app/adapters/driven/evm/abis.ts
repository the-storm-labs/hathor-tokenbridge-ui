import type { Abi } from 'viem'
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
 *
 * Cast to viem's `Abi` rather than declared `as const`: these are JSON imports,
 * so viem cannot infer argument or return types from them, and every call site
 * narrows what comes back. Pretending otherwise is how a wrong type gets
 * trusted.
 */
export const ABIS = {
  bridge: bridgeAbi as Abi,
  allowTokens: allowTokensAbi as Abi,
  erc20: erc20Abi as Abi,
  federation: federationAbi as Abi,
} as const
