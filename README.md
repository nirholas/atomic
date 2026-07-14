<!--
   █████╗ ████████╗ ██████╗ ███╗   ███╗██╗ ██████╗
  ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║██║██╔════╝
  ███████║   ██║   ██║   ██║██╔████╔██║██║██║
  ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║██║██║
  ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║██║╚██████╗
  ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝
       all-or-nothing pump.fun launching & fee collection
-->

```
   █████╗ ████████╗ ██████╗ ███╗   ███╗██╗ ██████╗
  ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║██║██╔════╝
  ███████║   ██║   ██║   ██║██╔████╔██║██║██║
  ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║██║██║
  ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║██║╚██████╗
  ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝
       all-or-nothing pump.fun launching & fee collection
```

<p align="center">
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-MIT-14F195?style=flat-square"></a>
  <a href="#setup"><img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A520-9945FF?style=flat-square&logo=node.js&logoColor=white"></a>
  <img alt="Solana" src="https://img.shields.io/badge/chain-Solana-00C2FF?style=flat-square&logo=solana&logoColor=white">
  <img alt="Jito" src="https://img.shields.io/badge/bundles-Jito-14F195?style=flat-square">
  <img alt="pump.fun" src="https://img.shields.io/badge/protocol-pump.fun%20V2-9945FF?style=flat-square">
  <img alt="Status" src="https://img.shields.io/badge/status-active-14F195?style=flat-square">
</p>

<p align="center"><i>Atomic create. Atomic collect. No window for a sweeper bot.</i></p>

---

## Table of contents

- [What this is](#pump-launch-toolkit)
- [At a glance](#at-a-glance)
- [Layout](#layout)
- [Docs](#docs)
- [Setup](#setup)
- [Scripts](#scripts)
- [Typical launch flow](#typical-launch-flow)
- [Collecting + auto-collecting](#collecting--auto-collecting)
- [Environment variables](#environment-variables)
- [Security notes](#security-notes)
- [Architecture: why Jito bundles](#architecture-why-jito-bundles)
- [Shared TS helpers (`src/lib/`)](#shared-ts-helpers-srclib)
- [Tests](#tests)
- [Glossary](#glossary)
- [Reference docs](#reference-docs)
- [License](#license)

## At a glance

|     |     |
| --- | --- |
| **Atomic launch** | funder pays rent + Jito tip in Tx1, creator signs `createV2` in Tx2 — both land or neither does |
| **Atomic collect** | `collectCoinCreatorFee` + drain to safe wallet in one tx, so a leaked creator key can't be swept |
| **MEV-aware** | every multi-step money flow runs inside a Jito bundle, so no searcher can interleave |
| **Tiny surface** | plain CommonJS scripts under [`src/`](src/), TS helpers under [`src/lib/`](src/lib/), one CLI tool under [`tools/`](tools/) |
| **Pure env-driven** | every script is configured with environment variables — copy [`.env.example`](.env.example) and go |

<p align="center">
  <img src="docs/assets/jito-bundle-flow.svg" alt="Jito bundle flow: funder + creator combine into one atomic bundle" width="820" />
</p>

# pump-launch-toolkit

Atomic scripts for launching, collecting fees from, and trading pump.fun coins. Built around **Jito bundles** for atomicity across multiple txs — useful when:

- You need the create tx's fee payer to differ from the wallet supplying the SOL (separate funder vs creator)
- The creator wallet has a public/shared private key (e.g. multi-sig setup, or you accept other signers exist) and you want every fee collection to atomically move the SOL to a safe wallet on the same tx
- You want to win the race against MEV/sweeper bots watching specific addresses

> ⚠️ **Secrets handling.** All scripts read keypairs from environment variables (base58) or local JSON files. **Never commit either form.** `.gitignore` excludes `*.json` by default (with allowlist exceptions for `package.json`, `tsconfig.json`, and lockfiles).

## Layout

```
.
├── src/                       Runnable scripts (CommonJS, run via `node src/<name>.js`)
│   ├── fire-jito.js, collect-jito.js, …
│   └── lib/                   Shared TS helpers
│       ├── funding-source.ts  detectSeededByPump implementation
│       ├── programs.ts        Pump.fun program IDs + fee recipients
│       └── funding-source.test.ts
├── tools/
│   └── check-pump-funding.ts  CLI wrapper around detectSeededByPump (run via tsx)
├── .env.example               Copy to `.env` and fill in
├── package.json               npm scripts cover every runnable file
└── tsconfig.json              Type-checks src/lib/ + tools/
```

## Docs

The pages under [`docs/`](docs/) go deeper than this README:

- [**docs/setup.md**](docs/setup.md) — wallets, funding, RPC choice, Jito tip refresh, troubleshooting.
- [**docs/architecture.md**](docs/architecture.md) — funder vs creator, the 1232-byte tx-size constraint, bundle layouts, sweeper-bot threat model.
- [**docs/recipes.md**](docs/recipes.md) — end-to-end flows: launch + auto-collect, rescue from leaked wallet, USDC distribution, etc.
- [**docs/scripts/**](docs/scripts/) — one reference page per runnable file: env vars, tx layout, signing flow, failure modes.

The [`docs/README.md`](docs/README.md) is the index.

## Setup

```bash
npm install
cp .env.example .env
# fill in .env with your keys and target addresses
```

## Scripts

| Script | npm | Purpose |
|---|---|---|
| `src/metadata.js` | `npm run metadata` | Upload token metadata to pump.fun's IPFS endpoint. Returns a URI to pass to launchers. |
| `src/fire-jito.js` | `npm run launch` | **Launch via Jito bundle.** Two-tx bundle: funder pays rent + tip in Tx1; creator pays own fee in Tx2 (createV2). Solscan "from" on the create = creator. |
| `src/fire-atomic-create.js` | `npm run launch-single` | Single-tx create-only launch. No Jito needed. Fee payer = funder; on-chain creator = creator wallet (signed but not fee payer). |
| `src/collect-jito.js` | `npm run collect` | Atomic creator-fee collection. Single tx: pump's `collectCoinCreatorFee` + drain to `DESTINATION`. No window for a competing collector with the same key. |
| `src/watch-collect.js` | `npm run watch` | Long-running poller that runs `collect-jito.js` whenever the vault accumulates ≥ threshold. |
| `src/consolidate.js` | `npm run consolidate` | One-shot: collect creator vault + drain creator wallet + drain funder, all to `DESTINATION`, in one Jito bundle tx. |
| `src/buy-jito.js` | `npm run buy` | Buy a token via Jupiter aggregator using a Jito bundle. Useful when pump-sdk's buy ix is out of sync with the live program. |
| `src/rescue-tokens.js` | `npm run transfer-tokens` | Atomic SPL/Token-2022 transfer via Jito bundle. Bot can't insert. |
| `src/distribute.js` | `npm run distribute` | Sqrt-weighted USDC rewards distribution to holders. Includes `EMERGENCY` mode for sweeping to a single address. |
| `src/grind.js` | `npm run grind` | JS-based vanity address grinder (slow). `solana-keygen grind` is far faster. |
| `tools/check-pump-funding.ts` | `npm run check-funding -- <wallet>` | Check whether a wallet was seeded by pump.fun (first inbound SOL from a fee recipient or migration authority). |

## Typical launch flow

```bash
# 1. Upload metadata (gets a URI)
NAME="MyCoin" SYMBOL="MEME" IMAGE_PATH=./logo.png \
  npm run metadata
# -> https://ipfs.io/ipfs/<CID>

# 2. Launch via Jito bundle (creator = fee payer of create tx)
URI="https://ipfs.io/ipfs/<CID>" \
NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
JITO_TIP=0.005 \
  npm run launch
```

## Collecting + auto-collecting

<p align="center">
  <img src="docs/assets/atomic-collect.svg" alt="Atomic collect: vault drains to destination in one tx; sweeper bot is locked out" width="820" />
</p>

```bash
# Manual one-shot
DESTINATION=<your-safe-wallet> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
  npm run collect

# Long-running watcher (polls every 30s)
DESTINATION=<your-safe-wallet> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
CREATOR_PUBKEY=<base58-pubkey> \
MIN_COLLECT_SOL=0.05 \
  npm run watch
```

## Environment variables

All variables can be supplied via shell env or a `.env` file at the repo root. See [`.env.example`](.env.example) for a copy-paste template.

| Var | Used by | Purpose |
|---|---|---|
| `RPC_URL` | all | Solana RPC endpoint. Public mainnet works; Helius/Triton recommended for production. |
| `FUNDER_SECRET` | most | Base58 secret key of the wallet supplying SOL for rent + tips. |
| `CREATOR_SECRET` | launch / collect | Base58 secret key of the on-chain creator wallet (the address that appears as creator on pump.fun). |
| `FUNDER_KEYPAIR` / `CREATOR_KEYPAIR` | most | Alternative to the `*_SECRET` vars: filesystem path to a Solana CLI keypair JSON. |
| `DESTINATION` | collect / consolidate / distribute | Safe wallet that drained SOL/tokens settle into. |
| `CREATOR_PUBKEY` | `watch-collect.js` | Public key to poll for accumulated creator-fee vault balance. |
| `NAME`, `SYMBOL`, `URI` | metadata / launch | Token name, ticker, and metadata URI. |
| `IMAGE_PATH` | `metadata.js` | Local image to upload to pump.fun IPFS. |
| `DEV_BUY_SOL` | launch | Optional dev-buy size atomically bundled with the create. `0` to skip. |
| `JITO_TIP` | Jito-bundle scripts | Tip in SOL paid to the Jito block engine. 0.005 is a sane start; raise to 0.01–0.02 in busy markets. |
| `PRIORITY` | most | Compute-unit price in micro-lamports. |
| `TARGET_MINT` | `buy-jito.js` | Mint address of the token to buy. |
| `BUY_SOL` | `buy-jito.js` | SOL amount to spend per buy. |
| `SLIPPAGE_BPS` | `buy-jito.js` | Slippage tolerance in basis points (500 = 5%). |
| `MIN_COLLECT_SOL` | `watch-collect.js` | Vault threshold (SOL) before the poller fires a collect bundle. |
| `MINT`, `REWARD_PERCENT`, `MIN_BPS` | `distribute.js` | Token to distribute USDC rewards for, percentage of collected fees to share, minimum holder share in bps. |

## Security notes

- **Sweeper bots watch public/leaked keys.** SOL or tokens that *rest* in such a wallet for more than a few seconds will be drained. The atomic patterns in this toolkit work around this by ensuring funds never settle there.
- **Token-2022 sweepers exist.** If you buy a token *to* a public/shared wallet, expect the tokens to be moved out by other key-holders within ~3 seconds. Use `rescue-tokens.js` patterns to atomically buy-and-transfer if you need plausible deniability about the buyer wallet.
- **Jito tip auctions.** 0.001 SOL is the floor but rarely lands in busy times. Start at 0.005, bump to 0.01–0.02 if bundles return `Invalid` from Jito.
- **Jito tip account rotation.** The hardcoded list may drift. Fetch `getTipAccounts` from the Jito Block Engine RPC if you hit `"Bundles must write lock at least one tip account"` errors.
- **pump-sdk version drift.** The buy instruction may add required accounts that older SDK versions don't include (e.g. `BuybackFeeRecipient`). When this happens, route buys through Jupiter (`buy-jito.js`) instead.

## Architecture: why Jito bundles

A pump.fun create instruction has many accounts and is near the 1232-byte tx size limit. To make the create tx come **from** the creator wallet (so on-chain attribution matches), you'd need to also fund the creator with rent SOL atomically — but that pushes the tx over size.

Jito bundles solve this: two separate txs that share a blockhash and execute atomically (all-or-nothing) on the block engine. No bot can insert between them. This is the basis of `fire-jito.js`, `collect-jito.js`, `consolidate.js`, `buy-jito.js`, and `rescue-tokens.js`.

## Shared TS helpers ([`src/lib/`](src/lib/))

The `src/lib/` directory holds a small set of TypeScript helpers shared between [`tools/`](tools/) and (in future) any TS scripts:

| Module | Exports | Purpose |
|---|---|---|
| [`programs.ts`](src/lib/programs.ts) | `PUMPFUN_FEE_ACCOUNT`, `PUMP_FEE_RECIPIENTS`, `PUMP_FEE_RECIPIENT_SET`, `PUMPFUN_MIGRATION_AUTHORITY` | Canonical pump.fun fee/migration account IDs. |
| [`funding-source.ts`](src/lib/funding-source.ts) | `detectSeededByPump`, `FundingSourceResult`, `DetectSeededByPumpOptions` | Walks a wallet's signatures to its oldest tx, finds the first inbound SOL transfer, and returns whether the sender was a known pump.fun address. |

The library is consumed by [`tools/check-pump-funding.ts`](tools/check-pump-funding.ts).

## Tests

Vitest covers `src/lib/`:

```bash
npm test               # one-shot
npm run test:watch     # watch mode
npm run typecheck      # tsc --noEmit
```

[`tools/check-pump-funding.ts`](tools/check-pump-funding.ts) can be smoke-tested against a known pump-seeded wallet on mainnet — the verdict should be `SEEDED BY PUMP.FUN` with the first funder being one of the pump fee recipients.

## Glossary

- **Funder** — the wallet that pays rent + Jito tips. Holds the bulk of SOL; signs Tx1 of a launch bundle. Generally a fresh, private key.
- **Creator** — the wallet that appears as the on-chain creator on pump.fun. Signs the `createV2` instruction. May have a public or shared private key (which is the whole reason for the atomic collect pattern).
- **Creator vault** — the PDA where pump.fun accumulates creator fees for a coin. Drained via `collectCoinCreatorFee`.
- **Destination** — the safe wallet that collected SOL/tokens are atomically routed to in the same tx, so no sweeper bot has a window to grab them.
- **Jito bundle** — an ordered group of txs submitted to the Jito Block Engine that execute atomically (all-or-nothing) and that no MEV searcher can interleave between. The basis of every `*-jito.js` script.
- **Jito tip** — SOL paid to a Jito tip account in one of the bundle txs. Acts as an auction bid for inclusion. Floor is 0.001 SOL; in busy windows you need 0.005–0.02 SOL to land.
- **Seeded by pump.fun** — a wallet whose first inbound SOL transfer originated from a pump.fun fee recipient or the migration authority. Detected by `detectSeededByPump` / [`tools/check-pump-funding.ts`](tools/check-pump-funding.ts).

## Reference docs

- [**pump.fun V2 USDC Rollout reference**](./docs/v2-usdc-rollout/README.md) — full engineering reference for the 2026-05-21 V2 USDC quote-mint upgrade: instruction & event discriminators, byte layouts, parsing patterns, migration recipes, per-repo audit, and standalone executor prompts under [`prompts/v2-usdc-rollout/`](./prompts/v2-usdc-rollout/).

## Visual index

| Visual | What it shows |
|---|---|
| ![ATOMIC logo](docs/assets/atomic-logo.svg) | Animated ATOMIC mark — three orbiting electron rings over a Solana-themed nucleus. |
| ![Jito bundle flow](docs/assets/jito-bundle-flow.svg) | Funder + Creator → Jito bundle → on-chain atomic create. Same blockhash, one block engine decision. |
| ![Atomic collect](docs/assets/atomic-collect.svg) | `collectCoinCreatorFee` + drain to destination in a single tx. Sweeper bot is locked out — no slot to insert. |

All three live under [`docs/assets/`](docs/assets/) as standalone animated SVGs, so they render inline on GitHub and can be embedded into other docs or talks.

## Command cheat-sheet

| Goal | Command |
|---|---|
| Upload token metadata | `npm run metadata` |
| Atomic launch (Jito) | `npm run launch` |
| Single-tx launch (no Jito) | `npm run launch-single` |
| One-shot creator-fee collect | `npm run collect` |
| Long-running collect watcher | `npm run watch` |
| Buy via Jupiter inside a bundle | `npm run buy` |
| Atomic SPL/Token-2022 rescue | `npm run transfer-tokens` |
| Drain creator + funder to destination | `npm run consolidate` |
| Sqrt-weighted USDC distribution | `npm run distribute` |
| Check whether a wallet was seeded by pump.fun | `npm run check-funding -- <wallet>` |
| Vanity grinder (slow JS) | `npm run grind` |

See [`Scripts`](#scripts) above for the full description of each command, and [`docs/scripts/`](docs/scripts/) for per-script reference pages (env vars, tx layout, signing flow, failure modes).

## License

All rights reserved. See [LICENSE](LICENSE).
