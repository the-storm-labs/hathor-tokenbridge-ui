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
- `getBalance(tokenUid, isTestnet)` — fetches balance directly from the Hathor full node API (`GET /v1a/thin_wallet/address_balance?address=...`), no active WC session needed
- `sendBridgeTx(...)` — sends `htr_sendTx` via WalletConnect RPC
- `window.HathorWallet` — public API exposed for `index.js`

### Hathor Node API

Balance endpoint: `https://node1.{mainnet|testnet}.hathor.network/v1a/thin_wallet/address_balance?address={address}`
Response: `{ success, tokens_data: { [uid]: { received, spent, name, symbol } } }`
Balance = `received - spent`. No per-token filter — all tokens returned, filter client-side.

### Vite Build Config

Root is `src/`. Output is `../public/`. Two HTML entry points (`index.html`, `testnet.html`). All CDN libraries (jQuery, Bootstrap, Web3.js, Luxon, etc.) are loaded via `<script>` tags in the HTML — they are **not** npm packages and not bundled by Vite.

### Values Still Needing Configuration

- `REOWN_PROJECT_ID` in `hathor-wallet.js` — get from cloud.reown.com
- `bridgeHathorAddress` in `HTR_MAINNET_CONFIG` and `HTR_TESTNET_CONFIG` in `index.js`
