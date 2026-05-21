# 04 — Rescue tokens from a leaked wallet

You bought (or otherwise hold) SPL or Token-2022 tokens in a wallet whose secret key is shared, leaked, or otherwise watched by sweeper bots. Token-2022 sweepers in particular run aggressively — tokens that land in such a wallet are typically drained in ~3 seconds.

`rescue-tokens.js` constructs an atomic transfer inside a Jito bundle so no sweeper can insert a competing tx between read and write. The pattern works for both classic SPL Token (`Tokenkeg…`) and Token-2022 (`TokenzQd…`) mints, including those with transfer hooks (when the hook program is recognized).

## When to use this

- **Just-bought tokens in a leaked wallet** — chain after [tutorial 03](./03-buy-via-jupiter-jito.md).
- **Existing balances in a leaked/shared wallet** — periodic sweeps to a safe wallet.
- **Mass rescue** — loop the script across multiple mints. Each rescue is its own bundle; sweepers will race but the per-bundle atomicity guarantees you win the bundles that land.

## Prerequisites

- The secret of the leaked / source wallet (`SOURCE_SECRET`).
- A safe destination pubkey (`DESTINATION`) — cold, single-controller.
- The mint address of the tokens you're rescuing (`MINT`).
- **SOL to pay the bundle.** If the source wallet's SOL has already been drained (sweepers typically take SOL first), supply a separate clean wallet via `RENT_PAYER_SECRET`.

## Step 1 — Rescue full balance

```bash
# All commands run from the repo root

SOURCE_SECRET=<base58>                    # leaked wallet
DESTINATION=<safe-wallet-pubkey> \
MINT=<token-mint> \
JITO_TIP=0.005 \
  npm run transfer-tokens
```

Omit `AMOUNT` to transfer the full balance.

Expected output:

```
Source ATA: <ata-pubkey>
Source balance: 12,287 TOKEN
Detected: Token-2022 (no transfer hook)
Bundle submitted: <bundle-id>
Bundle landed in slot <N>
Destination balance: 12,287 TOKEN
```

What's in the tx (all in one Jito bundle):

1. Create destination ATA if it doesn't exist (~0.002 SOL rent).
2. Transfer tokens (full balance or specified `AMOUNT`) from source ATA → destination ATA.
3. Jito tip.

No window between read and transfer — sweepers can't insert.

## Step 2 — Rescue specific amount

```bash
SOURCE_SECRET=<base58> \
DESTINATION=<safe-wallet-pubkey> \
MINT=<token-mint> \
AMOUNT=5000 \
JITO_TIP=0.005 \
  npm run transfer-tokens
```

`AMOUNT` is in UI units (the human-readable token amount, accounting for decimals). The script reads the mint's `decimals` field and converts to base units internally.

## Step 3 — Source wallet has no SOL

A common sweeper pattern: drain all SOL first, then watch for token deposits. If `SOURCE_SECRET`'s SOL is gone, the bundle can't pay the tip or ATA rent. Supply a separate clean rent payer:

```bash
SOURCE_SECRET=<base58>                    # SOL-drained leaked wallet
RENT_PAYER_SECRET=<base58>                # clean wallet with ~0.01 SOL
DESTINATION=<safe-wallet-pubkey> \
MINT=<token-mint> \
JITO_TIP=0.005 \
  npm run transfer-tokens
```

The rent payer covers Jito tip + ATA creation rent. `SOURCE_SECRET` only needs to sign the transfer.

## Step 4 — Mass rescue across many mints

```bash
# In a shell script or your runner
for MINT in $(cat mints-to-rescue.txt); do
  SOURCE_SECRET=<base58> \
  DESTINATION=<safe-wallet-pubkey> \
  MINT=$MINT \
  JITO_TIP=0.005 \
    npm run transfer-tokens
done
```

Each iteration is its own bundle. If sweepers win one bundle, you still get the rest. Tune `JITO_TIP` upward if you see consistent losses in the output (`SlippageExceeded` or `InsufficientBalance` for an account that should still have tokens).

## Env var reference

| Var | Required | Default | Notes |
|---|---|---|---|
| `RPC_URL` | yes | — | Helius/Triton preferred |
| `SOURCE_SECRET` | yes | — | The leaked/source wallet |
| `DESTINATION` | yes | — | Safe destination pubkey |
| `MINT` | yes | — | base58 mint address |
| `AMOUNT` | no | full balance | UI-amount (decimals applied) |
| `JITO_TIP` | no | 0.005 | SOL |
| `RENT_PAYER_SECRET` | no | — | Required if source has no SOL |

## Gotchas

- **No SOL in source wallet.** Sweepers usually drain SOL before tokens. If you skip `RENT_PAYER_SECRET` and the source is dry, the bundle fails for lack of funds. Always set `RENT_PAYER_SECRET` when rescuing from a known-compromised wallet.
- **Destination ATA missing.** The script creates it inside the bundle (rent paid by `RENT_PAYER_SECRET` if set, else `SOURCE_SECRET`). No manual pre-creation needed.
- **Token-2022 transfer hooks.** Some Token-2022 mints have transfer hooks that require additional accounts in the transfer ix. The script resolves these via the mint's `TransferHook` extension when the hook program is recognized. If the hook program is unknown, the bundle fails with `MissingAccount` — you'd have to add the hook accounts manually as a follow-up tx, at which point you've lost atomicity. Audit the mint first if you suspect a hook program.
- **Bundle competition.** A sweeper bot's bundle and yours both target the same source wallet; whoever pays a higher Jito tip lands. Start at `JITO_TIP=0.005` and escalate if rescue bundles return `Invalid` repeatedly.
- **Permanent compromise.** After a successful rescue, **never deposit anything to the source wallet again.** Sweepers continue watching the address indefinitely. Generate a fresh wallet for the same role.

## Chaining with a buy

If you're buying *into* a leaked wallet (e.g. because the buyer key is shared), the safest pattern is:

1. [Tutorial 03 — `buy-jito.js`](./03-buy-via-jupiter-jito.md) buys tokens to the source wallet.
2. **Immediately** run `rescue-tokens.js` to drain those tokens to a safe wallet.

There's still a window between (1) and (2) where sweepers can race. For true atomicity (buy + rescue in one bundle), you'd need a custom variant — not currently built. Track this as an open issue if you need it.

## Next steps

- **Source wallet is the creator of a coin too?** After rescuing tokens, also drain the SOL — see [tutorial 06 — Consolidate wallets](./06-consolidate-wallets.md).
- **Want to verify the source wallet's funding history** before rescuing? See [tutorial 07 — Wallet provenance](./07-audit-wallet-provenance.md).
