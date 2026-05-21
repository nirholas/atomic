---
name: atomic-collect
description: Use when the user wants to collect pump.fun creator fees atomically — preventing other holders of a shared/leaked creator key from racing to drain the vault, or sweeping creator+funder wallets along with the vault in a single Jito bundle. Triggers on "collect creator fees", "drain pump vault", "collect-jito", "watch-collect", "consolidate funder + creator + vault", or any pump.fun creator-fee withdrawal.
---

# atomic-collect — pump.fun creator-fee collection

Collects accumulated creator fees from pump.fun's `coinCreatorVault` PDA and immediately moves the SOL to a safe destination, in one atomic tx. Designed for the case where the creator key is shared or leaked: any non-atomic flow leaves a window where another key-holder calls `collectCoinCreatorFee` first.

## Scripts (all in `tmp/leaked-launch/`)

| Script | What it does |
|---|---|
| `collect-jito.js` | One-shot collect: `collectCoinCreatorFee` + transfer to `DESTINATION` + Jito tip, all in one tx inside a Jito bundle. Zero window for a competing collector. |
| `watch-collect.js` | Long-running poller. Reads the vault balance every 30 s; runs `collect-jito` when ≥ `MIN_COLLECT_SOL`. |
| `consolidate.js` | One Jito bundle that **drains everything**: vault → safe wallet, creator wallet → safe wallet, funder wallet → safe wallet. Use when retiring a coin or shutting down a leaked key. |

## Setup

```bash
cd tmp/leaked-launch
npm install
cp .env.example .env  # fill in
```

## Flows

**Manual one-shot collect:**

```bash
DESTINATION=<safe-wallet> \
FUNDER_SECRET=<base58> CREATOR_SECRET=<base58> \
JITO_TIP=0.005 \
  node collect-jito.js
```

**Long-running watcher (recommended for leaked keys):**

```bash
DESTINATION=<safe-wallet> \
CREATOR_PUBKEY=<base58-pubkey> \
FUNDER_SECRET=<base58> CREATOR_SECRET=<base58> \
MIN_COLLECT_SOL=0.05 \
  node watch-collect.js
```

`MIN_COLLECT_SOL` should exceed Jito tip + tx fee so each cycle is net-positive. 0.05 is a sane floor; lower it to 0.02 if vault accrual is slow but consistent.

**Full sweep (retire a leaked setup):**

```bash
DESTINATION=<safe-wallet> \
FUNDER_SECRET=<base58> CREATOR_SECRET=<base58> \
JITO_TIP=0.01 \
  node consolidate.js
```

After this, the creator and funder wallets have only rent-exempt minimums. If you also want to extract that, you must close the wallets (delete their accounts), which the script does not do automatically.

## Env vars

- `RPC_URL` — Solana RPC. WS endpoint is not used; HTTP is enough.
- `DESTINATION` — base58 pubkey, the safe wallet receiving funds. **Should not be `CREATOR_PUBKEY` or `FUNDER` pubkey.**
- `CREATOR_PUBKEY` — base58 pubkey, used by `watch-collect.js` to compute the vault PDA without needing the secret to derive it.
- `FUNDER_SECRET`, `CREATOR_SECRET` — both required so the funder pays Jito tip and the creator signs `collectCoinCreatorFee`.
- `JITO_TIP` — SOL, default 0.005.
- `MIN_COLLECT_SOL` — threshold for `watch-collect.js`.

## Gotchas

- **Sweeper bots.** A leaked creator key has other watchers. Any non-atomic flow (collect → wait → transfer) loses the SOL. The Jito bundle pattern here is the only safe option.
- **Vault PDA.** Derived from the coin's mint and creator pubkey. `watch-collect.js` reads `CREATOR_PUBKEY` directly so you can monitor without ever loading the secret if the secret stays on a different host.
- **Jito tip starvation.** If bundles silently fail (`watch-collect` reports zero landings while vault keeps growing), bump `JITO_TIP` first before debugging other failure modes.
- **Same-block contention.** Two atomic collects in the same block from different key-holders will both succeed at the bundle layer but only one will actually land in the slot. Watcher cadence + Jito tip combined are your only edge.

## Security

`DESTINATION` should be a **cold wallet you control alone.** Never set it to an exchange deposit address — exchanges credit on confirmation and a sweeper can still race a non-atomic withdrawal *out* of the exchange if the deposit pubkey is also leaked. The atomicity guarantees of this skill only cover Solana txs, not custodial flows downstream.
