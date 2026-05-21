# 05 — Distribute USDC rewards to holders

You want to pay out USDC rewards to the current holders of a pump.fun coin, weighted to reward larger holders without letting whales dominate. `distribute.js` implements **sqrt-weighted distribution**: each holder's share is `sqrt(balance) / sum(sqrt(balance))`. A holder with 4× the supply of another gets 2× the rewards, not 4×.

The script also supports an `EMERGENCY` mode that sweeps all USDC to a single address — useful for shutting down a rewards program or recovering from a misconfiguration.

## When to use which mode

| Mode | Purpose |
|---|---|
| Normal (sqrt-weighted) | Periodic holder rewards. The standard payout cycle. |
| `EMERGENCY=1` | Immediate sweep of the funder's USDC to one destination. Pause + drain. |

## Prerequisites

- The mint address of the coin whose holders get paid (`MINT`).
- A wallet with USDC balance that signs the payouts (`FUNDER_SECRET`).
  - Also needs ~0.005 SOL for tx fees + ATA-creation rent for any holder missing a USDC ATA.
- **A paid RPC** (Helius / Triton). The script enumerates all token accounts for the mint via `getProgramAccounts`, which is read-heavy and will get rate-limited on public mainnet for any coin with >100 holders.

## Step 1 — Dry-run inspection (recommended)

Before paying anyone, get a feel for the holder set. There's no built-in `--dry-run` flag, but you can read the holder count off-chain first:

```bash
# Solscan or your favorite explorer: open the mint page, check "Holders" count.
# Or via RPC:
curl https://your-rpc/ -H 'Content-Type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"getTokenLargestAccounts","params":["<MINT>"]
}'
```

If the holder count is huge (10k+), consider a higher `MIN_BPS` to keep the per-holder tx fee economic.

## Step 2 — Normal sqrt-weighted distribution

```bash
cd tmp/leaked-launch

MINT=<your-coin-mint> \
REWARD_PERCENT=80 \
MIN_BPS=10 \
FUNDER_SECRET=<base58> \
  node distribute.js
```

What this does:

1. Enumerates all token accounts for `MINT` via `getProgramAccounts`.
2. Filters to holders with ≥ `MIN_BPS` of supply (here, ≥ 0.1%).
3. Computes each holder's share as `sqrt(balance) / sum(sqrt(eligible balances))`.
4. Pays out `REWARD_PERCENT` (here 80%) of the funder's USDC balance, batched into transfer txs of `BATCH_SIZE` payouts each.
5. Creates USDC ATAs for holders missing one (rent ~0.002 SOL each, paid by `FUNDER_SECRET`).

Expected output:

```
Mint: <MINT>
Funder USDC balance: 5,000.00 USDC
Holders enumerated: 1,247
Holders eligible (>=10 bps): 312
Holders skipped (below threshold): 935
Sqrt-weighted distribution: 4,000.00 USDC (80% of funder)
Batches: 16 (BATCH_SIZE=20)
Batch 1/16: tx <sig>... ok
Batch 2/16: tx <sig>... ok
...
Done. Paid 312 holders.
```

## Step 3 — Emergency sweep

```bash
MINT=<your-coin-mint> \
EMERGENCY=1 \
EMERGENCY_DESTINATION=<single-address> \
FUNDER_SECRET=<base58> \
  node distribute.js
```

This bypasses sqrt-weighting entirely and sends **all USDC from `FUNDER_SECRET`** to `EMERGENCY_DESTINATION`. Use for:

- Pausing a rewards program (sweep USDC out of the funder, redistribute later).
- Recovering from a misconfiguration (wrong `MIN_BPS`, wrong `MINT`).
- Shutting down a coin and reclaiming the unused rewards pool.

## Env var reference

| Var | Required | Default | Notes |
|---|---|---|---|
| `RPC_URL` | yes | — | **Paid RPC required** for any coin with many holders |
| `MINT` | yes | — | base58 mint of the rewarded coin |
| `REWARD_PERCENT` | yes (normal) | — | 0–100. % of funder USDC balance to pay out this run |
| `MIN_BPS` | yes (normal) | — | Minimum holder share in basis points. 10 = 0.1% |
| `FUNDER_SECRET` | yes | — | Wallet holding USDC. Signs all payouts |
| `EMERGENCY` | no | 0 | Set to `1` for emergency mode |
| `EMERGENCY_DESTINATION` | yes (emergency) | — | Single address for the sweep |
| `BATCH_SIZE` | no | (sane default) | Payouts per tx. Lower if hitting tx-size limits |

## Gotchas

- **USDC ATA creation cost.** Holders without a USDC ATA need one — the script creates it inline. ~0.002 SOL rent per new ATA, paid by `FUNDER_SECRET`. For a 500-holder run with 50 missing ATAs, budget ~0.1 SOL on top of USDC.
- **Rate limits.** Public mainnet RPC throttles after a few hundred `getAccountInfo` / `getProgramAccounts` calls. **Use a paid RPC for production runs.** A throttled run will silently drop holders from the enumeration.
- **Dust holders.** Setting `MIN_BPS` too low means hundreds of tiny payouts each costing more in tx fees than the payout itself. **10–50 bps is sane.** Holders below threshold are silently skipped (logged with reason).
- **Sybil.** Sqrt weighting flattens whales but doesn't defeat Sybil — a single actor splitting balance across `n` wallets gets `n × sqrt(b)` total share vs `sqrt(n × b)` for the same balance in one wallet. The split wallets win. To mitigate, layer on off-chain gating (e.g. filter using [tutorial 07 — Wallet provenance](./07-audit-wallet-provenance.md) to drop pump.fun-seeded fresh wallets).
- **Pause-pool listings.** If the coin is delisted from pump.fun mid-cycle, on-chain holders are still valid — the script doesn't depend on pump.fun's curve state.
- **Public on-chain.** Every payout is a visible USDC transfer. Anyone can audit who got paid and how much. Don't use this for anything that needs confidentiality.

## Security

`FUNDER_SECRET` holds USDC — typically meaningful amounts. **Keep this key on a host that doesn't double as the leaked/creator wallet.** A common mistake: reusing the launch funder secret as the rewards funder, then losing the rewards pool when the launch funder gets swept. Use a fresh wallet specifically for rewards.

## Next steps

- **Want to exclude pump.fun-seeded wallets** from the holder set (anti-Sybil)? See [tutorial 07 — Wallet provenance](./07-audit-wallet-provenance.md). You can pre-filter the holder list and pass a curated set into a custom variant of this script.
- **Coin is being retired** and you want to drain everything? Sweep USDC with `EMERGENCY=1`, then [tutorial 06 — Consolidate wallets](./06-consolidate-wallets.md) for the SOL side.
