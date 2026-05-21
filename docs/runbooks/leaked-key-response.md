# Runbook — leaked / shared creator key response

What to do when you confirm (or suspect) that a creator key in this toolkit has been compromised. Optimized for minutes-to-action, not exhaustiveness.

## Pre-conditions

You hold:

- The leaked secret (`CREATOR_SECRET`).
- A clean funder key with SOL for tips (`FUNDER_SECRET`), ideally **not** sharing any history with the leaked wallet.
- A safe destination pubkey (`DESTINATION`) on a wallet only you control.
- A working `RPC_URL` (Helius / Triton preferred — public mainnet rate-limits during incidents).

If you don't have a clean funder, generate one and fund it with 0.05 SOL from a CEX or a fresh wallet **before** doing anything else. Reusing the leaked wallet to pay tips defeats the entire point.

## Sequence

The order matters. Each step is atomic on its own (Jito bundle), but between steps a sweeper can still act on whatever residual you left. Run them back-to-back.

### Step 1 — Sweep the creator vault
Drains accrued pump.fun creator fees first; this is what same-key sweepers are most likely to hit.

All commands run from the repo root (the root `package.json` defines the npm scripts).

```bash
DESTINATION=<safe-wallet> \
FUNDER_SECRET=<clean-funder> CREATOR_SECRET=<leaked-creator> \
JITO_TIP=0.01 \
  npm run collect
```

Bump `JITO_TIP` to 0.02 if Jito returns `Invalid` — incidents tend to coincide with bundle congestion.

### Step 2 — Consolidate residual wallet balances
Sweeps any SOL still sitting in the creator + funder wallets to `DESTINATION` in one bundle. (If the funder is truly clean and you trust it, you can skip the funder side of this — but check the script flags.)

```bash
DESTINATION=<safe-wallet> \
FUNDER_SECRET=<clean-funder> CREATOR_SECRET=<leaked-creator> \
JITO_TIP=0.01 \
  npm run consolidate
```

### Step 3 — Rescue token balances
For each token mint that the leaked creator wallet holds, run `rescue-tokens.js`. Iterate through all mints, not just the launched coin — a sweeper that also holds the key may have already moved tokens *in* to that wallet from elsewhere as bait (rare but seen).

```bash
SOURCE_SECRET=<leaked-creator> \
DESTINATION=<safe-wallet> \
MINT=<token-mint> \
RENT_PAYER_SECRET=<clean-funder> \
JITO_TIP=0.005 \
  npm run transfer-tokens
```

Token-2022 mints with transfer hooks need their hook program known to the script — see [atomic-rescue](../../skills/rescue/SKILL.md) for the failure mode.

### Step 4 — Verify
After the bundles land, check final balances:

```bash
npx tsx tools/check-balances.ts <leaked-creator-pubkey> [rpcUrl]
```

If non-zero SOL remains, it's the rent-exempt minimum (the wallet is still open) and is unrecoverable without closing the account. That's fine — the value is dust.

### Step 5 — Audit funding provenance
For the safe destination, verify it was NOT itself seeded by pump.fun (so a future rewards-distribution audit doesn't exclude it):

```bash
npx tsx tools/check-pump-funding.ts <safe-wallet>
```

Expected: RED (not pump-seeded). If GREEN, you have a different problem — the "safe" wallet has a pump.fun lineage that may classify it as Sybil under some downstream rewards programs.

## After the sweep

- **Mark the leaked address as permanently watched.** Never deposit to it again. Sweeper bots index leaked keys indefinitely.
- **Generate a fresh creator wallet** if you intend to launch another coin in the same role.
- **Rotate the funder** if there's any chance it was co-located on the same compromised host. Even if the key itself never leaked, treat host compromise as key compromise.
- **Record the incident** with timestamps, wallet pubkeys, sweep destinations, and bundle UUIDs. Useful for future forensics and for distinguishing your own activity from sweeper activity in logs.

## Pump.fun-specific considerations

- **The watch-collect watcher is your friend going forward.** If the coin is still live and accruing fees but you don't want to keep retiring it, run `watch-collect.js` continuously against the leaked creator key with a low `MIN_COLLECT_SOL` threshold. Your watcher races every sweeper; whoever pays a higher Jito tip wins each block.
- **Creator-fee curve.** Pump fees accrue on every buy/sell of the coin until graduation. A leaked creator key on a graduating coin can be lucrative for sweepers — expect heavy bot competition during high-volume periods. Tip accordingly.
- **`DESTINATION` reuse.** If you sweep to a destination you've used for prior leaked-key recoveries, expect chain analysts to cluster all those leaks under one operator. If that matters to you, use a fresh `DESTINATION` per incident.

## Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `Bundles must write lock at least one tip account` | Jito tip-account list rotated | Run `npx tsx tools/check-tip-accounts.ts`; update `JITO_TIP_ACCOUNTS` in `src/fire-jito.js` (and any other script that hardcodes the list) |
| Bundle returns `Invalid` | Tip too low for current congestion | Bump `JITO_TIP` to 0.01–0.02 and retry |
| `collect-jito` lands but vault still has SOL | Pump fee curve still emitting; not all accrual was collected in that block | Re-run; or switch to `watch-collect.js` |
| `rescue-tokens` fails with `MissingAccount` | Token-2022 transfer hook needs extra accounts the script doesn't know | Find the hook program docs, add accounts manually as a follow-up tx (loses atomicity) |
| Public mainnet RPC times out | Rate-limited during high-load incident | Switch to a paid RPC for the duration |

## Related

- [atomic-collect](../../skills/collect/SKILL.md) — vault collection
- [atomic-rescue](../../skills/rescue/SKILL.md) — token transfer
- [SECURITY.md](../../SECURITY.md) — threat model and secrets handling
- [tools/check-tip-accounts.ts](../../tools/check-tip-accounts.ts) — Jito tip-account drift check
