---
name: atomic-launch
description: Use when the user wants to launch a new pump.fun coin where the fee-payer wallet differs from the on-chain creator wallet, or wants on-chain creator attribution to match a specific wallet while a separate funder pays rent + Jito tip. Triggers on "launch a pump coin", "create pump.fun token", "fire-jito", "fire-atomic-create", "upload pump metadata", or any request to mint a pump.fun coin with separate funder vs creator.
---

# atomic-launch — pump.fun coin creation

Launches a pump.fun coin where the **on-chain creator** (the address Solscan shows in the "from" field of the create tx) is a different wallet from the one supplying SOL for rent + tip. Useful when the creator key is shared/leaked or when you want clean on-chain attribution.

## Scripts (all in `tmp/leaked-launch/`)

| Script | What it does |
|---|---|
| `metadata.js` | Uploads name + symbol + image to pump.fun's IPFS endpoint. Returns a `https://ipfs.io/ipfs/<CID>` URI to pass to a launcher. |
| `fire-jito.js` | **Two-tx Jito bundle.** Tx1: funder pays rent + Jito tip and transfers rent to creator. Tx2: creator runs `createV2`. Atomic — no bot can insert. On-chain creator = `CREATOR_SECRET` pubkey. |
| `fire-atomic-create.js` | Single-tx create (no Jito). Funder is the fee payer; creator signs but does not pay. Creator is still on-chain `creator`. Smaller blast radius, no tip cost. |

Pick `fire-jito.js` when you also want a `DEV_BUY_SOL` in the same atomic execution, or when MEV protection matters. Pick `fire-atomic-create.js` otherwise.

## Setup

```bash
cd tmp/leaked-launch
npm install
cp .env.example .env  # fill in
```

## Flow

```bash
# 1. Metadata → IPFS URI
NAME="MyCoin" SYMBOL="MEME" IMAGE_PATH=./logo.png \
  node metadata.js
# -> https://ipfs.io/ipfs/<CID>

# 2a. Jito bundle launch
URI="https://ipfs.io/ipfs/<CID>" NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=<base58> CREATOR_SECRET=<base58> \
JITO_TIP=0.005 DEV_BUY_SOL=0 \
  node fire-jito.js

# 2b. OR single-tx create (no Jito)
URI="https://ipfs.io/ipfs/<CID>" NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=<base58> CREATOR_SECRET=<base58> \
  node fire-atomic-create.js
```

## Env vars

- `RPC_URL` — Solana RPC. Helius/Triton recommended over public mainnet for landing rate.
- `FUNDER_SECRET` / `CREATOR_SECRET` — base58 secret keys. Or use `FUNDER_KEYPAIR` / `CREATOR_KEYPAIR` for CLI JSON file paths.
- `NAME`, `SYMBOL`, `URI` — token identity.
- `JITO_TIP` — SOL. Default 0.005. Bump to 0.01–0.02 if bundles return `Invalid`.
- `DEV_BUY_SOL` — optional same-bundle dev buy. 0 to skip.
- `PRIORITY` — compute-unit price (microlamports).

## Gotchas

- **Tx size.** `create` is already near the 1232-byte limit. Adding rent transfer + tip in the same tx blows it — that's the whole reason `fire-jito.js` splits into two txs.
- **Tip account rotation.** If Jito returns `Bundles must write lock at least one tip account`, the hardcoded tip-account list has drifted; fetch live `getTipAccounts` from the Jito Block Engine RPC and update.
- **Funder wallet sweepers.** If the funder key is also shared, drain it immediately after launch with `consolidate.js` (see [[atomic-collect]]).
- **V2-USDC pools.** Read `docs/v2-usdc-rollout/` before changing buy/sell logic — the discriminators and event layouts shifted.

## Security

Secrets come from env vars or local JSON files only. `.gitignore` excludes `*.json`; do not weaken. Never paste secrets into chat or commits.
