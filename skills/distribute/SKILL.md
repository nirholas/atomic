---
name: atomic-distribute
description: Use when the user wants to distribute USDC rewards to holders of a pump.fun coin with sqrt-weighted allocation and a minimum-bps floor, or to do an EMERGENCY sweep of all rewards to a single address. Triggers on "distribute rewards", "pay out holders", "distribute.js", "rewards bot", "sqrt weighted distribution", or "EMERGENCY sweep".
---

# atomic-distribute — sqrt-weighted USDC payouts to holders

Distributes USDC to current holders of a pump.fun coin, with each holder's share computed as `sqrt(balance) / sum(sqrt(balance))` — flattens the curve so whales don't dominate while still rewarding larger holders. Includes a `MIN_BPS` floor so dust holders below threshold are skipped.

## Script

`tmp/leaked-launch/distribute.js`

## Setup

```bash
cd tmp/leaked-launch
npm install
cp .env.example .env  # fill in
```

The script reads all token accounts for `MINT`, applies the weighting, and submits batched USDC transfers from `FUNDER_SECRET` to each eligible holder.

## Flow

**Normal sqrt-weighted distribution:**

```bash
MINT=<your-coin-mint> \
REWARD_PERCENT=80 \
MIN_BPS=10 \
FUNDER_SECRET=<base58-USDC-holder> \
  node distribute.js
```

This pays out 80% of the funder wallet's USDC balance, weighted by sqrt(holder balance), to every holder with at least 0.1% (10 bps) of the supply.

**Emergency sweep (pause + drain):**

```bash
MINT=<your-coin-mint> \
EMERGENCY=1 \
EMERGENCY_DESTINATION=<single-address> \
FUNDER_SECRET=<base58-USDC-holder> \
  node distribute.js
```

`EMERGENCY=1` skips holder weighting entirely and sends all USDC from the funder wallet to one address. Use when shutting down a rewards program or recovering from a misconfiguration.

## Env vars

- `RPC_URL` — Solana RPC.
- `MINT` — base58 mint address of the coin whose holders receive rewards.
- `REWARD_PERCENT` — percentage of the funder's USDC balance to distribute this run (0–100).
- `MIN_BPS` — minimum holder share (basis points of supply) to be included. 10 bps = 0.1%.
- `FUNDER_SECRET` — base58 secret of the USDC-funded wallet that signs and pays.
- `EMERGENCY` — set to `1` to override sqrt logic and sweep to one address.
- `EMERGENCY_DESTINATION` — destination for emergency mode.
- `BATCH_SIZE` — number of transfers per tx (default reasonable, lower if hitting size limits).

## Holder set

The script enumerates all SPL token accounts for `MINT` via `getProgramAccounts` filtered on mint. This is read-heavy — use a paid RPC (Helius/Triton) for any coin with >100 holders or you will get rate-limited.

Holders below `MIN_BPS` are silently dropped. The script logs each skipped holder + reason so you can audit after.

## Gotchas

- **USDC ATA creation.** Holders without a USDC associated token account require one; the script creates them inside the same batch tx. This costs ~0.002 SOL per new ATA, paid by `FUNDER_SECRET`. Make sure the funder has enough SOL on top of the USDC.
- **Pause-pool listings.** If the coin is delisted from pump.fun, on-chain holders are still valid. The script doesn't depend on pump.fun's curve state.
- **Rate limits.** Public mainnet RPC will rate-limit after a few hundred `getAccountInfo` / `getProgramAccounts` calls. Use a paid RPC for production runs.
- **Dust holders.** Setting `MIN_BPS` too low means hundreds of tiny payouts each costing more in tx fees than the payout itself. 10–50 bps is sane.
- **Sybil.** Sqrt weighting flattens whales but doesn't defeat Sybil — a single actor splitting across many wallets gets more than they would by holding in one wallet (`n * sqrt(b)` > `sqrt(n*b)`). Live with it, or layer on additional gating off-chain.

## Security

`FUNDER_SECRET` here holds USDC — typically a meaningful amount. Keep this key on a host that doesn't double as the leaked/creator wallet. The distribution is on-chain public; anyone can see which holders got paid and how much.
