---
name: atomic-consolidate
description: Use when the user wants to drain a coin's creator vault plus the creator wallet plus the funder wallet — all into a single safe `DESTINATION` — in one atomic Jito bundle. Used to retire a coin or recover from a leaked-key situation without leaving any residual SOL on intermediate wallets. Triggers on "consolidate wallets", "consolidate.js", "drain funder + creator + vault", "retire pump coin", "sweep everything to safe wallet", or any request to clear three wallets into one in a single tx.
---

# atomic-consolidate — drain creator vault + creator + funder into one safe wallet

`src/consolidate.js` is a one-shot script that builds a single Jito bundle which:

1. **Collects** the coin's creator-fee vault (via PumpSwap's `collectCoinCreatorFee`).
2. **Transfers** all SOL from the creator wallet to `DESTINATION`.
3. **Transfers** all SOL (minus a small reserve for the bundle's own fees) from the funder wallet to `DESTINATION`.

All three transfers land in the same bundle. No window for a sweeper to insert between steps.

## When to invoke

Pick this skill when the user wants to:

- **Retire a pump.fun coin** they launched. Get all residual SOL out cleanly.
- **Respond to a leaked creator key** (paired with [`docs/runbooks/leaked-key-response.md`](../../docs/runbooks/leaked-key-response.md)). Move everything to a fresh wallet before sweepers do.
- **End a campaign** where the funder + creator + vault are all expected to wind down together.

Skip this skill if the user only wants:

- The vault drain only → use `skills/collect/`.
- A specific token transfer (not SOL) → use `skills/rescue/`.
- Long-running auto-collect → use `skills/watch/`.

## Required environment

```bash
RPC_URL=...
FUNDER_SECRET=<base58>          # or FUNDER_KEYPAIR=./funder.json
CREATOR_SECRET=<base58>         # or CREATOR_KEYPAIR=./creator.json
MINT=<base58>                   # the pump.fun coin's mint
DESTINATION=<base58>            # safe wallet; refuses to run if == funder
JITO_TIP=0.005                  # raise to 0.01-0.02 in busy markets
```

The script asserts:

- `DESTINATION != FUNDER` (typo guard).
- `DESTINATION != CREATOR` (you wouldn't drain the creator to itself).
- Bundle fits within the 1232-byte tx-size budget across all three transfers.

## Usage

```bash
npm run consolidate
# or
node src/consolidate.js
```

Output shows the bundle ID and a Solscan link per tx. The bundle resolves within 1-2 slots in normal conditions.

## Failure modes and fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"DESTINATION matches funder — refusing to run"` | Typo in `.env`. | Set a *different* safe wallet. |
| `"Bundle was rejected: Invalid"` | Jito tip-account drift, or tip below clearing price. | Run `npm run check-tip-accounts`; raise `JITO_TIP`. |
| `"InsufficientFunds"` on the bundle | Funder wallet too low for tip + network fees. | Top up the funder before running. |
| `"creator vault is empty"` | Vault has nothing to collect (new coin, or already drained). | Skip the collect step — set `SKIP_VAULT_COLLECT=1` to just drain wallets. |
| Bundle drops with no error | Block leader isn't Jito-aware. | Wait 1-2 slots; the script retries automatically. |

## Worked example

Retiring a coin called MEME (mint `Memo...`) launched from creator `7xKp...3nRm` with funder `3mFq...8vLp`, sweeping to safe wallet `9aHj...2wXk`:

```bash
RPC_URL=https://api.mainnet-beta.solana.com \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
MINT=MemoXX...XX \
DESTINATION=9aHj...2wXk \
JITO_TIP=0.01 \
  npm run consolidate
```

Successful run prints a bundle ID and three Solscan links. Verify on-chain that:

1. Creator vault balance is now 0.
2. Creator wallet balance is now 0 (or close to it; some lamports may remain for rent).
3. Funder wallet balance is now 0 (or close to it; the script reserves a tiny amount for fees).
4. Destination balance increased by approximately the sum of the three.

## Reference

- Script: [`src/consolidate.js`](../../src/consolidate.js)
- Per-script docs: [`docs/scripts/consolidate.md`](../../docs/scripts/consolidate.md)
- Related runbook: [`docs/runbooks/leaked-key-response.md`](../../docs/runbooks/leaked-key-response.md)
