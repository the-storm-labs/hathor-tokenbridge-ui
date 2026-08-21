import { isOnEvm, isOnHathor, type Token } from './model/token'

/**
 * Finds the token a bridge record refers to.
 *
 * The `originalTokenAddress` of a transfer can be any of three things depending
 * on which side originated it and which side reported it: the Hathor token UID,
 * the EVM token address, or the address of the EVM side-token that mirrors the
 * Hathor one. All three are checked.
 *
 * Ported from findTokenByBridgeAddress, which read the `config` global for the
 * chain ids and would throw outright when nothing was connected.
 */
/**
 * Finds the token a form is talking about.
 *
 * The key is the `<option value>` of both token dropdowns, which is how every
 * write path identifies its token: the UI hands over a string, never an object.
 */
export function findTokenByKey(
  tokens: readonly Token[],
  key: string | null | undefined,
): Token | null {
  if (!key) return null

  return tokens.find((token) => token.key === key) ?? null
}

export function findTokenByBridgeAddress(
  tokens: readonly Token[],
  bridgeAddress: string | null | undefined,
): Token | null {
  if (!bridgeAddress) return null

  const needle = bridgeAddress.toLowerCase()

  return (
    tokens.find((token) => {
      // A token missing from either side cannot be the subject of a transfer.
      if (!isOnEvm(token) || !isOnHathor(token)) return false

      return [token.hathor.hathorAddr, token.evm.address, token.hathor.address]
        .filter(Boolean)
        .some((candidate) => candidate.toLowerCase() === needle)
    }) ?? null
  )
}
