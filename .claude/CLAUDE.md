# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server at localhost:5173
npm run build      # Build to public/ (Firebase hosting dir)
npm run preview    # Preview the build locally
npm run typecheck  # tsc --noEmit over src/app and src/types
npm run test       # Vitest (watch); `npm test -- --run` for one pass
npm run ci         # typecheck + tests + build, the same order CI uses
```

Deploy happens in CI (`.github/workflows/firebase-hosting-merge.yml`) and runs a real build with the `VITE_*` secrets. Do **not** reintroduce a `cp -r src/* public/` deploy: `src/` is source, `public/` is build output and is gitignored.

There is no linter. `docs/smoke-checklist.md` is the manual safety net — run it at every phase boundary of the migration, on both pages.

## Architecture

The app is being migrated from one 2000-line classic script to hexagonal architecture (ports & adapters) in TypeScript, incrementally, keeping the page deployable at every step. Phases 0–7 are done; what remains is the UI layer.

### The two halves

`src/app/` is the migrated code: TypeScript, strict, unit-tested.

```
src/app/
  main.ts               # the only module entry, shared by both HTML pages
  domain/               # pure rules: amounts, fees, limits, gas price, addresses, pagination
  ports/driven/         # what the app needs from outside (5 external systems)
  application/          # use cases + the state store
  adapters/driven/      # evm (web3), hathor (walletconnect + node), bridge-api, storage, crypto, scheduler
  adapters/driving/ui/  # row templates (components come in phase 8)
  config/               # networks, tokens, env, constants
  composition/          # container.ts (the only place that knows which adapter is which) + the shim
```

`src/js/index.js` is what is left of the old app (~1360 lines): DOM wiring, jQuery, and the render functions. It is a **classic script** using globals, and it stays that way until it is deleted — converting it would break the inline `onclick=` handlers in the HTML and force a big-bang rewrite.

### How the two halves share state

`src/app/composition/legacy-bridge.ts` publishes the migrated pieces onto `window`. This works because classic scripts run in document order, `type="module"` scripts run after all of them but before `DOMContentLoaded`, and jQuery's `$(document).ready` fires on `DOMContentLoaded`.

**The one rule:** a top-level `let`/`const`/`function` in a classic script creates a script-scope binding that *shadows* the same-named window property. So every symbol the shim publishes must have its declaration deleted from `index.js` in the same commit. Mutable state is published as `window` **accessors** over the store (`STATE_ALIASES` in the shim), which is why `config = null` in legacy code is a real store mutation the new code observes.

`index.js` reaches the new code through four globals: `window.__useCases`, `window.__domain`, `window.__templates`, and the legacy service shims (`BridgeAPI`, `TXN_Storage`, `HathorWallet`).

### Bridge Read API (`docs/bridge-api.yaml`)

Transaction history and claim state come from a read-only REST API. Base URL in `VITE_BRIDGE_API_URL` (env files live in `src/`, see `src/.env.example`). Client: `adapters/driven/bridge-api/http-bridge-api.adapter.ts`.

Only `GET /transactions-by-receiver` is used. `/voted-counts` and `/executed-events` are redundant — vote counts and event fields are inlined in the transaction records.

Things the API's shape does not make obvious:
- `amount` is **18-decimal scaled on the wire** regardless of the EVM token's own decimals (USDC is 6) — but only after the Hathor voting stage. `application/mappers/api-transfer.mapper.ts` owns the three rules that depend on the transfer's stage: the amount scale, how the origin is identified, and whether `sender` is the user or the relayer.
- `originTransactionHash` for `hathor_to_evm` is the Hathor tx id **0x-prefixed**; the wallet and explorer use bare hex. Strip it with `toHathorTxId()`.
- `status: "awaiting_claim"` is **not authoritative** — records already claimed on-chain still report it, so the claim is re-checked against the bridge contract before a Claim button is rendered.

### Claim data hashes

The bridge hashes a claim from `getTransactionDataHash(to, amount, blockHash, transactionHash, logIndex, originChainId, destinationChainId)`. A Hathor-origin transfer has no EVM block of its own, so the federation votes with **`blockHash` in both the `blockHash` and `transactionHash` slots** — verified on-chain against Arbitrum mainnet. The duplication lives in `Web3BridgeAdapter` alone; callers pass a `ClaimRequest` with a single `blockHash` and cannot get it wrong.

### Amounts

Three different scales, and mixing them is the most expensive kind of bug here:

- **EVM base units** — `token.evm.decimals` (USDC 6, aHTR 18). What ERC20 and the bridge contract move.
- **Hathor base units** — `token.hathor.decimals`, which is **2 for every token today**, measured on-chain. This is the display precision for both directions, because 2 decimals is all that can arrive.
- **18-decimal wei** — everything AllowTokens reports (`getInfoAndLimits`, `calcMaxWithdraw`) and every API amount after the Hathor stage. Always pass these through `fromWei` before comparing them with anything.

`domain/amount-math.ts` converts, always truncating, never rounding. `domain/approval-amount.ts` does the base-unit fee gross-up (`amount * divider / (divider - feePercentage)`) plus the 1% approval headroom.

### Entry points and deployments

`src/index.html` (Arbitrum One) and `src/testnet.html` (Sepolia) share `index.js` and `app/main.ts`. Which deployment is active comes from `config/env.ts` `resolveDeployment(location, document)`: `?testnet` wins, then `<html data-deployment>`, then mainnet. Never sniff the URL for the substring "testnet" again — that matched a host or path containing the word.

Networks: `config/networks.ts` (`ROUTES.mainnet` / `ROUTES.testnet`), modelled as an acyclic `BridgeRoute { deployment, evm, hathor }`. The legacy `config` / `config.crossToNetwork` cycle is rebuilt only inside the shim.

Tokens: `config/tokens.ts`, one table per deployment. Read the comment at the top before touching a value — it records what is verified on-chain and what is stale (the testnet UIDs are from the reset `golf` testnet and do not resolve).

### Balances

**Do not switch the Hathor balance to the `htr_getBalance` WalletConnect RPC without checking wallet versions first.** The handler only became prompt-free in `@hathor/hathor-rpc-handler` **5.0.0** (npm, 2026-07-01). Released wallets still ship older ones that pop a confirmation dialog on *every* call — desktop v0.35.0 pins 4.4.0, mobile v0.39.0 pins 4.3.0 — which makes a refreshable balance unusable. This was tried and reverted. `getWalletInformation` is prompt-free there but returns only `{network, address0}`.

Both wallets pin 5.0.0 on master, so when those releases ship, flip `PREFER_WALLET_RPC_BALANCE` in `adapters/driven/hathor/walletconnect.adapter.ts`. The RPC path is already written and is the better answer — it covers the whole wallet, not just the one address the UI shows. Params are `{ network, tokens: [uid] }`; **never send `addressIndexes`** (answers `NotImplementedError`). Results come wrapped as `{ type, response: [...] }`. Spec: [openrpc.json](https://github.com/HathorNetwork/hathor-rpc-lib/blob/master/docs/openrpc.json).

Until then the balance comes from the full node, in `adapters/driven/hathor/node-balance.adapter.ts`. **The node's `/v1a/thin_wallet/address_balance` endpoint is dead** — public nodes return 403 (Google LB, not CORS; curl gets the same), and so does `explorer-service`'s `node_api/` proxy. So the adapter sums unspent outputs from `/v1a/thin_wallet/address_history?addresses[]=`. Four things it must get right, all load-bearing: skip voided txs; skip authority outputs (`token_data & 0x80`); filter outputs down to our own address (history returns whole txs); count timelocked outputs as `locked`. Then follow `has_more`/`first_hash` pagination (150 txs/page).

`explorer-service.hathor.network/address/balance?address=&token=` returns the same numbers in one call and is the oracle to verify against — but its CORS allowlist is `*.hathor.network`, so it is unusable from the browser without a server-side proxy.

### Vite build

Root is `src/`, output `../public/`, two HTML entry points. The CDN libraries (jQuery slim, Bootstrap, Web3.js, BigNumber, ClipboardJS, CryptoJS, bs58) are `<script>` tags, not npm packages, and are typed by hand in `src/types/globals.d.ts` — treat that file as an inventory of remaining coupling; it should only shrink.

Vite only processes `type="module"` scripts, so `src/js/*` is copied verbatim by the `copy-legacy-assets` plugin in `vite.config.js`. Without it the deployed site 404s on `js/index.js`. The ABIs are static imports now (`adapters/driven/evm/abis.ts`), which is what killed the race where a contract could be built with an undefined ABI.

## Known gaps

- **`index.html` and `testnet.html` are missing 12 ids that `index.js` writes to**: `fee`, `timeToCross`, `confirmations`, `secondsPerBlock`, `config-federators-required`, `willReceive*` (the info panel), `doNotAskAgain` (the unlimited-approval checkbox, so unlimited approval is unreachable), and the dead handlers `cross`, `claimTokens`, `changeNetwork`. jQuery writes to an empty set silently, so these fail invisibly. They date from the page rebuild in `de09fdd` and are for phase 8, when the markup gets owned by components.
- **Read use cases that exist but are not wired**: `loadBridgeParameters`, `watchBlockNumber`, `checkAllowance`, `getMaxTransferable`, `refreshHathorBalance` are built and tested, but `setInfoTab`, `getMaxBalance`, `checkAllowance` and the block poll in `index.js` still call contracts directly. Wire them as those call sites become components.
- **`VITE_BRIDGE_API_URL`**: no testnet deployment of the Read API is known; `testnet.html` points at the same base URL as mainnet.
