---
name: atomic-buy
description: Use when the user wants to buy a pump.fun (or any Solana SPL) token via a Jito bundle, especially when the pump-sdk buy instruction is out of sync with the live program. Routes via Jupiter aggregator inside a Jito bundle for atomicity and front-running protection. Triggers on "buy a pump coin", "buy-jito", "jupiter buy via jito", "sniper buy", or any token purchase where atomicity matters.
---

# atomic-buy — Jupiter buy inside a Jito bundle

Buys a token using Jupiter as the router, wrapped in a Jito bundle so the buy + tip land atomically. Use this instead of pump-sdk's direct `buy` ix whenever the SDK is behind the live pump.fun program (e.g. the program added a `BuybackFeeRecipient` account and the local SDK doesn't include it).

## Script

`tmp/leaked-launch/buy-jito.js`

## Setup

```bash
cd tmp/leaked-launch
npm install
cp .env.example .env  # fill in
```

## Flow

```bash
TARGET_MINT=<base58-mint-address> \
BUY_SOL=0.01 \
SLIPPAGE_BPS=500 \
FUNDER_SECRET=<base58> \
JITO_TIP=0.005 \
  node buy-jito.js
```

`SLIPPAGE_BPS=500` = 5%. Lower it to 100–200 for stable pools, raise to 1000+ for fresh launches with extreme volatility.

## Env vars

- `RPC_URL` — Solana RPC. Jupiter quote uses its own endpoint, but tx submission goes through `RPC_URL` / Jito.
- `TARGET_MINT` — base58 mint address of the token to buy.
- `BUY_SOL` — amount of SOL to spend.
- `SLIPPAGE_BPS` — Jupiter slippage in basis points. 500 = 5%.
- `FUNDER_SECRET` — base58 secret of the wallet receiving the tokens and paying for the buy. (Despite the name, this is the buyer here, not a separate funder.)
- `JITO_TIP` — SOL, default 0.005.

## When to use vs pump-sdk direct buy

| Situation | Use |
|---|---|
| pump-sdk version matches live program | pump-sdk `buy` ix (cheaper, no Jupiter slippage) |
| pump-sdk lagging behind program upgrade | `buy-jito.js` (Jupiter) |
| Buying into a leaked/shared wallet | `buy-jito.js` + immediate `rescue-tokens.js` chain (see [[atomic-rescue]]) |
| Sniping at launch with MEV protection | `buy-jito.js` with high `JITO_TIP` |

## Gotchas

- **Token-2022 sweepers.** If the buyer wallet is leaked/shared, tokens land for ~3 s before a sweeper drains them. Chain with [[atomic-rescue]] (atomic buy-and-transfer) instead of buying to a leaked wallet directly.
- **Jupiter quote staleness.** Quote → tx build → bundle submit can take 1–2 s. On fresh-launch pools, the price can move past your slippage in that window. Either raise `SLIPPAGE_BPS` or accept some buy attempts will fail.
- **Jito tip floor.** 0.001 SOL is the documented floor but rarely lands during launches. Start at 0.005 and bump to 0.02+ for hot launches.
- **V2-USDC pools.** Buy routing changed for V2-USDC coins. Read `docs/v2-usdc-rollout/` before editing this script.

## Security

The buyer secret (`FUNDER_SECRET` here) holds the tokens after the buy. If that wallet is leaked, the tokens are gone within seconds of confirmation. Always buy to a wallet you control alone, or chain the buy with an atomic transfer ([[atomic-rescue]]).
