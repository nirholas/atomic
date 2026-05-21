# 01 — Launch a pump.fun coin via Jito bundle

You want to mint a new pump.fun coin where the **on-chain creator** (the address Solscan shows in the create tx) is a wallet *different* from the one paying SOL for rent + Jito tip. Typical reasons:

- The creator wallet is shared or its key is leaked, but you still want clean on-chain attribution.
- You want to insert a same-bundle dev buy without overrunning the 1232-byte tx limit.
- You want MEV protection on launch — no bot can insert between your txs.

This walkthrough covers the full path: metadata upload → Jito-bundle launch → verification.

## Prerequisites

- Two Solana wallets:
  - **Funder** — pays rent and Jito tip. Needs ~0.05 SOL.
  - **Creator** — signs `createV2`. Will be the on-chain creator. Needs 0 SOL going in (the funder transfers rent into it inside the bundle).
- An RPC endpoint (Helius/Triton strongly preferred — public mainnet lands poorly during launches).
- An image file for the coin logo (PNG/JPG, < 1 MB ideal).

## Step 1 — Upload metadata

The metadata script pushes name + symbol + image to pump.fun's IPFS endpoint and returns a URI you'll pass to the launcher.

```bash
# All commands run from the repo root

NAME="MyCoin" \
SYMBOL="MEME" \
IMAGE_PATH=./logo.png \
DESCRIPTION="A meme coin about cats" \
  npm run metadata
```

Expected output:

```
Uploaded to IPFS: https://ipfs.io/ipfs/bafybeih...
```

**Save that URI** — you'll need it in Step 2. The pump.fun IPFS pin is reasonably durable, but copy it into your notes anyway.

## Step 2a — Launch (Jito bundle path, recommended)

```bash
URI="https://ipfs.io/ipfs/bafybeih..." \
NAME="MyCoin" \
SYMBOL="MEME" \
FUNDER_SECRET=<base58-secret> \
CREATOR_SECRET=<base58-secret> \
JITO_TIP=0.005 \
DEV_BUY_SOL=0 \
  npm run launch
```

What happens under the hood:

1. **Tx1 (funder pays):** transfers rent SOL to the creator wallet + adds the Jito tip ix.
2. **Tx2 (creator pays):** runs `pumpfun::createV2` with the IPFS URI. On-chain `creator` field = `CREATOR_SECRET`'s pubkey.
3. Both txs share a blockhash and are submitted to Jito's block engine as one bundle. They land all-or-nothing in a single slot.

Expected output:

```
Bundle submitted: <bundle-id>
Bundle landed in slot <N>
Mint: <mint-address>
Solscan: https://solscan.io/token/<mint-address>
```

If you see `Bundle: Invalid` instead of `landed`, the most common cause is tip starvation — re-run with `JITO_TIP=0.01` or `0.02`.

### Optional: same-bundle dev buy

Set `DEV_BUY_SOL=0.5` to atomically buy 0.5 SOL of the coin from the creator wallet in the same bundle. This is the cleanest way to get the first buy without a sniper bot front-running you in the gap between launch confirm and your first buy tx.

## Step 2b — Launch (single-tx, no Jito)

If you don't care about a same-bundle dev buy and want a smaller blast radius (no tip cost, no Jito dependency), use the single-tx path:

```bash
URI="https://ipfs.io/ipfs/bafybeih..." \
NAME="MyCoin" \
SYMBOL="MEME" \
FUNDER_SECRET=<base58-secret> \
CREATOR_SECRET=<base58-secret> \
  npm run launch-single
```

Here the funder is the fee payer of the create tx, and the creator co-signs but does not pay. On-chain `creator` field is still the creator wallet. Trade-off: no MEV protection, no dev buy, but cheaper and simpler.

**Pick the Jito path** if MEV matters or you want a dev buy. **Pick single-tx** otherwise.

## Step 3 — Verify on chain

Open the Solscan link from the output. Confirm:

- **Creator** field on the token detail page matches your creator wallet's pubkey.
- **Metadata** name/symbol/image match what you uploaded.
- **Bonding curve** account exists (pump.fun automatically initializes it during `createV2`).

If the dev buy was included, you should also see a `buy` instruction inside the same bundle's Tx2.

## Env var reference

| Var | Required | Default | Notes |
|---|---|---|---|
| `RPC_URL` | yes | — | Helius/Triton preferred |
| `FUNDER_SECRET` | yes | — | base58 secret key. Pays rent + tip |
| `CREATOR_SECRET` | yes | — | base58 secret key. On-chain creator |
| `FUNDER_KEYPAIR` / `CREATOR_KEYPAIR` | alt | — | JSON file paths if you prefer those over base58 |
| `NAME`, `SYMBOL`, `URI` | yes | — | Token identity |
| `JITO_TIP` | no | 0.005 | SOL. Bump if bundles return `Invalid` |
| `DEV_BUY_SOL` | no | 0 | Same-bundle buy from creator. 0 to skip |
| `PRIORITY` | no | — | Compute-unit price in microlamports |

## Gotchas

- **Tx-size ceiling.** `createV2` is already near the 1232-byte limit. Adding rent transfer + Jito tip in the same tx blows it — that's why `fire-jito.js` splits into two txs in a bundle.
- **Tip-account rotation.** Jito's tip account list can drift. If you see `Bundles must write lock at least one tip account`, run `npx tsx tools/check-tip-accounts.ts` to diff the live list against the hardcoded one, then update `src/fire-jito.js`. See [tutorial 09](./09-jito-bundle-anatomy.md) for the full debug flow.
- **Funder leak.** If your funder key is also shared/leaked, drain it immediately after launch with `consolidate.js` — see [tutorial 06](./06-consolidate-wallets.md).
- **V2-USDC pools.** Buy/sell flows changed for V2-USDC quote-mint coins. Read `docs/v2-usdc-rollout/` before editing buy logic in `fire-jito.js`.

## Next steps

- **Want to auto-collect creator fees** from the launched coin? See [tutorial 02](./02-collect-creator-fees.md).
- **Need to defend a leaked creator key** while the coin is live? Set up `watch-collect.js` immediately — see [02](./02-collect-creator-fees.md).
- **Buying more of your own coin** later? See [tutorial 03](./03-buy-via-jupiter-jito.md).
