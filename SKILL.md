---
name: atomic
description: Use when the user wants to launch, buy, collect creator fees from, rescue tokens from, or distribute rewards for a pump.fun coin in a way that is atomic across multiple Solana txs (Jito bundles). Also covers the `check-pump-funding` wallet-provenance tool. Triggers on requests like "launch a pump coin", "collect creator fees", "atomic buy via Jito", "rescue tokens from a leaked key", "did pump.fun seed this wallet", or any mention of `fire-jito`, `collect-jito`, `buy-jito`, `consolidate`, `rescue-tokens`, or `distribute`.
---

# atomic — pump.fun launch & fee-collection toolkit

This repo bundles Node scripts that wrap pump.fun creator/collect/trade flows in **Jito bundles** so that multi-tx flows execute atomically. Use it when the naive single-tx path is either over the 1232-byte limit, racing a sweeper bot, or leaks SOL through an intermediate wallet.

## When to invoke

Pick this skill when the user wants to do any of:

- **Launch** a pump.fun coin where the creator wallet is *different* from the wallet paying SOL, or where the creator's key is leaked/shared.
- **Collect creator fees** from a coin without giving other key-holders a window to drain first.
- **Buy** a token while routing around a pump-sdk version drift (uses Jupiter under a Jito bundle).
- **Rescue** SPL / Token-2022 balances from a leaked-key wallet without a sweeper front-running.
- **Distribute** USDC rewards to holders (sqrt-weighted) or sweep-out via `EMERGENCY` mode.
- **Audit** whether a Solana wallet was seeded by pump.fun (provenance check).

Skip this skill for non-pump tasks, generic Solana tx construction, or anything not involving Jito bundles + pump.fun.

## Layout

- `tmp/leaked-launch/` — runnable scripts. `npm install` here, not at the repo root.
- `tmp/leaked-launch-clean/` — sanitized mirror of the same scripts (no local state). Use this when copying out of the repo.
- `tools/check-pump-funding.ts` — standalone TS tool, run with `tsx`.
- `packages/core/src/solana/` — shared helpers (e.g. `detectSeededByPump`) imported by the tools.
- `docs/v2-usdc-rollout/` — context on the V2 USDC pool migration; read before touching buy/sell flows.

## Setup

```bash
cd tmp/leaked-launch
npm install
cp .env.example .env
# fill .env — never commit it
```

Required base vars: `RPC_URL`, `FUNDER_SECRET`, `CREATOR_SECRET` (base58) or `FUNDER_KEYPAIR` / `CREATOR_KEYPAIR` (JSON file paths). Per-flow vars listed below.

## Script index

| Script | Flow | Key env vars |
|---|---|---|
| `metadata.js` | Upload token metadata + image to pump.fun IPFS; prints a URI. | `NAME`, `SYMBOL`, `IMAGE_PATH` |
| `fire-jito.js` | **Jito 2-tx bundle launch.** Funder pays rent + Jito tip in Tx1; creator pays own fee in Tx2 (createV2). On-chain creator = `CREATOR_SECRET`'s pubkey. | `NAME`, `SYMBOL`, `URI`, `FUNDER_SECRET`, `CREATOR_SECRET`, `JITO_TIP`, optional `DEV_BUY_SOL` |
| `fire-atomic-create.js` | Single-tx create. Fee payer = funder; creator signs but does not pay. No Jito. | Same as above minus `JITO_TIP` |
| `collect-jito.js` | One-tx atomic creator-fee collect → `DESTINATION`. No window for a competing key-holder. | `DESTINATION`, `FUNDER_SECRET`, `CREATOR_SECRET` |
| `watch-collect.js` | Long-running poller; runs `collect-jito` when vault ≥ `MIN_COLLECT_SOL`. | `CREATOR_PUBKEY`, `MIN_COLLECT_SOL`, `DESTINATION`, secrets |
| `consolidate.js` | One Jito bundle: collect vault + drain creator + drain funder → `DESTINATION`. | `DESTINATION`, both secrets |
| `buy-jito.js` | Jupiter buy inside a Jito bundle. Use when pump-sdk's buy ix is out of sync with the live program. | `TARGET_MINT`, `BUY_SOL`, `SLIPPAGE_BPS` |
| `rescue-tokens.js` | Atomic SPL / Token-2022 transfer via Jito bundle. Bot cannot insert. | secrets, destination, mint |
| `distribute.js` | Sqrt-weighted USDC rewards to holders. `EMERGENCY=1` sweeps to one address. | `MINT`, `REWARD_PERCENT`, `MIN_BPS` |
| `grind.js` | JS vanity-address grinder. **Slow** — prefer `solana-keygen grind`. | — |

## Typical flows

**Launch (Jito):**

```bash
cd tmp/leaked-launch
NAME="MyCoin" SYMBOL="MEME" IMAGE_PATH=./logo.png node metadata.js
# -> https://ipfs.io/ipfs/<CID>

URI="https://ipfs.io/ipfs/<CID>" NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=... CREATOR_SECRET=... JITO_TIP=0.005 \
  node fire-jito.js
```

**Auto-collect for a leaked creator key:**

```bash
DESTINATION=<safe-wallet> CREATOR_PUBKEY=<base58> MIN_COLLECT_SOL=0.05 \
FUNDER_SECRET=... CREATOR_SECRET=... \
  node watch-collect.js
```

**Provenance audit (no Jito needed):**

```bash
npx tsx tools/check-pump-funding.ts <walletAddress> [rpcUrl]
```

## Operational gotchas

- **Jito tip floor drift.** 0.001 SOL is the documented floor but rarely lands. Start at `JITO_TIP=0.005`; if Jito returns `Invalid` for the bundle, bump to 0.01–0.02.
- **Jito tip-account list.** Hardcoded list can rotate. On `"Bundles must write lock at least one tip account"`, fetch live `getTipAccounts` from the Jito Block Engine RPC and update the script.
- **pump-sdk drift.** When pump.fun adds required accounts (e.g. `BuybackFeeRecipient`) to the buy ix and the local SDK is behind, switch buys to `buy-jito.js` (Jupiter route).
- **Token-2022 sweepers.** Tokens that land in a leaked/shared wallet are typically drained in ~3 s. Use `rescue-tokens.js` patterns to buy-and-transfer atomically.
- **V2 USDC pool.** Buy/sell flows changed for V2-USDC coins — read `docs/v2-usdc-rollout/` before editing buy logic.

## Secrets handling

- Secrets come **only** from env vars (base58) or local JSON keypair files. Never hardcode.
- `.gitignore` excludes `*.json` by default. Do not weaken this. If a build needs a JSON file tracked, add a narrow allowlist exception, never a blanket one.
- If a key is leaked, the patterns in this toolkit (`collect-jito`, `consolidate`, `rescue-tokens`) are how you extract value safely. Sweeper bots watch leaked addresses; SOL that *rests* in such a wallet for more than a few seconds is gone.

## Architecture: why Jito bundles

A pump.fun `create` instruction is near the 1232-byte tx-size ceiling. To have the create tx **come from** the creator wallet (so on-chain attribution matches), you'd also need to fund that wallet with rent SOL atomically — which blows the size limit. Jito bundles split this into two txs that share a blockhash and land all-or-nothing on the block engine. No bot can insert between them. The same atomicity property is what makes `collect-jito`, `consolidate`, `buy-jito`, and `rescue-tokens` safe against same-key sweepers.
