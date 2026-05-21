# 06 — Consolidate vault + wallets in one Jito bundle

You're shutting down a coin or retiring a leaked-key setup. You want to drain:

1. The pump.fun **creator vault** (accumulated creator fees).
2. The **creator wallet's** SOL balance.
3. The **funder wallet's** SOL balance.

…all into one safe destination, in a single Jito bundle so no sweeper bot can race between collections.

`consolidate.js` is the one-shot version of [tutorial 02](./02-collect-creator-fees.md) plus full wallet sweeps. It's destructive in the sense that it leaves the source wallets at rent-exempt minimum — you almost never want to run this on a coin that's still trading.

## When to use this

| Scenario | Run this |
|---|---|
| Coin is dead / retiring it | yes |
| Leaked-key setup fully decommissioned | yes |
| Periodic collection while the coin is still alive | **no** — use [tutorial 02 — `watch-collect.js`](./02-collect-creator-fees.md) instead |
| Need to keep the funder wallet operational | **no** — it'll be drained to rent minimum |

## Prerequisites

- The pump.fun coin's creator key (`CREATOR_SECRET`) — for both the vault collect and the wallet drain.
- The funder key (`FUNDER_SECRET`) — for the funder wallet drain.
- A safe destination pubkey (`DESTINATION`) — cold, single-controller, **not** creator or funder pubkey.
- ~0.01 SOL of headroom (Jito tip + tx fees come out of the funder during the bundle).

## Step 1 — Final pre-flight check

Before running, confirm:

- Vault, creator wallet, and funder wallet balances on Solscan. Make sure you're seeing the amounts you expect.
- `DESTINATION` is a wallet **you control alone**, not an exchange deposit address.
- You've already run [tutorial 04 — Rescue tokens](./04-rescue-tokens-leaked-key.md) for any SPL/Token-2022 balances. This script handles **SOL only** — tokens left in the source wallets will not be rescued.
- You've already run [tutorial 05 — Distribute USDC rewards](./05-distribute-usdc-rewards.md) with `EMERGENCY=1` if there's a USDC rewards pool to sweep.

## Step 2 — Run the consolidation

```bash
cd tmp/leaked-launch

DESTINATION=<safe-wallet-pubkey> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
JITO_TIP=0.01 \
  node consolidate.js
```

Notice the higher default tip (`0.01`) — this bundle is larger than a simple collect, and you're typically running it when you want guaranteed landing rather than penny-pinching on tips.

What's in the bundle (one tx, multiple ixs):

1. `pumpfun::collectCoinCreatorFee` — vault → creator wallet.
2. `system::transfer` — creator wallet → destination (drains creator).
3. `system::transfer` — funder wallet → destination (drains funder), minus tip + tx fee.
4. Jito tip ix.

All four happen atomically. No window for any other party to act on the wallets between steps.

Expected output:

```
Vault balance: 0.124 SOL
Creator wallet balance: 0.041 SOL
Funder wallet balance: 0.082 SOL
Total to move: 0.247 SOL (minus tip + fees ~0.011)
Bundle submitted: <bundle-id>
Bundle landed in slot <N>
Destination credited: 0.236 SOL
Creator wallet remaining: ~0.000089 SOL (rent-exempt minimum)
Funder wallet remaining: ~0.000089 SOL (rent-exempt minimum)
```

## Step 3 — Verify

On Solscan:

- `DESTINATION` balance should reflect the credited amount (~0.236 SOL in the example above).
- Creator and funder wallets should be at rent-exempt minimum (~0.000089 SOL each).
- The coin's vault PDA should be at zero / rent minimum.

Tip + tx fees account for the gap between "total to move" and "destination credited".

## Step 4 — Reclaim the rent (optional)

After consolidation, the creator and funder wallets still hold their rent-exempt minimums (~0.000089 SOL each). To reclaim this, you have to **close the wallets** — i.e. delete their accounts. `consolidate.js` does **not** do this automatically.

To close them, send a tx that empties the lamports to zero (Solana garbage-collects accounts that drop below rent-exempt with no data). Easiest way: use Solana CLI:

```bash
solana transfer --from <creator-keypair-file> ALL <destination-pubkey> --allow-unfunded-recipient
solana transfer --from <funder-keypair-file> ALL <destination-pubkey> --allow-unfunded-recipient
```

This is **not atomic** — you've already drained the meaningful balance, so the residual ~0.0002 SOL total isn't worth a Jito bundle. Skip this step if it's not worth your time; the rent stays locked but harmless.

## Env var reference

| Var | Required | Default | Notes |
|---|---|---|---|
| `RPC_URL` | yes | — | Helius/Triton preferred |
| `DESTINATION` | yes | — | Safe wallet pubkey. **Not** creator or funder pubkey |
| `FUNDER_SECRET` | yes | — | Pays tip + signs funder drain |
| `CREATOR_SECRET` | yes | — | Signs `collectCoinCreatorFee` + creator drain |
| `JITO_TIP` | no | 0.01 | Higher than other scripts — bundle is larger |

## Gotchas

- **One-way operation.** After consolidation, the creator and funder wallets are at rent minimum. Don't run this while the coin is still actively trading — you'll have to refund the funder before any future launches/collects.
- **Tokens not rescued.** The script handles **SOL only.** Any SPL/Token-2022 balances in the source wallets stay there. Run [tutorial 04 — Rescue tokens](./04-rescue-tokens-leaked-key.md) **before** consolidation.
- **USDC rewards pool.** If the funder holds USDC for a rewards program, **that USDC stays in the funder** (this script only moves SOL, since it uses `system::transfer`). Sweep USDC first via [tutorial 05](./05-distribute-usdc-rewards.md) with `EMERGENCY=1`.
- **Higher tip default.** This bundle is larger than a simple collect; the default `JITO_TIP=0.01` reflects that. Bump to 0.02+ for active hours if the bundle returns `Invalid`.
- **Wallet hygiene.** `DESTINATION` should be a wallet you control alone — never an exchange deposit address. The atomicity guarantees only cover on-chain Solana txs.

## Next steps

- Coin is fully retired? You're done. The creator key can be deleted (you've already drained everything it controls).
- Want to verify the consolidation worked from a third-party angle? Use [tutorial 07 — Wallet provenance](./07-audit-wallet-provenance.md) to spot-check the destination wallet's funding lineage.
