# Setup

Everything you need before running any of the scripts.

- [Install](#install)
- [Wallets you need](#wallets-you-need)
- [How to fill in `.env`](#how-to-fill-in-env)
- [Funding the funder](#funding-the-funder)
- [Picking an RPC](#picking-an-rpc)
- [Keypair formats: base58 vs JSON](#keypair-formats-base58-vs-json)
- [Jito: tip sizing and tip-account refresh](#jito-tip-sizing-and-tip-account-refresh)
- [Troubleshooting](#troubleshooting)

---

## Install

Node 20 or newer. Then:

```bash
git clone https://github.com/nirholas/atomic.git
cd atomic
npm install
cp .env.example .env
```

Sanity check:

```bash
npm run typecheck   # should pass with no output
npm test            # vitest suite for src/lib/
```

If both pass, the install is good.

---

## Wallets you need

| Role | Why you need it | Holds SOL? | Private key is… |
|---|---|---|---|
| **Funder** | Pays every tx fee, every Jito tip, transfers rent SOL to other wallets in bundles. | Yes — most of your SOL lives here. | …yours alone. Treat as a hot wallet but a private one. Don't share. |
| **Creator** | Becomes the on-chain creator of the pump.fun coin (visible on Solscan / pump.fun). Signs `createV2`, `collectCoinCreatorFee`, and the drain transfers. | No (drained on every collect). Holds a rent-exempt minimum (~0.00089 SOL) just to stay open. | Yours, *or* shared, *or* publicly known. The whole toolkit is designed to be safe even if this key leaks. |
| **Destination** | Where collected SOL settles. Never signs anything in these scripts; you just give the pubkey. | Yes — accumulates fees. | Yours alone. Should be a clean wallet that nothing ever lands in except via these scripts. |
| **Buyer** *(optional, for `buy-jito`)* | Receives tokens from a Jupiter swap. | No (drained by the swap). | Yours, or whichever wallet you want the tokens delivered to. |
| **Mint** *(optional)* | The token mint keypair itself. Used if you want a vanity mint address (see [`grind`](scripts/grind.md)). | N/A. | One-time use — saved only because the public address is the coin's mint. |

Generate fresh keypairs with the Solana CLI:

```bash
solana-keygen new --no-bip39-passphrase --outfile funder.json
solana-keygen new --no-bip39-passphrase --outfile creator.json
solana-keygen new --no-bip39-passphrase --outfile destination.json
```

`.json` files in the repo root are gitignored by default (see [`.gitignore`](../.gitignore)) — only `package.json`, `package-lock.json`, and `tsconfig*.json` are allowlisted.

---

## How to fill in `.env`

[`.env.example`](../.env.example) is a copy-paste template. The variables fall into four groups:

### Connection

```env
RPC_URL=https://api.mainnet-beta.solana.com
```

The public mainnet RPC works for casual use but you will get rate-limited or refused on burst loads. See [Picking an RPC](#picking-an-rpc).

### Wallets (pick *one* form per wallet)

Base58 secret keys (one line each, the format Phantom/Solflare export):

```env
FUNDER_SECRET=<base58 secret>
CREATOR_SECRET=<base58 secret>
```

…or filesystem paths to Solana CLI keypair JSONs:

```env
FUNDER_KEYPAIR=./funder.json
CREATOR_KEYPAIR=./creator.json
```

Most scripts read `*_SECRET` directly via `bs58.decode`. The TS helpers and `distribute.js` accept either form. See [Keypair formats](#keypair-formats-base58-vs-json).

### Per-flow

| Var | Used by | Notes |
|---|---|---|
| `NAME`, `SYMBOL`, `URI` | metadata / launch | `URI` is the output of [`metadata.js`](scripts/metadata.md). |
| `DEV_BUY_SOL` | launch | Currently unused by the bundled scripts (no dev buy implementation); reserved for future. |
| `JITO_TIP` | every Jito-bundle script | SOL. 0.005 is a sane starting bid. |
| `PRIORITY` | every script | Compute-unit price in micro-lamports. 2,000,000 = 0.002 lamports/CU. |
| `DESTINATION` | collect / consolidate / watch-collect | Where SOL ends up. |
| `CREATOR_PUBKEY` | watch-collect | Base58 *pubkey* (not secret) of the wallet whose vault to poll. |
| `MIN_COLLECT_SOL` | watch-collect | SOL threshold before firing a collect (default 0.05). |
| `TARGET_MINT`, `BUY_SOL`, `SLIPPAGE_BPS` | buy | The token to buy and how much. |
| `MINT`, `REWARD_PERCENT`, `MIN_BPS` | distribute | The token whose holders receive USDC rewards. |

### Loading `.env`

The scripts don't auto-load `.env` — they read directly from `process.env`. Two ways to get vars in:

1. **Export inline per command:**
   ```bash
   FUNDER_SECRET=... CREATOR_SECRET=... npm run collect
   ```
2. **Use `dotenv` from your shell:**
   ```bash
   set -a; source .env; set +a
   npm run collect
   ```
   (`set -a` makes every subsequent assignment auto-exported.)

---

## Funding the funder

How much SOL does the funder actually need? Approximate per-operation requirements:

| Operation | Funder needs ≥ | Why |
|---|---|---|
| `metadata.js` | ~0 SOL | No on-chain ops. |
| `fire-atomic-create.js` | `RENT_SOL` + ~0.005 SOL | Default `RENT_SOL=0.035`, so ~0.04 SOL. |
| `fire-jito.js` | `RENT_SOL` + `JITO_TIP` + ~0.002 SOL | Default ~0.042 SOL. |
| `collect-jito.js` | `JITO_TIP` + ~0.002 SOL | ~0.007 SOL/run. |
| `consolidate.js` | `JITO_TIP` + ~0.007 SOL | Leaves a 0.005 SOL buffer after sweeping itself. |
| `buy-jito.js` | `BUY_SOL` + `JITO_TIP` + ~0.007 SOL | Plus enough headroom for any Jupiter ATA rents. |
| `rescue-tokens.js` | `JITO_TIP` + ~0.005 SOL | Includes potential destination ATA rent (~0.002 SOL). |
| `distribute.js` | ~0.01 SOL behind buffer (in *creator* wallet, not funder) | `distribute.js` uses the creator as fee payer, not the funder. |

For a launch + ~20 collects + a final consolidate, fund the funder with **at least 0.2 SOL** as a comfortable working buffer.

---

## Picking an RPC

The public `https://api.mainnet-beta.solana.com` works but:

- Rate-limits aggressively on `getProgramAccounts`, `getParsedTransaction`, and `getSignaturesForAddress`.
- Doesn't expose `getTipAccounts` (Jito-specific).
- Has high latency from most locations.

If you're doing anything more than a one-off, point `RPC_URL` at a paid provider:

| Provider | Notes |
|---|---|
| **Helius** | Best free tier for indexing-heavy ops (`getProgramAccounts` for [`distribute`](scripts/distribute.md), [`check-pump-funding`](scripts/check-pump-funding.md)). |
| **Triton One** | Low-latency mainnet RPC; popular for trading. |
| **QuickNode** | Reliable, regional endpoints. |
| **Solana Foundation public RPC** | Free; aggressive rate limits. |

Jito *bundle submission* always goes to `https://mainnet.block-engine.jito.wtf/api/v1/bundles` regardless of your `RPC_URL` — that endpoint is hardcoded in every `*-jito.js` script.

---

## Keypair formats: base58 vs JSON

There are two common ways to represent a Solana keypair on disk:

1. **Base58 string** — a single line like `4MN…wXt`. This is what Phantom and Solflare's "export private key" buttons give you. The most concise form; easy to paste into a `.env` file.
2. **JSON array** — a 64-element JSON array of bytes, e.g. `[12,34,…,200]`. This is what `solana-keygen new` produces. Easier to inspect / regenerate the public key from.

Conversions:

```bash
# JSON file → base58 (Node one-liner)
node -e 'console.log(require("bs58").encode(Buffer.from(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")))))' funder.json

# Base58 → JSON
node -e 'console.log(JSON.stringify(Array.from(require("bs58").decode(process.argv[1]))))' "<base58 secret>" > funder.json
```

The scripts in this repo overwhelmingly use the base58 form (`FUNDER_SECRET=...`, `CREATOR_SECRET=...`). [`distribute.js`](scripts/distribute.md) is the exception — it accepts either base58 (`CREATOR_SECRET`) or a file path (`CREATOR_KEYPAIR`).

---

## Jito: tip sizing and tip-account refresh

### Tip sizing

The Jito Block Engine runs a per-block auction. Highest tipper in each "auction window" lands. Approximate guidance:

| Tip | Effect |
|---|---|
| 0.001 SOL | The floor. Lands in quiet periods only. |
| 0.005 SOL | Default in this repo. Good baseline. |
| 0.01–0.02 SOL | What you bump to when bundles return `Invalid` or sit unconfirmed for >30 s. |
| 0.05 SOL+ | Pump-launch frenzies. Diminishing returns above this. |

If your bundle isn't landing, check `https://explorer.jito.wtf/bundle/<bundle-id>` (printed by each script on submit) to see whether it was *rejected* (tip too low / blockhash stale) or just not selected.

### Tip-account refresh

Every `*-jito.js` script picks one of 8 hardcoded tip accounts:

```
ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt
HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe
Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY
ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49
DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL
96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5
3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT
DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh
```

If a Jito API change rotates these, you'll get `"Bundles must write lock at least one tip account"` errors. Fetch the current list with:

```bash
curl -s https://mainnet.block-engine.jito.wtf/api/v1/bundles \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getTipAccounts","params":[]}' | jq .result
```

…and replace the `JITO_TIP_ACCOUNTS` constant in each script.

---

## Troubleshooting

### `Missing X` and the script exits

Required env var not set. Re-check `.env` and how you invoked the command. Note that `npm run` only inherits variables that are exported; `FOO=bar npm run …` is fine, but `FOO=bar; npm run …` (separate statements) won't pass `FOO`.

### `Funder needs >= X SOL`

Funder balance is below the threshold the script computed. Top it up. See [Funding the funder](#funding-the-funder).

### `Bundles must write lock at least one tip account`

Jito rejected the bundle because none of your tip-transfer destinations are in their current tip-account list. Refresh — see [Tip-account refresh](#tip-account-refresh).

### `Bundle not confirmed in 60s`

Bundle was submitted but not landed. Causes, in order of likelihood:

1. **Tip too low.** Bump `JITO_TIP`.
2. **Blockhash expired.** Just re-run; the script fetches a fresh blockhash each invocation.
3. **Validator outage / Jito downtime.** Check `https://explorer.jito.wtf` and `https://status.solana.com`.

The printed bundle URL (`https://explorer.jito.wtf/bundle/<id>`) tells you which.

### `Sim failed: InstructionError`

The transaction simulated against an actual error. Read the `Logs:` block the script prints — it will contain something like `Custom program error: 0xN`. Common causes:

- **pump-sdk version drift.** A program upgrade added a required account that the bundled SDK doesn't know about. For *buys*, switch to [`buy-jito.js`](scripts/buy-jito.md) (Jupiter path) instead of any pump-sdk-direct buy.
- **Bonding curve completed / coin migrated.** Once a coin migrates to Raydium, the pump.fun create-vault path stops applying.
- **Insufficient funds for ATA rent.** Bump the funder buffer.

### `From ATA does not exist` (rescue-tokens)

The source wallet has never held the token. Check `MINT` and `FROM_SECRET`. ATAs are *not* created lazily by `transferChecked` on the source side.

### `Vault too small to bother`

[`collect-jito.js`](scripts/collect-jito.md) refuses to run if the creator vault holds < 0.001 SOL — not worth the tip + fee. Wait for more fees to accumulate, or override `MIN_COLLECT_SOL` if you're using [`watch-collect`](scripts/watch-collect.md).

### `Emergency destination has no USDC ATA`

[`distribute.js`](scripts/distribute.md) in `EMERGENCY=1` mode requires the destination to already have an opened USDC ATA. Send 1 USDC to the destination from any wallet first; that opens the ATA.
