# Runbook: tip too low

Your bundles are submitted but not landing, and the diagnostic in [`bundle-not-landing.md`](bundle-not-landing.md) points to "tip below market." This runbook covers how to set a tip that actually wins inclusion.

**Time budget:** 5 minutes to check the current market and bump.

---

## The tip auction, in one paragraph

Jito's block engine ranks competing bundles by **tip per CU consumed**. The top bidders fill the block engine's allocated share of the block until block CU budget runs out, then the rest are dropped. Your bundle's chance of landing is determined entirely by where your tip lands in the recent percentile distribution. During quiet markets the 25th percentile lands. During spikes you need the 90th.

This is not a "set it and forget it" parameter. The market moves, sometimes within minutes.

---

## Where to read the current market

### 1. Jito's own tip statistics

https://www.jito.wtf/ shows a live tip percentile chart. Look at:

- **25th percentile**: minimum for "probably lands during quiet hours."
- **50th percentile**: comfortable margin during normal load.
- **75th percentile**: needed during active markets (most launches, US business hours).
- **95th percentile**: needed during a major meme spike or coordinated launch.

Read the chart, pick a target percentile, set `JITO_TIP` to that value.

### 2. Per-region statistics

Some block engine regions are busier than others. The Amsterdam/Frankfurt regions tend to have higher floors than NY/SLC during US off-hours. If you're submitting through `mainnet.block-engine.jito.wtf` (the auto-router), you don't choose the region; pick a specific region if you want predictable behavior.

### 3. Empirical: your own landing rate

If you've been launching frequently, your own landing/drop history is the best market signal:

```
Last 10 bundles at tip 0.005 SOL: 4 landed, 6 dropped → tip too low
Last 10 bundles at tip 0.01 SOL: 9 landed, 1 dropped → tip about right
Last 10 bundles at tip 0.02 SOL: 10/10 landed → tip slightly too high
```

The toolkit's scripts log every bundle's outcome — grep the logs.

---

## Tip vs priority fee: they are different things

These are often confused:

| | Solana priority fee | Jito tip |
|---|---|---|
| Set via | `SetComputeUnitPrice` instruction | `SystemProgram.transfer` to tip account |
| Paid to | Validator producing the block | Jito (specifically: the tip account, redistributed back to validators on Jito's terms) |
| Affects | Within-block ordering (regular tx pipeline) | Whether the bundle enters the block engine's auction at all |
| Refundable on revert | No | No |

You typically pay both. `PRIORITY` env var sets the priority fee; `JITO_TIP` sets the tip. Setting one to zero rarely makes sense — even Jito bundles benefit from priority fee tightening, and a non-bundle tx with no priority fee won't land during congestion.

Default values in this repo:
- `PRIORITY=100000` (100,000 micro-lamports = 0.0001 SOL on a 1M CU tx). Low end of reasonable.
- `JITO_TIP=0.005` (SOL). Median quiet-market.

---

## Sizing the tip relative to your operation's value

The tip is an absolute SOL amount, not a percentage. For:

- **A launch with 1 SOL dev-buy**: tip of 0.005–0.02 (0.5–2% of operation value) is normal.
- **A collect of 0.1 SOL from the vault**: tip of 0.005 (5% of operation value) is normal. Lower-value collects are why [`watch-collect.js`](../scripts/watch-collect.md) has `MIN_COLLECT_SOL` — below the threshold, the tip eats the gain.
- **A consolidate sweep of 10+ SOL**: tip of 0.01–0.05 is reasonable; the tip is a small fraction.

If your tip exceeds 5% of the operation's value, something is wrong:
- Either the operation is too small to justify a Jito bundle (use a regular tx instead).
- Or the market is so congested you should wait for it to clear.

---

## When raising the tip doesn't help

A higher tip does not help if:

1. **Your bundle's blockhash has already expired.** Refresh blockhash first. No tip will land an expired bundle.
2. **Your bundle is malformed.** A bundle the block engine rejects pre-auction (missing tip account, > 1232 byte tx, missing signatures) won't land at any tip.
3. **Your RPC is degraded.** If your client can't fetch a fresh blockhash, raising the tip is irrelevant.
4. **The block engine is having an outage.** Brief outages happen; check Jito's status page.
5. **There's a slot-leader gap.** If the next 2 leaders aren't running Jito-modified validators, no Jito bundle can land regardless of tip. Wait 30 seconds for a Jito-running leader.

---

## When to lower the tip

You should lower the tip if:

1. **Your last 10 bundles all landed at the current tip.** You're overbidding.
2. **The operation's value is small.** A 0.05 SOL collect with a 0.02 SOL tip is 40% overhead.
3. **You're running `watch-collect.js` long-term.** Constant 0.02 SOL tips on small collects compound into significant cost. Tune `MIN_COLLECT_SOL` upward or `JITO_TIP` downward.
4. **You're testing on devnet/localnet.** No need for a Jito tip there; the block engine isn't watching, and the bundle's all-or-nothing property comes from the protocol, not the bid.

---

## A tipping policy that works

For automated operations (`watch-collect.js`, scheduled launches), set tips dynamically rather than hardcoded:

```javascript
async function tipForCurrentMarket() {
  // Fetch the last 100 landed bundles
  const recent = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor")
    .then(r => r.json());
  // Pick the 75th percentile
  return recent.landed_tips_75th_percentile_lamports;
}
```

This is not in the toolkit by default (the scripts use a fixed `JITO_TIP`) but is the natural extension when you outgrow manual tuning.

Conservative baseline policy:

| Operation | Tip |
|---|---|
| Launch during quiet market (off-hours) | 0.005 SOL |
| Launch during US business hours | 0.01 SOL |
| Launch during a meme spike | 0.02–0.05 SOL |
| Routine collect (< 1 SOL value) | 0.001 SOL (floor) |
| Routine collect (1–10 SOL value) | 0.005 SOL |
| Routine collect (10+ SOL value) | 0.01 SOL |
| Rescue from leaked wallet (any value) | 0.01 SOL minimum (race against sweeper) |
| Consolidate (multi-wallet sweep) | 0.005 SOL |

These are starting points. Adjust based on your landing rate.

---

## Anti-pattern: tip too high "to be safe"

Tipping 0.1 SOL on a 1 SOL operation seems safe but actually creates a different failure mode:

- **You spend 10% of the operation's value on tips, even when it would have landed at 0.005.** Across many operations this is significant.
- **You set a precedent.** If other searchers see your tip pattern, they'll bid against you, raising the market floor for everyone (including future-you).

The right answer is *responsive* tipping, not *overshooting* tipping. Start at the 50th percentile, observe landing rate, adjust.

---

## Anti-pattern: tip too low because "I'll just retry"

A bundle that doesn't land still costs:
- The opportunity cost of the operation (your collect is delayed, your launch missed a window).
- The blockhash window — if you wait too long to retry, you have to rebuild the bundle.
- Mind share — debugging a "why didn't it land" is a 5-minute distraction.

The cheapest tip is the one that lands first try. Set the tip ~one percentile band above your tolerable drop rate.

---

## Related

- [`docs/runbooks/bundle-not-landing.md`](bundle-not-landing.md) — when nothing is landing at all
- [`docs/jito-bundle-mechanics.md`](../jito-bundle-mechanics.md) — how the tip auction works
- [`docs/architecture.md`](../architecture.md) — the role of Jito in this toolkit
