// Hathor-side precision deliberately does NOT live here. It is per token, in
// `hathor.decimals` in config/tokens.ts, so that adding a token with a different
// precision needs no code change. A constant here would just become the second,
// competing source of truth that this refactor removed.

/**
 * The Read API always reports `amount` scaled to 18 decimals on the wire,
 * whatever the token's own decimals are (USDC is 6). Never format an API amount
 * with the token's decimals.
 */
export const API_AMOUNT_DECIMALS = 18

/** Rows per page in the transaction history tables. */
export const HISTORY_PAGE_SIZE = 6
