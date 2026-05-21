# 09 — Jito bundle anatomy & troubleshooting

Every atomic flow in this toolkit ultimately submits a **Jito bundle** to the Jito Block Engine. When bundles land, things work. When they don't land, the symptoms are confusing — txs that look fine in `simulate`, fast iteration with no visible progress, and the dreaded `"status": "Invalid"` with no other detail.

This tutorial explains what's actually in a bundle, how landing decisions get made, and the decision tree for diagnosing failures.

## What a bundle is

A Jito bundle is a set of **1–5 Solana transactions** submitted together to Jito's Block Engine. The block engine treats them as atomic: either all of them land in the same slot, or none of them do.

A few rules:

- **All txs share a recent blockhash** (typically the same one, taken right before submission).
- **Each tx is independently signed** by its required signers. The bundle is not a single signed object — it's a JSON array of signed txs.
- **At least one tx must pay a tip** to a Jito tip account. The tip is what bids the bundle into the slot.
- The tip is paid only if the bundle lands. Failed bundles cost only the simulation/submission RPC quota.

## Bundle structure in this toolkit

Each script in this repo constructs bundles slightly differently:

| Script | Tx count | What's in the tx(s) |
|---|---|---|
| `fire-jito.js` | 2 | Tx1: funder→creator rent transfer + Jito tip. Tx2: creator runs `createV2` + optional dev buy |
| `collect-jito.js` | 1 | One tx: `collectCoinCreatorFee` + transfer to destination + Jito tip |
| `consolidate.js` | 1 | One tx: collect + creator drain + funder drain + tip |
| `buy-jito.js` | 1 | One tx: Jupiter swap + tip |
| `rescue-tokens.js` | 1 | One tx: ATA-create (if needed) + transfer + tip |

The shared structure: **the tip ix is in the same tx as the value-bearing ixs**, never split out. This is what gives the bundle its atomicity property — a sweeper can't insert between, say, a `collectCoinCreatorFee` and its subsequent transfer, because they're in the same tx.

## How landing decisions are made

When Jito receives your bundle:

1. **Simulation** — Jito simulates every tx in the bundle. Any sim failure = bundle rejected with `"status": "Invalid"`.
2. **Tip auction** — Bundles compete for the slot. Higher tips win, simple as that.
3. **Slot inclusion** — Top-bidding bundles get included in the validator's block proposal for the slot.
4. **Land** — The block lands on chain; all txs in your bundle execute.

The auction is per-slot. Tips that win at 3am UTC routinely lose during launch hours. This is the single most common reason your bundles don't land.

## Diagnosing `"status": "Invalid"`

`Invalid` means **simulation failed**. The most common causes, ranked by frequency:

### 1. Tip-account write lock missing

```
"Bundles must write lock at least one tip account"
```

Cause: Jito rotates its tip account list. The hardcoded list in the script has drifted. Diagnose with the included tool:

```bash
npx tsx tools/check-tip-accounts.ts
# Exit 0: no drift. Exit 1: live list has accounts your hardcoded list doesn't.
```

Then update `JITO_TIP_ACCOUNTS` in `src/fire-jito.js` (and the mirror in `tools/check-tip-accounts.ts`) to include the missing entries. Re-run to confirm the diff is gone.

### 2. Stale blockhash

```
"Transaction simulation failed: Blockhash not found"
```

Cause: The tx was constructed with a blockhash that's now too old (>150 slots, ~60 sec). Fix: re-run the script. It rebuilds the bundle with a fresh blockhash on each invocation.

If you see this **consistently** (every run, immediately), your RPC is returning a blockhash from a lagging node. Switch to Helius/Triton.

### 3. Tx size > 1232 bytes

```
"Transaction too large"
```

Cause: The tx (or one of them) exceeded the wire-format size limit. In this toolkit:

- `fire-jito.js` is most prone if you add accounts beyond what the script generates.
- `consolidate.js` is at risk when many additional ixs are layered on.

Fix: Split the offending ixs into a separate tx within the same bundle (you have up to 5 per bundle).

### 4. Account balance shortfall

```
"Attempt to debit an account but found no record of a prior credit"
```

Cause: A wallet in the bundle doesn't have enough SOL for what the tx tries to do. In `rescue-tokens.js`, this typically means the source wallet has no SOL — set `RENT_PAYER_SECRET` to a clean funder. Elsewhere, top up the relevant wallet.

### 5. Missing pump.fun program accounts (drift)

```
"AccountNotFound: BuybackFeeRecipient" (or similar)
```

Cause: pump.fun upgraded the program and added required accounts to a buy / collect / create ix. The local pump-sdk version is behind.

Fix:

- For buys: use [tutorial 03 — `buy-jito.js`](./03-buy-via-jupiter-jito.md), which routes through Jupiter and bypasses the SDK ix entirely.
- For other flows: update the pump-sdk dependency in root `package.json` and re-`npm install`. Worst case, manually patch the missing account into the ix builder.

## Diagnosing "bundle accepted but never lands"

You get `{"status": "Pending"}` or `{"status": "Accepted"}` from Jito, but the bundle never shows up on chain. Symptoms:

- Watcher reports `Bundle submitted` lines but no `Bundle landed` lines.
- Vault balance keeps growing instead of being drained.
- Solana explorer shows no tx with your bundle's signatures.

Almost always one of these:

### A. Tip too low for the current slot competition

Most common. Fix: bump `JITO_TIP` by 2–4×.

| Time of day | Typical floor that lands |
|---|---|
| Low-activity hours (3am–9am UTC) | 0.003–0.005 |
| Normal hours | 0.005–0.01 |
| Active hours (15:00–22:00 UTC) | 0.01–0.02 |
| Launch windows (active coin going viral) | 0.02–0.05+ |

If you see consistent `Pending → expired` over 60 sec, your tip is below the floor. Escalate aggressively — a missed creator-fee collect window during a viral spike costs more than an oversized tip.

### B. RPC propagation lag

The bundle landed but your RPC hasn't caught up yet. Wait 30 sec and re-query. If your RPC is consistently 30+ slots behind, switch providers.

### C. Same-block contention

Two atomic collects from different key-holders both landed in the same slot. Only one can succeed at the protocol level — the loser's bundle reverts on simulation in the next slot. The script logs a `revert` with the relevant error. Bump tip + cadence to widen your edge.

## Monitoring landing rate

For a long-running `watch-collect.js`, log-line ratios tell you the health:

```bash
# How many collect attempts in the last hour
grep "collecting..." watcher.log | tail -100 | grep "$(date +%Y-%m-%dT%H)" | wc -l

# How many landed
grep "Bundle landed" watcher.log | tail -100 | grep "$(date +%Y-%m-%dT%H)" | wc -l
```

Healthy: >80% landing rate. <50%: tip too low or RPC is lagging. <10%: something is structurally wrong (drift, account list rotation, RPC quota exceeded).

## Why bundles instead of multiple separate txs?

The whole point: **atomicity against same-block-key competition.**

If you ran `collect → wait → transfer` as two separate txs:

```
Slot N:    you: collectCoinCreatorFee  (creator wallet now has SOL)
Slot N+1:  bot: transfer all SOL from creator wallet → bot's address
Slot N+2:  you: transfer creator → destination  (fails: insufficient funds)
```

Anyone who also holds the creator key (in a leaked/shared scenario) can insert between your txs. Jito bundles collapse the read-modify-write into a single tx within a single slot, removing the window entirely. That's the **only** structural property that makes atomic flows safe under leaked-key conditions. Everything else in this toolkit is plumbing around that one guarantee.

## Next steps

- **Operational hardening** for long-running watchers: [tutorial 10 — Production setup](./10-production-setup.md).
- **Choosing tips dynamically** based on observed landing rate: out of scope for this toolkit currently, but consider monitoring landing rate + auto-escalating tip in a wrapper script.
