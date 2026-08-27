/**
 * Extracting a displayable string from a caught value, for the toasts and
 * inline error text every form component shows.
 *
 * Not every rejection is an `Error`. WalletConnect's JSON-RPC provider rejects
 * a request with the bare `{ code, message }` error object straight off the
 * wire — see `isJsonRpcError(n) ? o(n.error) : ...` in
 * `@walletconnect/jsonrpc-provider` — and EIP-1193 wallets (MetaMask and
 * friends) do the same when the user declines: `{ code: 4001, message: 'User
 * rejected the request.' }`. Neither is an `Error` instance, so falling
 * through to `String(error)` on either turned "you said no" into the toast
 * literally reading `[object Object]`.
 */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isMessageLike(error)) return error.message
  return String(error)
}

function isMessageLike(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  )
}
