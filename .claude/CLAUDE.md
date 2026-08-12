# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server at localhost:5173
npm run build    # Build to public/ (Firebase hosting dir)
npm run preview  # Preview the build locally
```

Deploy: `firebase deploy` (deploys `public/` — **always build first**). The `public/` directory is gitignored and rebuilt on every deploy.

There are no tests or linters configured.

## Architecture

### The Two-Script Split

The app is a pure HTML/JS/CSS frontend with no framework. Vite is used only as a bundler.

`src/js/index.js` (~1750 lines) is a **non-module legacy script** loaded via `<script src>`. It uses globals exclusively (`config`, `address`, `web3`, `TOKENS`, etc.) and cannot use `import`/`export`.

`src/js/main.js` is a **Vite ES module entry** (`<script type="module">`). It bundles `@reown/appkit` and `@reown/appkit-universal-connector` and exposes them as `window.ReownAppKit`. It uses a **dynamic `import('./hathor-wallet.js')`** (not a static import) so that `window.ReownAppKit` is assigned before `hathor-wallet.js` executes — static imports are hoisted and would run `hathor-wallet.js` before the assignment.

`src/js/hathor-wallet.js` is the Hathor WalletConnect module. It reads `window.ReownAppKit.UniversalConnector` on init, manages the WalletConnect session, and exposes `window.HathorWallet` for `index.js` to call.

`src/js/bridge-api.js` is another **non-module script** (like `bs58.js`) that exposes `window.BridgeAPI` — the client for the bridge Read API.

### Bridge Read API (`docs/bridge-api.yaml`)

Transaction history and claim state come from a read-only REST API, configured as a **base URL** in `VITE_BRIDGE_API_URL` (env files live in `src/`, see `src/.env.example`).

The UI only uses `GET /transactions-by-receiver?receiver=&limit=&direction=`. `/voted-counts` and `/executed-events` are redundant — vote counts and event fields are already inlined in the transaction records.

Things the API's shape does not make obvious:
- `amount` is always scaled to **18 decimals** on the wire, regardless of the EVM token's own decimals (USDC is 6). Never format it with `token[chainId].decimals`.
- `originTransactionHash` for `hathor_to_evm` is the Hathor tx id but **0x-prefixed**; the wallet and Hathor explorer use the bare 64-char hex. Strip it with `toHathorTxId()`.
- `status: "awaiting_claim"` is **not authoritative** — records already claimed on-chain still report it. `resolveClaimStatus()` re-checks `isClaimed` against the bridge contract before a Claim button is rendered.

### Claim Data Hashes

The bridge computes a claim's data hash from `getTransactionDataHash(to, amount, blockHash, transactionHash, logIndex, originChainId, destinationChainId)`. For Hathor-origin transfers there is no EVM block of their own, so the federation votes with **`blockHash` in both the `blockHash` and `transactionHash` slots**. Both `claimToken()` and `resolveClaimStatus()` must build it that way — verified on-chain against Arbitrum mainnet.

### Entry Points

Two HTML files share the same `index.js`:
- `src/index.html` — Arbitrum One mainnet
- `src/testnet.html` — Sepolia testnet

`isTestnet` is detected in `index.js` via `window.location.href.includes("testnet")`. The testnet URL uses the query param `?testnet` on index.html or the `testnet.html` file directly.

### Token Configuration (`TOKENS` array)

Each token object uses **chain ID as numeric key**:
- `token[42161]` — Arbitrum One data
- `token[11155111]` — Sepolia data
- `token[31]` — Hathor data (`pureHtrAddress` = Hathor token UID, `"00"` for native HTR)

Tokens are defined at the bottom of `index.js`: `USDC_TOKEN`, `EVM_NATIVE_TOKEN`, `HATHOR_NATIVE_TOKEN`, `TOGGER_TOKEN` → `const TOKENS = [...]`.

Network configs (`HTR_MAINNET_CONFIG`, `HTR_TESTNET_CONFIG`) are also in `index.js` and include `bridgeHathorAddress` (the Hathor deposit address for the bridge) which must be filled in.

### Bridge Directions

**ARB→HTR** (original flow): User connects MetaMask/EVM wallet → approves ERC20 → calls bridge contract → federation relays to Hathor.

**HTR→ARB** (newer flow): User connects Hathor wallet via WalletConnect → selects token → sends a Hathor transaction with two outputs: (1) token transfer to `bridgeHathorAddress`, (2) data output encoding the EVM destination address as hex.

### Hathor Wallet Module (`hathor-wallet.js`)

- `connect(isTestnet)` — opens WalletConnect modal, stores address in `localStorage`
- `restoreSession(isTestnet)` — called automatically on page load; checks `universalConnector.provider.session` for a persisted WalletConnect session
- `getBalance(tokenUid, isTestnet)` — asks the connected wallet via the `htr_getBalance` RPC; falls back to summing unspent outputs from the node's `address_history` when the wallet cannot answer
- `sendBridgeTx(...)` — sends `htr_sendTx` via WalletConnect RPC
- `window.HathorWallet` — public API exposed for `index.js`

### Balances

**Do not switch this to the `htr_getBalance` WalletConnect RPC without checking wallet versions first.** The handler only became prompt-free in `@hathor/hathor-rpc-handler` **5.0.0** (npm, 2026-07-01). Every released wallet still ships an older one that pops a confirmation dialog on *every* call — desktop v0.35.0 pins 4.4.0, mobile v0.39.0 pins 4.3.0 — which makes a refreshable balance unusable. This was tried and reverted. `getWalletInformation` is prompt-free on those versions but returns only `{network, address0}`, no balance.

Both wallets pin 5.0.0 on master, so when those releases ship, flip `PREFER_WALLET_RPC_BALANCE` in `hathor-wallet.js`. The RPC path is already written and is the better answer — it reports the whole wallet across every address, not just the one address the UI shows. Params are `{ network, tokens: [uid] }`; **never send `addressIndexes`** (answers `NotImplementedError`). Results come wrapped as `{ type, response: [...] }`, same as `htr_sendTransaction`. Spec: [openrpc.json](https://github.com/HathorNetwork/hathor-rpc-lib/blob/master/docs/openrpc.json).

Until then the balance is derived from the full node. **The node's `/v1a/thin_wallet/address_balance` endpoint is dead** — public nodes return 403 (Google LB, not CORS; curl gets the same). Same for `explorer-service`'s `node_api/` proxy. So `getBalanceFromHistory()` sums unspent outputs from `/v1a/thin_wallet/address_history?addresses[]=`, which is still open. Four things it has to get right, all of them load-bearing: skip voided txs; skip authority outputs (`token_data & 0x80`); filter outputs down to our own address (history returns whole txs, so most outputs are counterparties'); count timelocked outputs as `locked`. Then follow `has_more`/`first_hash` pagination (150 txs/page).

`explorer-service.hathor.network/address/balance?address=&token=` returns the same numbers in one call and is the oracle to verify `getBalanceFromHistory()` against — but its CORS allowlist is `*.hathor.network` only, so it is unusable from the browser without a server-side proxy. Proxying it through the bridge Read API is the durable fix if the node blocks `address_history` too.

### Vite Build Config

Root is `src/`. Output is `../public/`. Two HTML entry points (`index.html`, `testnet.html`). All CDN libraries (jQuery, Bootstrap, Web3.js, Luxon, etc.) are loaded via `<script>` tags in the HTML — they are **not** npm packages and not bundled by Vite.

Vite only processes `type="module"` scripts, so the non-module scripts and the `abis/` json fetched at runtime are **not** emitted by the bundler. The `copy-legacy-assets` plugin in `vite.config.js` copies `src/js/*` (minus the bundled `main.js` / `hathor-wallet.js`), `src/abis/`, and `src/txns-storage.js` into the output. Without it the deployed site 404s on `js/index.js`.

### Values Still Needing Configuration

- `REOWN_PROJECT_ID` in `hathor-wallet.js` — get from cloud.reown.com
- `VITE_BRIDGE_API_URL` — no testnet deployment of the Read API is known; `testnet.html` currently points at the same base URL as mainnet
