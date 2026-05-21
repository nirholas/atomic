# 02 — Collect creator fees atomically

pump.fun routes a slice of every trade into the coin's **creator vault** (a PDA derived from the mint + creator pubkey). Anyone holding the creator key can call `collectCoinCreatorFee` to drain the vault into the creator wallet. From there, the SOL needs to go to a safe address.

If the creator key is **shared or leaked**, the naive flow — collect to creator wallet, then transfer to safe wallet — has a window of seconds where any other key-holder (or a sweeper bot) can race you. This tutorial uses Jito bundles to collapse `collect + transfer` into one atomic tx so no window exists.

## When to use which script

| Scenario | Script |
|---|---|
| One-off manual collect | `collect-jito.js` |
| Continuous monitoring of a leaked-key coin | `watch-collect.js` (wraps `collect-jito` in a loop) |
| Final shutdown — drain vault + creator wallet + funder wallet together | `consolidate.js` — see [tutorial 06](./06-consolidate-wallets.md) |

## Prerequisites

- A pump.fun coin you created (so you control the creator key, even if shared).
- The creator wallet's secret key (`CREATOR_SECRET`).
- A funder wallet with ~0.01 SOL to pay the Jito tip. Often the same as your launch funder.
- A **safe destination wallet** (`DESTINATION`) — cold, single-controller, not the creator wallet, not the funder wallet, not an exchange deposit address.

## Step 1 — Manual one-shot collect

Use this to test the setup before running a long watcher, or for occasional manual sweeps:

```bash
# All commands run from the repo root

DESTINATION=<safe-wallet-pubkey> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
JITO_TIP=0.005 \
  npm run collect
```

What's in the single tx that goes into the Jito bundle:

1. `pumpfun::collectCoinCreatorFee` — pulls the vault balance into the creator wallet.
2. `system::transfer` — moves the just-collected SOL (minus a tiny buffer) from creator → `DESTINATION`.
3. Jito tip ix — paid by `FUNDER_SECRET`.

All three happen in one tx that gets bundled. Zero window for a competing collector.

Expected output:

```
Vault balance: 0.083 SOL
Bundle submitted: <bundle-id>
Bundle landed in slot <N>
Transferred 0.082 SOL to <destination>
```

If `Vault balance: 0.000 SOL`, there's nothing to collect — exit and try later.

## Step 2 — Long-running watcher (recommended for leaked keys)

If the creator key is leaked or shared, you want to drain the vault the moment it has enough to be worth a Jito tip. `watch-collect.js` polls the vault every 30 s and runs `collect-jito` whenever the balance crosses `MIN_COLLECT_SOL`.

```bash
DESTINATION=<safe-wallet-pubkey> \
CREATOR_PUBKEY=<creator-wallet-pubkey-base58> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
MIN_COLLECT_SOL=0.05 \
JITO_TIP=0.005 \
  npm run watch
```

Output, looping every 30 s:

```
[14:02:03] Vault: 0.012 SOL — below threshold (0.05)
[14:02:33] Vault: 0.041 SOL — below threshold (0.05)
[14:03:03] Vault: 0.067 SOL — collecting...
[14:03:05] Bundle landed in slot 312...
[14:03:05] Transferred 0.066 SOL to <destination>
[14:03:35] Vault: 0.003 SOL — below threshold (0.05)
```

Run this under a process supervisor (`pm2`, `systemd`, `tmux`) on a server you trust — anything crash-restartable will do. The watcher is stateless; restarts pick up wherever the vault is currently at.

### Tuning `MIN_COLLECT_SOL`

The threshold should always exceed `JITO_TIP + tx_fee + buffer` so each cycle is net-positive. Sane choices:

| Vault accrual | `MIN_COLLECT_SOL` |
|---|---|
| Fast / hot coin | 0.1–0.5 |
| Steady | 0.05 |
| Slow / dying coin | 0.02 |

Going below 0.02 burns more in fees than you collect. Going above 0.5 leaves too much in the vault for sweeper bots to target.

## Step 3 — Verify

After the bundle lands, check the destination wallet's balance on Solscan. It should be the vault amount minus the Jito tip and tx fees (typically ~0.0051 SOL off the top per cycle).

Also confirm the **creator wallet's balance has not increased** — the transfer ix inside the bundle moves the SOL out the same tx, so the creator wallet should be back to rent-exempt minimum after each cycle.

## Env var reference

| Var | Required | Used by | Notes |
|---|---|---|---|
| `RPC_URL` | yes | both | HTTP endpoint; WS not needed |
| `DESTINATION` | yes | both | Safe wallet pubkey. **Must not** be creator or funder pubkey |
| `CREATOR_PUBKEY` | yes (watch) | watch-collect | Lets watcher derive vault PDA without loading the secret |
| `FUNDER_SECRET` | yes | both | Pays Jito tip + tx fee |
| `CREATOR_SECRET` | yes | both | Signs `collectCoinCreatorFee` |
| `JITO_TIP` | no | both | SOL. Default 0.005 |
| `MIN_COLLECT_SOL` | yes (watch) | watch-collect | Vault threshold to trigger collect |

## Gotchas

- **Sweeper bots.** A leaked creator key has other watchers. **Any non-atomic flow** (collect → wait → transfer) will lose the SOL. The Jito bundle in `collect-jito` is the only safe option here.
- **Jito tip starvation.** If `watch-collect` reports zero successful landings while the vault keeps growing, bump `JITO_TIP` first before debugging anything else. Cheap tips lose during active hours.
- **Same-block contention.** Two atomic collects from different key-holders in the same block both succeed at the bundle layer, but only one lands in the slot. Watcher cadence + tip combined are your only edge — there's no in-protocol way to lock the vault to a single collector.
- **Vault PDA derivation.** Derived from `(mint, creator_pubkey)`. `watch-collect.js` reads `CREATOR_PUBKEY` directly so you can monitor without ever loading the secret on the monitoring host — keep the secret on a separate, more-isolated machine that only runs `collect-jito.js` triggered remotely.
- **Wallet hygiene.** `DESTINATION` should be a wallet you control alone. **Never set it to an exchange deposit address** — exchanges credit on confirmation, and a sweeper that also knows the deposit pubkey can race a non-atomic exchange withdrawal *out* of the exchange. Atomicity guarantees only apply on Solana, not in custodial flows.

## Next steps

- **Ready to retire this coin** entirely? See [tutorial 06 — Consolidate wallets](./06-consolidate-wallets.md). It drains the vault, creator wallet, *and* funder wallet in one Jito bundle.
- **Want anti-Sybil filtering** on a future rewards drop for this coin? See [tutorial 07 — Wallet provenance](./07-audit-wallet-provenance.md).
