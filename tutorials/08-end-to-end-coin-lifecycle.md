# 08 — End-to-end coin lifecycle

This tutorial chains the individual flows from earlier tutorials into one narrative covering the **full life of a coin**: launch with a same-bundle dev buy, run a long-lived watcher to drain creator fees safely, optionally distribute USDC rewards, and finally retire the coin by consolidating everything to a safe wallet.

Read this if you want a mental model of how the pieces fit. The per-flow tutorials ([01](./01-launch-pump-coin-via-jito.md), [02](./02-collect-creator-fees.md), [05](./05-distribute-usdc-rewards.md), [06](./06-consolidate-wallets.md)) are the source of truth for each step's commands and gotchas — this tutorial only adds **the flow between them**.

## The lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  1. Launch  │ ──> │ 2. Collect  │ ──> │ 3. Rewards  │ ──> │  4. Retire  │
│  + dev buy  │     │   (watcher) │     │  (optional) │     │ consolidate │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
   one-time         long-running         scheduled            one-time
   ~1 min            (days/weeks)         (cycles)            ~30 sec
```

## Wallet layout

You'll typically run with **three** Solana wallets and **one** destination:

| Wallet | Purpose | Where it lives |
|---|---|---|
| **Funder** | Pays rent + Jito tips throughout the lifecycle | Hot wallet on the same host as the scripts |
| **Creator** | On-chain creator of the coin; signs collects | Hot wallet on the same host (often shared/leaked — that's why we use atomic patterns) |
| **Rewards funder** *(optional)* | Holds USDC for periodic rewards distributions | Separate hot wallet, different host if possible |
| **Destination** | Receives all swept SOL + USDC | **Cold wallet, single-controller, not on the script host** |

**Never** make the destination the same as any working wallet. The atomicity guarantees only protect Solana txs; if the destination's key is also on the live host, you're back to the leaked-key problem.

## Phase 1 — Launch (one-time, ~1 min)

Follow [tutorial 01 — Launch a pump.fun coin via Jito bundle](./01-launch-pump-coin-via-jito.md) end to end. The relevant choices for an end-to-end flow:

- Use the **Jito-bundle path** (`fire-jito.js`), not single-tx.
- Set `DEV_BUY_SOL=0.5` (or whatever your launch size is) so the first buy happens in the same atomic bundle as the create. This prevents sniper bots from front-running you in the gap between create-confirm and your first buy tx.
- Save the **mint address** from the output — you'll need it in Phases 2, 3, and 4.

Output to file off the host immediately:

```bash
# After fire-jito.js succeeds:
echo "MINT=<mint-from-output>" >> ~/coin-meta-${SYMBOL}.txt
echo "CREATOR_PUBKEY=<creator-pubkey>" >> ~/coin-meta-${SYMBOL}.txt
echo "LAUNCHED_AT=$(date -u +%FT%TZ)" >> ~/coin-meta-${SYMBOL}.txt
```

Keep this file off the host that holds the secrets — it's reference-only.

## Phase 2 — Start the watcher (long-running)

Follow [tutorial 02 — Collect creator fees atomically](./02-collect-creator-fees.md), specifically the `watch-collect.js` flow.

Practical guidance for a real long-run:

- **Tune `MIN_COLLECT_SOL`** to where each cycle nets at least 5–10× the tip. If accrual is fast, set 0.1+; for steady coins, 0.05 is sane.
- **Use a process supervisor.** See [tutorial 10 — Production setup](./10-production-setup.md) for `pm2` / `systemd` configs.
- **Watch the supervisor logs** during the first hour to confirm bundles are actually landing. If `Vault: ...` lines keep growing without any `Bundle landed` lines, your `JITO_TIP` is too low — see [tutorial 09 — Jito bundle anatomy](./09-jito-bundle-anatomy.md) for diagnosis.

Phase 2 runs **continuously** for as long as the coin is trading. It can run for weeks/months. Each cycle moves SOL from the vault to `DESTINATION` with no window for sweepers.

## Phase 3 — Distribute rewards (optional, scheduled)

If your coin has a rewards program, follow [tutorial 05 — Distribute USDC rewards](./05-distribute-usdc-rewards.md) on whatever schedule fits (weekly, biweekly, etc.).

Tips for scheduling:

- Run rewards from a **different wallet** than the creator/funder. Reusing keys couples failure modes — losing the launch funder shouldn't lose the rewards pool.
- Schedule via `cron` or a routine runner. Each run is one-shot, exits cleanly, safe to retry on failure.
- If you want **anti-Sybil filtering**, pre-process holders through [tutorial 07 — Wallet provenance](./07-audit-wallet-provenance.md) to drop pump.fun-seeded fresh wallets before passing the holder list to `distribute.js`.

## Phase 4 — Retire the coin (one-time, ~30 sec)

When the coin is dead — no more meaningful trading, no more fee accrual worth tipping for — wind everything down with [tutorial 06 — Consolidate wallets](./06-consolidate-wallets.md).

Pre-flight (in order):

1. **Stop the watcher** from Phase 2. (`pm2 stop watch-collect-<symbol>` or equivalent.)
2. **Rescue any SPL/Token-2022 balances** from creator/funder wallets — see [tutorial 04](./04-rescue-tokens-leaked-key.md). `consolidate.js` only handles SOL.
3. **Sweep any remaining USDC rewards pool** with [tutorial 05](./05-distribute-usdc-rewards.md) in `EMERGENCY=1` mode.
4. **Run `consolidate.js`** to drain vault + creator wallet + funder wallet to `DESTINATION` in one Jito bundle.

After Phase 4 the creator + funder wallets sit at rent minimum. Treat them as permanently retired — never reuse the keys.

## Total cost breakdown

For a typical lifecycle that runs ~30 days with daily fee accrual:

| Phase | Tx count | Approx SOL cost (tips + fees) |
|---|---|---|
| 1. Launch (Jito bundle) | 1 bundle (2 txs) | ~0.006 (rent + tip + fee) |
| 2. Watcher (30 days, ~3 collects/day) | ~90 bundles | ~0.5 (90 × 0.0055) |
| 3. Rewards (4 weekly cycles, 200 holders) | ~40 batched txs | ~0.1 (ATA rents + tx fees) |
| 4. Consolidate | 1 bundle | ~0.011 |
| **Total** | | **~0.6 SOL** in operational overhead |

Tip costs dominate. If you're netting much less than ~0.6 SOL of creator fees over the same period, the toolkit isn't paying for itself — either raise `MIN_COLLECT_SOL` so fewer cycles run, or accept that this particular coin doesn't justify the operational pattern.

## Failure modes across phases

| Phase | Most common failure | Recovery |
|---|---|---|
| 1 | `Bundle: Invalid` (tip too low) | Bump `JITO_TIP`, re-run |
| 2 | Watcher silently stops landing bundles | Check supervisor logs; bump tip; verify RPC isn't rate-limited |
| 3 | RPC throttled mid-distribution | Switch to paid RPC; re-run (script is idempotent per holder) |
| 4 | Tokens still in source wallets | Run [tutorial 04](./04-rescue-tokens-leaked-key.md) first, then re-run consolidate |

See [tutorial 09](./09-jito-bundle-anatomy.md) for deep-dive on bundle-level failures across all phases.

## Next steps

- **Want to harden the long-running side?** Read [tutorial 10 — Production setup](./10-production-setup.md) for supervisor configs, log rotation, and alerting.
- **Want to understand why bundles fail?** Read [tutorial 09 — Jito bundle anatomy](./09-jito-bundle-anatomy.md).
