---
name: atomic-rescue
description: Use when the user wants to atomically move SPL or Token-2022 balances out of a leaked / shared / sweeper-watched wallet, without giving sweeper bots a window to insert. Triggers on "rescue tokens", "rescue-tokens", "drain leaked wallet", "buy and transfer atomically", "token-2022 sweeper", or any SPL transfer under bot competition.
---

# atomic-rescue — atomic SPL / Token-2022 transfer

Transfers SPL or Token-2022 balances from a compromised wallet to a safe destination inside a Jito bundle. The bundle guarantees no bot can insert a competing transfer between read and write — useful because Token-2022 sweepers watch leaked addresses and typically drain within ~3 seconds of any deposit.

## Script

`tmp/leaked-launch/rescue-tokens.js`

## Setup

```bash
cd tmp/leaked-launch
npm install
cp .env.example .env  # fill in
```

## Flow

```bash
SOURCE_SECRET=<base58>          # the leaked / compromised wallet
DESTINATION=<safe-wallet>        # base58 pubkey
MINT=<token-mint>                # base58 mint address
JITO_TIP=0.005 \
  node rescue-tokens.js
```

The script handles both classic SPL Token (Tokenkeg…) and Token-2022 (TokenzQd…) mints. It checks the mint's program ID and constructs the correct transfer instruction (including transfer-hook accounts for Token-2022 if present).

For full balance: omit `AMOUNT` — script transfers all. For a specific amount: set `AMOUNT=<ui-amount>`.

## When to use

- **Holding tokens in a leaked wallet.** Atomic rescue → safe wallet. The bundle prevents the sweeper from inserting a transfer between your wallet read and your transfer instruction.
- **Just bought into a leaked wallet.** Chain [[atomic-buy]] → `rescue-tokens.js` in the same Jito bundle so the tokens never rest in the buyer wallet.
- **Mass rescue.** Loop the script across multiple mints. Each rescue is its own bundle; bots watching the source wallet will still race, but the atomicity per-mint guarantees you win each landed bundle.

## Env vars

- `RPC_URL` — Solana RPC.
- `SOURCE_SECRET` — base58 secret of the wallet to drain (often the leaked one).
- `DESTINATION` — safe wallet pubkey to receive the tokens.
- `MINT` — token mint to rescue.
- `AMOUNT` — optional UI-amount. Omit for full balance.
- `JITO_TIP` — SOL. 0.005 default; bump for hot wallets with active sweepers.
- `RENT_PAYER_SECRET` — optional, separate funder for tip and ATA-create costs. If `SOURCE_SECRET` is leaked but has no SOL, you must supply this.

## Gotchas

- **No SOL in source wallet.** Sweepers often drain SOL first. Set `RENT_PAYER_SECRET` to a clean wallet that pays the bundle's tip + the destination ATA create rent. Otherwise the bundle fails for lack of funds in `SOURCE_SECRET`.
- **Destination ATA missing.** Script creates the destination ATA inside the same tx. The rent (~0.002 SOL) is charged to the source unless `RENT_PAYER_SECRET` is set.
- **Token-2022 transfer hooks.** Some Token-2022 mints have transfer hooks that require additional accounts. The script resolves these via the mint's `TransferHook` extension — if a hook program is unknown to the script, the bundle will fail with `MissingAccount`. You can add the hook accounts manually as a follow-up tx, but at that point you've lost atomicity.
- **Bundle competition.** A sweeper bot's bundle and yours both target the same source wallet; whoever pays a higher tip lands. Start `JITO_TIP=0.005` and escalate if rescue bundles return `Invalid`.

## Security

After a successful rescue, treat the source wallet as permanently compromised — do not deposit anything to it again. Sweepers will continue to watch the address indefinitely. Generate a fresh wallet if you need to re-use the role.
