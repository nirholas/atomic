---
name: atomic-holder-analysis
description: Use when the user wants to analyze the holder distribution of a pump.fun coin (or any Solana SPL/Token-2022 mint) — concentration, Gini coefficient, top-N percent, histogram by order of magnitude, or detect Sybil signals. Triggers on "analyze holders", "holder distribution", "Gini coefficient", "top 10 holders", "is this coin Sybil", "concentration check", "who holds this mint", "pre-distribute check", or any request to characterize the holder base before running a distribution / airdrop / governance action.
---

# atomic-holder-analysis — holder distribution & Sybil detection

Captures a point-in-time snapshot of a mint's holder distribution and surfaces signals about how the supply is held: concentrated vs flat, organic vs Sybil-suspicious, ready-for-distribution vs not. Output is meant to be a precursor to operational decisions:

- Before [atomic-distribute](../distribute/SKILL.md): is the holder base worth distributing to, or is it Sybil-flooded?
- Before launching: what does "normal" look like, so post-launch you can detect distortions?
- Forensics: did someone Sybil-attack a snapshot date?
- Governance / voting eligibility: who actually owns the supply?

## Script

`tools/analyze-holders.ts` (standalone TypeScript, run with `tsx`)

## Setup

Run from repo root; root `package.json` has the deps.

```bash
npm install   # if not already
```

## Flow

```bash
npx tsx tools/analyze-holders.ts <mint> [rpcUrl]
```

Or via env:

```bash
RPC_URL=https://your-paid-rpc.example/ \
  npx tsx tools/analyze-holders.ts <mint>
```

The output includes:

- **Holder count** — distinct owners with non-zero balance (collapses multi-ATA owners into one).
- **Top-N concentration** — top 1, 5, 10, 25, 50, 100 holders' share of supply.
- **Gini coefficient** — standard inequality measure: 0 = perfectly equal, 1 = one holder owns everything.
- **Order-of-magnitude histogram** — bar chart of holders by balance bucket (10^0 to 10^N).
- **Top 10 holders** — wallet pubkeys, balances, percentages. Useful for spot-checking known wallets (team, treasury, MM).
- **Sybil signals** — heuristic alerts when the distribution looks unnatural.

## Interpreting the numbers

### Gini coefficient

| Gini | Reading | Typical pattern |
|---|---|---|
| 0.0–0.4 | Very flat | Either Sybil (many fresh wallets with similar balances) or distributed via prior airdrop |
| 0.4–0.6 | Moderately flat | Mature coin with broad organic distribution, or post-airdrop |
| 0.6–0.8 | Typical pump.fun coin | Healthy power-law: a few big holders, many small |
| 0.8–0.95 | Concentrated | Team-heavy, MM-heavy, or whale-dominated |
| > 0.95 | Pathological | Single wallet owns near everything; only meaningful for fresh launches or rugged coins |

Pump.fun coins shortly after graduation typically sit 0.7–0.85. Anything below 0.5 with > 100 holders deserves a closer look.

### Top-10 concentration

| % of supply held by top 10 | Reading |
|---|---|
| > 50% | Highly concentrated — treat large holders as price-determining |
| 25–50% | Typical post-launch pump.fun coin |
| 10–25% | Distributed (post-airdrop or mature) |
| < 10% | Either Sybil-flat or a very mature & well-distributed coin |

If top-1 alone is > 20%, that single wallet effectively controls the price. Identify them before doing anything that matters.

### Histogram

A natural distribution forms a roughly monotonic decreasing pattern by order of magnitude: many small holders, fewer medium, very few large. Watch for:

- **A flat plateau** of holders with similar balances (e.g. 50 holders all in the 10^3 bucket): probable Sybil.
- **A bimodal distribution** (peak at very small + peak at very large with a gap in the middle): typical of "team allocation + retail flood" — not Sybil per se but informative.
- **Missing low buckets** (no dust holders): unusual; either someone swept dust, or the coin never had retail interest.

### Sybil signals (heuristic)

The script flags two specific patterns:

1. **Balance clustering**: ≥10% of holders sharing the same balance (within 2 sig figs), AND that cluster has ≥5 members. Natural distributions don't cluster this tightly. Possible same-actor multi-wallet airdrop farming.
2. **Suspiciously flat top-10 with many holders**: top-10 own < 15% of supply across ≥50 holders. Pump.fun coins virtually never reach this distribution organically — usually indicates a deliberate flattening (someone splitting a large bag across many wallets pre-snapshot).

These are heuristics. Absence of signals is not proof of organic; sophisticated Sybil operations vary balance sizes deliberately to avoid clustering. Treat the script as a low-floor filter, not a verdict.

## Use cases

### Pre-distribution check (most common)

Before running [atomic-distribute](../distribute/SKILL.md):

```bash
npx tsx tools/analyze-holders.ts <coin-mint>
```

Look at:
- Is the holder base big enough to warrant distribution? (< 20 holders: probably not worth gas)
- Are the top holders the team / known wallets? (you may want to exclude them via `MIN_BPS` or explicit blocklist)
- Are there Sybil signals? (you may want to combine with [atomic-audit](../audit/SKILL.md) to filter pump-seeded wallets)

### Pre-launch baseline

For a coin you're about to launch, there are no holders yet. But run this on **comparable coins** (similar genre, age, market cap) to set expectations:

```bash
# Run on 3-5 reference coins
for mint in <ref-mint-1> <ref-mint-2> <ref-mint-3>; do
  npx tsx tools/analyze-holders.ts "$mint"
done
```

If post-launch your coin's distribution diverges sharply from comparables, that's a signal — either organic outperformance, or Sybil farming, or MM activity.

### Forensics on a past snapshot

Holder snapshots are point-in-time. To analyze "what did the distribution look like on date X":

- This script uses live RPC; it can't easily backfill historical state.
- For historical state: index pump.fun events from chain history yourself, or use a service that does (Solana FM, Helius's historical APIs).
- The script's signals do still apply if you reconstruct holder lists from history.

### Sybil triage with funding-source check

Combine with [atomic-audit](../audit/SKILL.md) to filter pump-seeded wallets:

```bash
# 1. Identify top suspect wallets from analyze-holders output
npx tsx tools/analyze-holders.ts <mint>

# 2. For each suspect, check provenance
for wallet in <addr1> <addr2> <addr3>; do
  npx tsx tools/check-pump-funding.ts "$wallet"
done
```

A cluster of "flat balance" wallets that are ALL pump-seeded is a strong Sybil signal. A cluster that includes a mix of pump-seeded + CEX-deposited wallets is less suspicious (Sybil usually comes from one funding source).

## RPC considerations

`getProgramAccounts` on a mint can return thousands of accounts. Public mainnet RPC will rate-limit at ~500–1000 accounts. Recommendations:

- For < 500 holders: public RPC works.
- For 500–5000 holders: paid RPC required (Helius / Triton).
- For > 5000 holders: paid RPC with batched pagination, or a dedicated indexer like Solana FM / Birdeye. The script as written makes one `getProgramAccounts` call; for very large mints, expect timeouts and consider an indexer.

## Limitations

- **Active-balance only.** Holders that have closed their token account are not included. For "ever held" you need a historical indexer.
- **One-shot snapshot.** Re-run to get a fresh snapshot; the script does no caching.
- **No off-chain identity.** "Top 10 holders" gives you pubkeys, not names. Look up team / MM / CEX hot wallets externally.
- **Sybil heuristics are easily evaded** by varying balance sizes. Treat absence of signal as inconclusive, not clean.
- **No price weighting.** A holder with 0.01% of supply but a meaningful USD value (because supply is large) is treated the same as a dust holder. For USD-weighted analysis, multiply by spot price externally.

## Related

- [atomic-distribute](../distribute/SKILL.md) — runs after this skill confirms the distribution is worth doing
- [atomic-audit](../audit/SKILL.md) — provenance check for suspect wallets
- [tools/analyze-holders.ts](../../tools/analyze-holders.ts) — the script
- [tools/check-balances.ts](../../tools/check-balances.ts) — single-wallet inverse (one wallet, all its tokens)
