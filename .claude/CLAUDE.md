# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server at localhost:5173
npm run build      # Build to public/ (Firebase hosting dir)
npm run preview    # Preview the build locally
npm run typecheck  # tsc --noEmit over src/app and src/types
npm run test       # Vitest (watch); `npm test -- --run` for one pass
npm run lint       # oxlint + prettier --check
npm run format     # prettier --write
npm run ci         # lint + typecheck + tests + build, the same order CI uses
```

Deploy happens in CI (`.github/workflows/firebase-hosting-merge.yml`) and runs a real build with the `VITE_*` secrets. Do **not** reintroduce a `cp -r src/* public/` deploy: `src/` is source, `public/` is build output and is gitignored.

Three Firebase Hosting targets, one build, distinguished only by `channelId`:
`live` on merge to main, an auto-named channel per PR
(`firebase-hosting-pull-request.yml`), and `staging` on demand
(`firebase-hosting-staging.yml`, `workflow_dispatch`, 30-day default). A preview
channel serves at the **root** of its own subdomain, which is why staging needs
no config of its own — the artifact is the production one. **GitHub Pages was
considered and rejected**: a project site serves under `/<repo>/`, and the build
emits absolute `/assets/...` while `appUrl`/`appIcon` come from
`window.location.origin` (`composition/container.ts`), so a subpath breaks the
asset graph and the icon the Hathor wallet shows on its approval screen.

Note that `workflow_dispatch` only appears in the Actions tab when the workflow
file is on the **default branch**, and that the merge workflow's `paths` include
`.github/workflows/**` — so landing a workflow change on main also redeploys
production.

The linter is **oxlint**, not ESLint: this project is on TypeScript 7, and
typescript-eslint still declares `peer typescript <6.1.0`. oxlint is a single
binary with no TypeScript peer dependency, so it works today; revisit ESLint when
typescript-eslint supports TS 7. Only the `correctness` category is on — the
other categories are opinions this codebase has already decided against
deliberately, and turning them on produced twenty complaints about intentional
code. Three deliberate patterns carry an inline `oxlint-disable-next-line` with
the reason.

Prettier is configured to the style the code already had (no semicolons, single
quotes, width 100), so adopting it touched 26 of 116 files and only rewrapped
lines. Markdown and `.github` are ignored: Prettier rewraps prose and reflows
YAML, which churns hand-tuned tables for no gain.

`docs/smoke-checklist.md` is the manual safety net — there are no end-to-end
tests, so run it in full before shipping UI changes, on both pages.

## Architecture

The app was migrated from one 2000-line classic script to hexagonal architecture
(ports & adapters) in TypeScript, incrementally, keeping the page deployable at
every step. **Phases 0–8 are all done** — the legacy script, its `window` shim
and every shared global are gone.

```
src/app/
  main.ts               # the only module entry, shared by both HTML pages
  domain/               # pure rules: amounts, fees, limits, gas price, addresses, pagination
  ports/driven/         # what the app needs from outside (5 external systems)
  application/          # use cases + the state store
  adapters/driven/      # evm (web3), hathor (walletconnect + node), bridge-api, storage, crypto, scheduler
  adapters/driving/ui/  # components, row templates, toasts, the jQuery-plugin seam
  config/               # networks, tokens, env, constants
  composition/          # container.ts (driven) + ui.ts (driving) + use-cases.ts
```

`src/js/` holds one vendored classic script, `bs58.js`, loaded as a `<script>`
tag and typed by hand in `src/types/globals.d.ts`. Everything else on the page is
the module graph.

### The two composition roots

`composition/container.ts` decides which **adapter** satisfies which driven port.
It also owns the web3 instance: `setProvider()` is called when a wallet connects
and the adapters are handed a getter, so nothing reads `window.web3`.

`composition/ui.ts` decides which **component** owns which part of the DOM, wires
each one to its use cases, and connects the components to each other. It runs
from `main.ts`, which is a `type="module"` script — deferred, so the document is
parsed and jQuery/Bootstrap/Web3 are all present, but `DOMContentLoaded` has not
fired. No component waits for a ready callback.

**Ordering constraint:** `initSelectpickers(root)` is called **last** in
`mountUi`. bootstrap-select copies the `<option>`s it finds when it initialises,
so every dropdown must already be filled.

### Components

One file per component in `adapters/driving/ui/components/`, each exporting a
class plus a `mountX(root, deps)` function. The shape is always the same:

- the constructor resolves its elements by id, all nullable — a page that lacks
  one degrades instead of throwing;
- `deps` is a narrow interface of use cases and callbacks, never the container;
- side effects on **other** components are published as `CustomEvent`s on the
  window and wired in `ui.ts`. A component commands nothing outside its markup.

The events, all defined next to their publisher:

| event | published by | detail |
| --- | --- | --- |
| `evmwallet:connected` | wallet-header | `{ address, route }` |
| `evmwallet:accountchanged` | wallet-header | `{ address }` |
| `evmwallet:disconnected` | wallet-header | — |
| `hathorwallet:connected` | hathor-transfer-form | `{ address }` |
| `hathorwallet:disconnected` | hathor-transfer-form | — |
| `hathortransfer:sent` | hathor-transfer-form | `{ evmDestination }` |
| `crosstransfer:sent` | cross-transfer-form | — |

Component tests run under jsdom, opted into per file with
`// @vitest-environment jsdom`. The domain and adapter suites stay on `node`.

### No globals, no CDN scripts

The page loads exactly one script: `app/main.ts`. jQuery, Popper, Bootstrap's JS,
bootstrap-select, Web3, BigNumber, CryptoJS and bs58 are all gone, and with them
`src/types/globals.d.ts` — there is nothing left to declare. Bootstrap's **CSS**
stays; it was only ever the JS that was a problem.

Three things that plugin provided are now ours, in `adapters/driving/ui/`:

- `components/token-select.component.ts` — the icon dropdown. It exists because
  a native `<option>` cannot hold an image, which is the only thing
  bootstrap-select was needed for. The native `<select>` stays in the DOM and
  stays authoritative: the widget writes through it and dispatches a **native**
  `change`, so every listener in the app is bound to a real form control.
- `modal.ts` — show, hide, and the three ways a dialog closes.
- `button-group.ts` — the `.active` class on the direction toggle.

**The lesson that cost the most, kept because it explains the shape of the
code:** a jQuery-triggered event never reaches `addEventListener`. `trigger()`
runs jQuery's own handler list and dispatches nothing native. That silently broke
the direction toggle and the history tabs during the migration, and it is why
those two now own their own switching rather than listening for `shown.bs.tab`.

### Showing and hiding

`element.style.display = ''` only works when nothing in a stylesheet hides the
element. `#previousTxnsTab` and `#previousTxnsEmptyTab` are `display: none` in
`css/customStyles.css`, so they are shown with an explicit `'block'`;
`.btn-toolbar` is `display: flex` from Bootstrap and is shown by clearing the
inline value, because naming a value would flatten the layout. Getting this
backwards is invisible in a unit test and obvious on the page.

### Bridge Read API (`docs/bridge-api.yaml`)

Transaction history and claim state come from a read-only REST API. Base URL in `VITE_BRIDGE_API_URL` (env files live in `src/`, see `src/.env.example`). Client: `adapters/driven/bridge-api/http-bridge-api.adapter.ts`.

Only `GET /transactions-by-receiver` is used. `/voted-counts` and `/executed-events` are redundant — vote counts and event fields are inlined in the transaction records.

Things the API's shape does not make obvious:
- `amount` is **18-decimal scaled on the wire** regardless of the EVM token's own decimals (USDC is 6) — but only after the Hathor voting stage. `application/mappers/api-transfer.mapper.ts` owns the three rules that depend on the transfer's stage: the amount scale, how the origin is identified, and whether `sender` is the user or the relayer.
- `originTransactionHash` for `hathor_to_evm` is the Hathor tx id **0x-prefixed**; the wallet and explorer use bare hex. Strip it with `toHathorTxId()`.
- `status: "awaiting_claim"` is **not authoritative** — records already claimed on-chain still report it, for seconds after the claim is mined. So it is re-checked against the bridge contract, and the result is a **tri-state** (`ClaimCheck` in the mapper), not a boolean: `claimed` overrides the API's status so the row reads Claimed; `claimable` renders the button; `unknown` (no contract, unreadable record) renders neither. Collapsing the first two is what made a transfer the user had just claimed render as "Voting — in progress" beside a full 4/4 approval meter.

### Claim data hashes

The bridge hashes a claim from `getTransactionDataHash(to, amount, blockHash, transactionHash, logIndex, originChainId, destinationChainId)`. A Hathor-origin transfer has no EVM block of its own, so the federation votes with **`blockHash` in both the `blockHash` and `transactionHash` slots** — verified on-chain against Arbitrum mainnet. The duplication lives in `Web3BridgeAdapter` alone; callers pass a `ClaimRequest` with a single `blockHash` and cannot get it wrong.

### Amounts

Three different scales, and mixing them is the most expensive kind of bug here:

- **EVM base units** — `token.evm.decimals` (USDC 6, aHTR 18). What ERC20 and the bridge contract move.
- **Hathor base units** — `token.hathor.decimals`, which is **2 for every token today**, measured on-chain. This is the display precision for both directions, because 2 decimals is all that can arrive.
- **18-decimal wei** — everything AllowTokens reports (`getInfoAndLimits`, `calcMaxWithdraw`) and every API amount after the Hathor stage. Always pass these through `fromWei` before comparing them with anything.

`domain/amount-math.ts` converts, always truncating, never rounding. `domain/approval-amount.ts` does the base-unit fee gross-up (`amount * divider / (divider - feePercentage)`) plus the 1% approval headroom.

### Entry points and deployments

`src/index.html` (Arbitrum One) and `src/testnet.html` (Sepolia) share `app/main.ts`. Which deployment is active comes from `config/env.ts` `resolveDeployment(location, document)`: `?testnet` wins, then `<html data-deployment>`, then mainnet. Never sniff the URL for the substring "testnet" again — that matched a host or path containing the word.

Networks: `config/networks.ts` (`ROUTES.mainnet` / `ROUTES.testnet`), modelled as an acyclic `BridgeRoute { deployment, evm, hathor }`. The legacy `config` / `config.crossToNetwork` cycle is gone: a route holds both sides, so nothing has to walk a back-reference.

Tokens: `config/tokens.ts`, one table per deployment. Read the comment at the top before touching a value — it records what is verified on-chain and what is stale (the testnet UIDs are from the reset `golf` testnet and do not resolve).

### Balances

**Do not switch the Hathor balance to the `htr_getBalance` WalletConnect RPC without checking wallet versions first.** The handler only became prompt-free in `@hathor/hathor-rpc-handler` **5.0.0** (npm, 2026-07-01). Released wallets still ship older ones that pop a confirmation dialog on *every* call — desktop v0.35.0 pins 4.4.0, mobile v0.39.0 pins 4.3.0 — which makes a refreshable balance unusable. This was tried and reverted. `getWalletInformation` is prompt-free there but returns only `{network, address0}`.

Both wallets pin 5.0.0 on master, so when those releases ship, flip `PREFER_WALLET_RPC_BALANCE` in `adapters/driven/hathor/walletconnect.adapter.ts`. The RPC path is already written and is the better answer — it covers the whole wallet, not just the one address the UI shows. Params are `{ network, tokens: [uid] }`; **never send `addressIndexes`** (answers `NotImplementedError`). Results come wrapped as `{ type, response: [...] }`. Spec: [openrpc.json](https://github.com/HathorNetwork/hathor-rpc-lib/blob/master/docs/openrpc.json).

`restore()` checks the stored address **before** building the connector, and
that ordering is load-bearing: initialising Reown opens a relay connection, boots
Lit and the AppKit modal, and replays whatever WalletConnect has queued. Doing it
unconditionally meant every visitor paid for it, including the ones who only use
the ARB→HTR form — and the queued replay logged
`emitting session_request:<id> without any listeners` on a page that had never
seen a Hathor wallet.

Until then the balance comes from the full node, in `adapters/driven/hathor/node-balance.adapter.ts`. **The node's `/v1a/thin_wallet/address_balance` endpoint is dead** — public nodes return 403 (Google LB, not CORS; curl gets the same), and so does `explorer-service`'s `node_api/` proxy. So the adapter sums unspent outputs from `/v1a/thin_wallet/address_history?addresses[]=`. Four things it must get right, all load-bearing: skip voided txs; skip authority outputs (`token_data & 0x80`); filter outputs down to our own address (history returns whole txs); count timelocked outputs as `locked`. Then follow `has_more`/`first_hash` pagination (150 txs/page).

`explorer-service.hathor.network/address/balance?address=&token=` returns the same numbers in one call and is the oracle to verify against — but its CORS allowlist is `*.hathor.network`, so it is unusable from the browser without a server-side proxy.

### Session expiry

**A WalletConnect session lives seven days** (`SESSION_EXPIRY = SEVEN_DAYS` in
`@walletconnect/sign-client`) and nothing renews it on its own — not this app,
not Reown's `UniversalConnector`. So a wallet left connected over a week is dead
on the next visit, and *nothing in the SDK reliably tells you*: the expirer only
prunes on a heartbeat pulse and only while the relay is connected, while
`UniversalProvider` reads `session.getAll()[0]` straight out of storage during
init, before the first pulse. `provider.session` therefore hands back sessions
that expired days ago.

That is why `session.expiry` (unix **seconds**) is checked by hand, in `isLive()`,
in **two** places: on `restore()`, and again in `rpcRequest()` because a session
can lapse with the page still open. Skipping the second check is what made a
transfer hang for five minutes — `wc_sessionRequest`'s ttl — behind a pending
toast that deliberately never auto-dismisses, and then fail with
`Request expired`. A missing `expiry` counts as **live**: it means a shape the
adapter does not recognise, and signing the user out over an unread field is
worse than the bug.

`restore()` returns three things, not two: a session, `null` when there was never
one, and `{ address: null, expired: true }` when there was one and it lapsed —
only the third earns the `#htrSessionExpired` toast. Mid-session deaths arrive
through `onSessionLost`, fed by `session_delete`/`disconnect` on the provider and
`session_expire` on the SignClient; `handleSessionLost()` is guarded because the
SDK reports one death on several of those at once.

`extendIfExpiringSoon()` renews anything with under two days left, fire-and-forget
— `wc_sessionExtend` is a relay round trip that needs the phone awake, and a
restore must neither wait on it nor fail because of it.

### Vite build

Root is `src/`, output `../public/`, two HTML entry points, one module graph.
Nothing is copied verbatim any more and no dependency arrives by `<script>` tag.

Build-time config comes from `import.meta.env.VITE_*`, inlined by Vite. It used
to travel through a `window.__ENV__` object filled by an inline script with
`%VITE_*%` placeholders, because the classic scripts could not see
`import.meta` — and a page served without a build shipped the literal
placeholder. The failure mode now is an *empty* value, which the deploy workflow
checks for before building.

The ABIs are static imports (`adapters/driven/evm/abis.ts`), which is what killed
the race where a contract could be built with an undefined ABI.

**Any asset a module needs must be `import`ed, never named as a path string.**
There is no `publicDir` here, so nothing is copied verbatim: a string like
`'./assets/img/usdc.png'` is invisible to the bundler, the file is never emitted,
and it 404s. It **works in `npm run dev`** — Vite serves `src/` as the document
root there, so the path happens to resolve — and fails only once deployed, which
is the worst place to find out. That is exactly how the token icons in
`config/tokens.ts` broke. `<img src>` in the HTML files is fine either way,
because Vite's HTML parser does see those. Note that assets under 4 kB become
`data:` URIs rather than files in `public/assets/`, so an emitted-file check is
not how you verify one shipped — decode the data URI, or look at the page.

The build has no asset warnings, and should stay that way — each one is a file
the page asks for and will not get. `css/scrollbar-plugin.css` was the last, a
malihu jQuery scrollbar stylesheet whose every selector was `.mCSB_*` /
`.mCustom*`: nothing has emitted that markup since jQuery left, and it referenced
an `mCSB_buttons.png` sprite that is not in the repo. Deleted, with its `<link>`
in both pages.

## Known gaps

- **`VITE_BRIDGE_API_URL`**: no testnet deployment of the Read API is known;
  `testnet.html` points at the same base URL as mainnet.
- **The testnet token UIDs are stale** — they date from the reset `golf` testnet
  and do not resolve, so HTR→ARB on `testnet.html` cannot work until someone
  re-mints them and updates `config/tokens.ts`.
- **`#changeNetwork` and `#claimTokens` are gone.** Both were handlers in the old
  ready block bound to elements no page has had since the rebuild in `de09fdd`;
  neither survived the component migration. If a "switch network" button is
  wanted, it is new work, not a restoration.
- **The AppKit chunk is 725 kB.** It is loaded lazily — `main.ts` imports
  `@reown/appkit-universal-connector` with a dynamic `import()`, so it is fetched
  only when a Hathor wallet is connected, and the entry chunk is 129 kB. Vite
  still warns about the size of the lazy chunk itself. **Do not make that import
  static again**: it puts a whole Lit runtime into the first byte every visitor
  downloads, for the one flow that needs it.
