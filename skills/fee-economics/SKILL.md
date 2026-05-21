---
name: atomic-fee-economics
description: Use when the user is reasoning about pump.fun creator-fee economics — when to collect, what threshold to use for the watch-collect loop, how to compare collect cost vs accrual rate, when to consolidate vs let fees accumulate, or whether a coin's fee stream is worth the operational cost. Triggers on "is it worth collecting", "what MIN_COLLECT_SOL should I use", "fees vs tip cost", "break-even point", "collect frequency", "fee curve", "creator fee economics", or "creator rewards math".
---

# atomic-fee-economics — pump.fun creator-fee economics

A pump.fun coin's creator earns a percentage of every buy + sell into the `coinCreatorVault` PDA. Collecting those fees costs SOL (Jito tip + tx fee + the operational overhead of running a watcher). This skill helps the operator make the cost/benefit call: how often to collect, what threshold to set, when to stop bothering.

## The core trade-off

Every collect cycle costs roughly:

| Cost component | Typical value |
|---|---|
| Jito tip | 0.001–0.01 SOL (median ~0.005) |
| Tx fee + priority | ~0.00001 SOL (negligible) |
| Destination ATA rent (only first time per token) | ~0.002 SOL one-time |
| Operator attention / watcher uptime | Variable; if running watch-collect, ~$0 marginal |

Round to **~0.005 SOL per collect cycle** as a working estimate. That's your break-even per cycle.

If `MIN_COLLECT_SOL` is set too low, you collect frequently but burn most of the proceeds on tips. If set too high, fees accumulate slowly but each collection is net-positive — and the SOL sitting in the vault is at risk if the creator key is leaked.

## Picking `MIN_COLLECT_SOL`

For [atomic-watch](../watch/SKILL.md):

| Scenario | Suggested `MIN_COLLECT_SOL` | Rationale |
|---|---|---|
| Clean creator key, low-volume coin | 0.05–0.1 SOL | Maximize net yield; SOL in vault is safe |
| Clean creator key, high-volume coin | 0.01–0.03 SOL | Fees accrue fast enough that frequent low-overhead collects don't hurt |
| Leaked / shared creator key | 0.005–0.01 SOL | Minimize time SOL spends in the vault; every collect is also a race vs same-key sweepers |
| Leaked key + active sweeper present | 0.001 SOL | Continuous race mode. Accept that you'll net-lose to tips some cycles |
| Retired coin (no new trade volume) | Don't bother running watch-collect | Run [atomic-collect](../collect/SKILL.md) manually once, then stop |

The leaked-key case is the most aggressive setting: you're not optimizing for net yield, you're optimizing for not losing the SOL to a competitor. Sometimes the right move is to accept negative net per-cycle in exchange for denying the adversary.

## Estimating accrual rate

Pump.fun's creator fee is a small percentage of each trade (the exact percentage has shifted; check current pump-sdk constants). For a quick rule of thumb:

- A coin doing 10 SOL of daily volume yields very roughly 0.05–0.15 SOL of creator fees per day.
- A coin doing 100 SOL of daily volume → roughly 0.5–1.5 SOL/day.
- A coin doing 1000+ SOL of daily volume → meaningful fee income; can sustain aggressive collect cadence.

These are illustrative. The actual rate depends on the current pump.fun fee parameters at the time of trading.

To get a real estimate:

1. Run [atomic-watch](../watch/SKILL.md) with a low `MIN_COLLECT_SOL` for 24 hours.
2. Count the collects. Each collect harvested at least the threshold.
3. Total collected SOL ÷ hours = SOL/hour accrual.
4. From there, decide the optimal threshold: pick a value where you collect once every 1–4 hours during peak trading.

## When to consolidate vs keep collecting

[atomic-consolidate](../consolidate/SKILL.md) is destructive in the sense that it drains the creator wallet + funder wallet too, not just the vault. Use it when:

- **Retiring the coin's operational footprint.** No more launches from this creator, want everything in cold storage.
- **The creator key just leaked.** Stop running watch-collect (sweepers will race you), drain everything once via consolidate, never use the wallet again.
- **Migrating to a new funder.** Drain the old funder + creator into a destination, generate fresh wallets.

Don't consolidate if you're still actively launching from the creator wallet — rent loss on closed accounts adds up if you re-open them later.

## Cost of NOT collecting

SOL sitting in the `coinCreatorVault` PDA earns no yield. It also:

1. **Is at risk if the creator key leaks.** Larger vault = larger target.
2. **Is in a PDA you don't control directly.** Only `collectCoinCreatorFee` can withdraw it, and that requires the creator key.
3. **May be subject to program changes.** A pump.fun program upgrade could theoretically change vault accessibility (this hasn't happened, but the risk is non-zero).

For these reasons, even at low accrual rates, periodic collection is worth doing. Setting `MIN_COLLECT_SOL=0.5` and getting one collect per month is fine for a low-volume coin.

## Math: break-even threshold

For watch-collect, you're net-positive when:

```
collected_amount - jito_tip - tx_fee > 0
```

With `tx_fee ≈ 0` and `jito_tip = 0.005`:

```
collected_amount > 0.005 SOL
```

So `MIN_COLLECT_SOL = 0.005` is the theoretical break-even. In practice, set it higher for two reasons:

1. **Jito tip volatility.** During congestion, you'll bump tips to 0.01–0.02 to land. A `MIN_COLLECT_SOL=0.005` then becomes net-negative every congested cycle.
2. **Slot competition.** If you're racing a sweeper, your bundle may need higher tips than usual to land. Same effect.

A practical floor is `MIN_COLLECT_SOL = JITO_TIP × 5`, so even worst-case congestion is net-positive.

## When to stop collecting at all

There's a point where the operational overhead of running watch-collect (RPC costs, monitoring, alerting on failures) exceeds the fee income. Rough heuristic:

| Daily accrual | Should you run watch-collect? |
|---|---|
| > 0.5 SOL/day | Yes, definitely |
| 0.1–0.5 SOL/day | Yes, with a higher `MIN_COLLECT_SOL` (e.g. 0.1) to collect less often |
| 0.01–0.1 SOL/day | Marginal. Manual collect once a week or use `MIN_COLLECT_SOL=0.3+` |
| < 0.01 SOL/day | No. Run [atomic-collect](../collect/SKILL.md) manually whenever you remember |
| 0 (coin abandoned) | No |

If the coin is genuinely dead, just run a final collect + consolidate and move on.

## Edge cases

- **V2 USDC pools pay creator fees in USDC, not SOL.** The vault PDA logic is different, the script behavior is different, and the economics math above is in USDC units. See [atomic-v2-migration](../v2-migration/SKILL.md). The break-even logic is the same but in USDC terms — at $0.005-ish USDC per cycle, `MIN_COLLECT_USDC ≈ 0.025`.
- **Coin graduates to Raydium (or other AMM).** Pump.fun creator fees may stop accruing or change rate post-graduation. Verify with current pump-sdk docs.
- **Vault PDA balance includes the rent-exempt minimum.** Collecting "the full balance" leaves the PDA rent-exempt floor in place (~0.002 SOL). Not actually a loss — that SOL stays accessible to the next collect cycle.
- **Multi-coin operator.** If you run many coins from one funder wallet, watch-collect instances share the funder's SOL pool. Make sure the funder has enough for the worst-case simultaneous collect across all of them.

## Decision flow

```
Does the coin still have trade volume? 
├─ NO → final manual collect, then stop
└─ YES → is the creator key leaked / shared?
    ├─ YES → run watch-collect with low MIN_COLLECT_SOL (0.005–0.01); race-mode
    └─ NO → what's the daily accrual rate?
        ├─ < 0.01 SOL/day → manual collect monthly
        ├─ 0.01–0.5 SOL/day → watch-collect with MIN_COLLECT_SOL=0.05–0.1
        └─ > 0.5 SOL/day → watch-collect with MIN_COLLECT_SOL=0.01–0.05 (low-friction)
```

## Related

- [atomic-collect](../collect/SKILL.md) — manual one-shot
- [atomic-watch](../watch/SKILL.md) — long-running collector
- [atomic-consolidate](../consolidate/SKILL.md) — drain everything (creator wallet, funder wallet, vault)
- [atomic-leaked-key-response](../leaked-key-response/SKILL.md) — when economic math is overridden by security priorities
- [atomic-v2-migration](../v2-migration/SKILL.md) — USDC-quoted coins have different fee math
- [atomic-bundle-debug](../bundle-debug/SKILL.md) — when collect bundles repeatedly fail (eating tips for no SOL)
