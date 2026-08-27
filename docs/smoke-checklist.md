# Smoke checklist

Run before shipping any UI change, on **both** pages:

- `/` (or `/index.html`) — Arbitrum One mainnet
- `/testnet.html` — Sepolia testnet

There are no end-to-end tests. This checklist is the safety net, so run it fully
rather than sampling it — the failures that matter are the ones in the paths you
assume still work.

## Load

1. Page loads with **no errors in the console**, ignoring the four kinds below.
   Anything else is ours.

   | message | source | why it is not ours |
   | --- | --- | --- |
   | `MaxListenersExceededWarning`, `ObjectMultiplex - orphaned data` | `contentscript.js` | MetaMask's own content script, on every site |
   | `Lit is in dev mode` | Reown AppKit | its bundled Lit; the production build does not warn |
   | `emitting session_request:<id> without any listeners` | WalletConnect | a **response** arriving for a request whose page is gone — you sent an HTR→ARB transfer, reloaded before confirming, then confirmed in the wallet. The transaction went through; only the promise waiting for it did not survive. It clears once the queued response is delivered. |
   | `Failed to load source map for bootstrap.min.css` | Vite dev server | fixed — if it comes back, someone re-vendored the CSS with its `sourceMappingURL` comment |

   Note the third one only appears **after** a Hathor session exists. With no
   stored session the page does not initialise WalletConnect at all.
2. Header, transfer card, token list tab and info tab all render.
3. The transaction history loads for a connected account. The Read API URL is
   inlined into the bundle at build time, so a missing one is silent — an empty
   history is the only symptom. (The deploy workflow refuses to build without
   it; this catches the case where it was built with the wrong one.)

## EVM wallet

4. Clicking **Connect Wallet** opens the modal and lists the installed wallets.
5. Connecting succeeds; the address and network appear in the header, and the
   transfer card becomes enabled.
6. With the wallet on the **wrong network**, the network error is shown.
7. Disconnect clears the header and re-disables the transfer card.
8. Reload with a previously connected wallet auto-reconnects.

## ARB→HTR transfer

9. Token dropdown populates, **with icons**.
10. Selecting a token shows its EVM balance.
11. Typing an amount updates **service fee** and **total cost**.
12. **Max** fills the field with the maximum transferable amount.
13. Amount below the minimum / above the maximum shows the validation message
    **under the amount field**.
14. An invalid Hathor destination address is rejected.
15. **Approve** submits and confirms, and the *don't ask again* checkbox next to
    it is usable.
15b. Once the allowance covers the transfer, the whole approve block disappears
    and only **Convert tokens** is offered.
16. **Cross** submits, and the new transaction appears in the history table.

## Transaction history

17. Both tabs (ARB→HTR and HTR→ARB) render their rows.
18. Pagination (`< previous` / `next >`) works and stops at the boundaries.
19. Vote/signature counts render.
20. A **Claim** button appears for an unclaimed Hathor→EVM transfer, and
    claiming it submits successfully.
20b. The row flips straight to **Claimed** — it must never pass through
    "Voting — in progress", which the Read API's stale status used to produce
    for a few seconds after the claim was mined.
21. Claim errors are **visible** (they render in the transfer alert area — before
    the Phase 0 cleanup they were written into a permanently hidden tab).

## Hathor wallet

22. **Connect Hathor Wallet** opens the WalletConnect modal and pairs.
23. The Hathor address appears in the header.
24. Reloading the page **restores** the Hathor session.
25. Disconnect clears it.
26. An **expired** session loads as disconnected, with the session-expired toast.
    Sessions live seven days, so force it rather than wait — in the console,
    `s = JSON.parse(localStorage['wc@2:client:0.3:session']); s.forEach(x => x.expiry = Math.floor(Date.now()/1000) - 3600); localStorage['wc@2:client:0.3:session'] = JSON.stringify(s)`,
    then reload. **Connect Hathor** must still pair from there.
27. Disconnecting the dApp **from the Hathor wallet app** drops the header on its
    own, without a reload.

## HTR→ARB transfer

28. The direction toggle switches the form.
29. Hathor token dropdown populates.
30. Selecting a token shows its Hathor balance.
31. **Max** fills the amount from the balance.
32. An invalid EVM destination address is rejected.
32b. A destination with an active EIP-7702 delegation is **blocked** — the
    amber "This destination can't be used" toast, naming the delegate, not the
    red send-error one — and **before** the Hathor wallet is asked to sign
    anything. To get a delegated Sepolia address: in MetaMask, open Account
    Details on a test account and use **Switch to smart account** (needs a
    little Sepolia ETH for gas); or use
    [eip7702reset](https://github.com/maikelordaz/eip7702reset)'s `set`
    command from the CLI.
32c. Declining the request in the Hathor wallet shows the amber "Transaction
    cancelled" toast, not the red send-error one, and no console error.
33. **Send** submits, and the transaction appears in the HTR→ARB history tab.

## Info tab

34. All seven config values render: min, max, daily limit, fee, federator count,
    federators required, crossing period. The crossing period shows **before**
    any wallet is connected.
