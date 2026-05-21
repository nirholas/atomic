# rescue-tokens.js

Atomically move SPL or Token-2022 tokens out of a wallet into a safe destination, in a single Jito-bundled tx. The funder pays the fee + Jito tip + (if needed) the destination ATA rent. The source wallet only signs the token transfer itself.

The headline use case: the source wallet has a leaked / shared private key and you want to rescue the tokens it holds before a sweeper bot grabs them — but a regular `sendTransaction` to mempool would lose the race. Routing through Jito with a tip beats the mempool sweepers.

- **Source:** [`src/rescue-tokens.js`](../../src/rescue-tokens.js)
- **npm alias:** `npm run transfer-tokens`
- **Pattern:** single tx in a Jito bundle, two signers (funder + source)

## When to use this

- The source wallet's private key may be (or definitely is) public, and tokens it holds need to be moved without a public-mempool race.
- You want to bundle an idempotent destination-ATA creation + the transfer in one atomic op.
- You're transferring **any** SPL token (Token-2022 by default) — not pump.fun-specific.

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `MINT` | **yes** | — | Token mint pubkey. |
| `FROM_SECRET` | **yes** | — | Base58 secret of the source wallet (owns the tokens). |
| `DEST_OWNER` | **yes** | — | Pubkey (not secret) of the destination wallet. Its ATA is created idempotently if missing. |
| `DECIMALS` | no | `6` | Token decimal places. pump.fun coins are 6. For other tokens, fetch via the mint account. |
| `TOKEN_PROGRAM` | no | `t22` | `'spl'` for legacy SPL Token, `'t22'` for Token-2022. pump.fun coins use Token-2022. |
| `AMOUNT_RAW` | no | (transfer entire balance) | Raw amount as a string, multiplied by 10^DECIMALS. E.g. `1000000` = 1 token at 6 decimals. |
| `FUNDER_SECRET` | **yes** | — | Pays fee + Jito tip + destination ATA rent. |
| `JITO_TIP` | no | `0.005` | SOL. |
| `PRIORITY` | no | `2000000` | Compute-unit price. |
| `RPC_URL` | no | mainnet-beta | |

## What it does

1. Loads funder + source keypairs.
2. Derives `fromAta` (source's ATA) and `toAta` (destination's ATA) using `getAssociatedTokenAddressSync` with the chosen token program.
3. Reads the source ATA. Exits if it doesn't exist or balance is 0.
4. Determines `amount` — either `AMOUNT_RAW` (validated ≤ balance) or the full balance.
5. Picks a Jito tip account at random; fetches a fresh blockhash.
6. Builds one tx:
   - `setComputeUnitPrice` / `setComputeUnitLimit(100000)`
   - `SystemProgram.transfer(funder → tipAccount, JITO_TIP)`
   - `createAssociatedTokenAccountIdempotentInstruction(funder, toAta, DEST_OWNER, MINT, TOKEN_PID, ATA_PID)` — funder pays rent if creating
   - `createTransferCheckedInstruction(fromAta, MINT, toAta, from, amount, DECIMALS, [], TOKEN_PID)`
7. Tx signed by funder + source; funder pays fee.
8. Simulates; on failure prints logs and exits.
9. Submits as a one-tx Jito bundle. Polls for 60 s.

## Example — rescue tokens from a leaked wallet

```bash
MINT=<token mint base58> \
FROM_SECRET=<leaked wallet base58> \
DEST_OWNER=<your safe wallet pubkey> \
DECIMALS=6 \
TOKEN_PROGRAM=t22 \
FUNDER_SECRET=<your funder base58> \
JITO_TIP=0.01 \
npm run transfer-tokens
```

Output:

```
Mint:     HxYr…vLkN
From:     9aPq…Yz1k
From ATA: 2Mn…
To:       7yYx…Mq8P
To ATA:   8Xb…
From balance: 1234567890 (= 1234.56789 tokens)
Tx size: 547 bytes
Sim OK. CU: 42819
Submitting Jito bundle...
Bundle ID: 5e9b…
  poll 2: confirmed
CONFIRMED. https://solscan.io/tx/2Mp…
```

## Atomicity guarantee

- One Solana tx → atomic by Solana semantics. All instructions land in order or none do.
- Inside a Jito bundle → no other tx can land *immediately before* yours that would change the balance in a way that breaks your transfer. (You're transferring a known balance you've read; a sweeper could still drain the *source* between your read and your tx's execution, but with a Jito-tip-backed bundle, that's a closed race against the validator's queue, not the mempool.)

For the strongest guarantee (no mempool exposure at all), this is the right shape. The remaining residual risk is that another Jito-tipping bot is *also* watching this wallet and outbids your tip in the same auction window. Bump `JITO_TIP` to push your win rate up.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Missing MINT` / `Missing DEST_OWNER` | Required env var not set. | Set them. |
| `From ATA does not exist.` | Source wallet has never held this token. | Double-check `MINT` and `FROM_SECRET`; ATAs are not created on the *source* side by `transferChecked`. |
| `Nothing to transfer.` | Source ATA exists but balance is 0. | Nothing to do. |
| `Requested amount > balance` | `AMOUNT_RAW` higher than what's available. | Lower `AMOUNT_RAW`, or omit it to transfer the full balance. |
| `Sim failed: …` with `Custom program error: 0x1` | Probably wrong `TOKEN_PROGRAM` for the token (e.g. you set `spl` for a Token-2022 mint or vice versa). | Switch `TOKEN_PROGRAM` to the correct value. |
| `Sim failed:` mentioning decimals | `DECIMALS` doesn't match the mint's actual decimals. | Set `DECIMALS` correctly (default 6 is correct for pump.fun coins; query the mint account for others). |
| `Bundle submit failed` | Jito-side rejection. | See [Setup → Jito](../setup.md#jito-tip-sizing-and-tip-account-refresh). |

## Notes

- The destination ATA is created *idempotently* — if it already exists, the ix is a no-op. You don't need to pre-create it.
- The funder pays the destination ATA rent (~0.002 SOL) when creating; that's why funder needs ~0.005 SOL of headroom beyond the tip.
- For *very* high-value rescues, consider checking the source balance from multiple RPCs and submitting the bundle to multiple Jito regions in parallel. This script doesn't do that.
- This pattern composes with [`buy-jito`](buy-jito.md): you can extend the buy bundle with a third tx mirroring the ixs here, to atomically buy-and-rescue tokens to a different wallet. The current script doesn't do this; it's a manual extension if you need it.
