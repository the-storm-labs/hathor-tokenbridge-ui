# Smoke checklist

Run at every migration phase boundary, on **both** pages:

- `/` (or `/index.html`) — Arbitrum One mainnet
- `/testnet.html` — Sepolia testnet

There are no end-to-end tests. This checklist is the safety net for the refactor,
so run it fully rather than sampling it — the failures that matter are the ones
in the paths you assume still work.

## Load

1. Page loads with **no errors in the console**. (Warnings from CDN scripts are
   pre-existing; new errors are not.)
2. Header, transfer card, token list tab and info tab all render.
3. `window.__ENV__` contains real URLs — **not** literal `%VITE_BRIDGE_API_URL%`.
   A `%` here means the page was deployed without a Vite build.

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
13. Amount below the minimum / above the maximum shows the validation message.
14. An invalid Hathor destination address is rejected.
15. **Approve** submits and confirms.
16. **Cross** submits, and the new transaction appears in the history table.

## Transaction history

17. Both tabs (ARB→HTR and HTR→ARB) render their rows.
18. Pagination (`< previous` / `next >`) works and stops at the boundaries.
19. Vote/signature counts render.
20. A **Claim** button appears for an unclaimed Hathor→EVM transfer, and
    claiming it submits successfully.
21. Claim errors are **visible** (they render in the transfer alert area — before
    the Phase 0 cleanup they were written into a permanently hidden tab).

## Hathor wallet

22. **Connect Hathor Wallet** opens the WalletConnect modal and pairs.
23. The Hathor address appears in the header.
24. Reloading the page **restores** the Hathor session.
25. Disconnect clears it.

## HTR→ARB transfer

26. The direction toggle switches the form.
27. Hathor token dropdown populates.
28. Selecting a token shows its Hathor balance.
29. **Max** fills the amount from the balance.
30. An invalid EVM destination address is rejected.
31. **Send** submits, and the transaction appears in the HTR→ARB history tab.

## Info tab

32. All six config values render: min, max, daily limit, fee, federator count,
    whitelist enabled.
