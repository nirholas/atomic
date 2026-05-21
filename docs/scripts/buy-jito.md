# buy-jito.js

Buy any SPL/Token-2022 token via the **Jupiter aggregator**, inside a Jito bundle. The funder funds the buyer in the bundle's first tx; the buyer's pre-built Jupiter swap tx runs in the second.

The headline reason to use this instead of pump-sdk's direct buy instruction: when the pump.fun program is upgraded and gains required accounts that older `@nirholas/pump-sdk` versions don't pass, the SDK's `buy` ix starts failing in simulation. Jupiter — being a meta-router — keeps working because it routes through whatever venue currently quotes.

- **Source:** [`src/buy-jito.js`](../../src/buy-jito.js)
- **npm alias:** `npm run buy`
- **Pattern:** two-tx Jito bundle (funder → buyer, then Jupiter swap)

## When to use this

- The SDK-direct buy is failing with `Custom program error` from a pump-sdk drift.
- You want to buy any non-pump.fun token too (Jupiter routes to every Solana DEX).
- You want the buyer wallet to be a fresh, separate key from the funder, so the funder's balance/history isn't exposed to the swap counterparty.

> ⚠️ **If `BUYER_SECRET` is a publicly-known key**, the output tokens land in that wallet and Token-2022 sweeper bots will move them out within seconds. Use a private buyer wallet, *or* add a third bundle tx that atomically transfers the swap output to a safe wallet — see the warning in the script header and the [Architecture → sweeper-bot threat model](../architecture.md#the-sweeper-bot-threat-model).

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `TARGET_MINT` | **yes** | — | Mint of the token to buy. |
| `BUY_SOL` | no | `0.01` | SOL to spend (gross input to Jupiter). |
| `SLIPPAGE_BPS` | no | `500` | Slippage tolerance in basis points (500 = 5%). |
| `JITO_TIP` | no | `0.005` | SOL paid as Jito tip in Tx 1. |
| `PRIORITY` | no | `2000000` | Compute-unit price. Forwarded to Jupiter as `computeUnitPriceMicroLamports`. |
| `FUNDER_SECRET` | **yes** | — | Pays Tx 1 fee + Jito tip + sends SOL to buyer. |
| `BUYER_SECRET` | **yes** | — | Signs Jupiter swap; receives output tokens. |
| `RPC_URL` | no | mainnet-beta | |

## What it does

1. Loads funder + buyer keypairs.
2. Verifies funder balance ≥ `BUY_SOL + 0.005 + JITO_TIP + 0.002` SOL.
3. **Gets a quote** from `https://lite-api.jup.ag/swap/v1/quote?inputMint=SOL&outputMint=TARGET_MINT&amount=…&slippageBps=…`. Prints out-amount and route.
4. **Builds the swap tx** by POSTing to `https://lite-api.jup.ag/swap/v1/swap` with the quote + buyer pubkey + `wrapAndUnwrapSol: true` + the compute-unit price. Jupiter returns a base64-encoded versioned tx pre-built for the buyer.
5. Deserializes the Jupiter tx. Buyer signs it.
6. Reads the blockhash that Jupiter chose (the swap tx already references it).
7. **Builds Tx 1** (funder signs, funder pays): set CU price/limit, transfer `BUY_SOL + 0.005` SOL from funder to buyer (covers swap input + Jupiter ATA rent buffer), transfer `JITO_TIP` to a tip account. Tx 1 uses the same blockhash as Jupiter's tx.
8. Bundles `[fundTx, swapTx]` and posts to Jito.
9. Polls both signatures for up to 60 s. Confirmed → prints any per-tx errors and the Solscan URL for the swap.

## Example

```bash
TARGET_MINT=<target mint base58> \
BUY_SOL=0.05 \
SLIPPAGE_BPS=500 \
FUNDER_SECRET=<base58> \
BUYER_SECRET=<base58> \
npm run buy
```

Output:

```
Funder: 7d9V…3rUf
Buyer:  Kp4Q…aNn7
Target: HxYr…vLkN
Spend:  0.05 SOL
Funder balance: 0.3 SOL

Fetching Jupiter quote...
Quote: receive 4321123456 tokens (raw); priceImpact: 0.42%
Route: Pump.fun AMM
Building Jupiter swap tx...

Submitting Jito bundle...
Bundle ID: 8f2a…
  poll 3: fund=confirmed swap=confirmed
Fund err: null   Swap err: null
Swap tx: https://solscan.io/tx/7Px…
```

## Atomicity guarantee

The two txs share a blockhash and are submitted as a single Jito bundle. This means:

- Either both land in the same block in the order `[fund, swap]`, or neither does.
- No other tx can land **between** them. Specifically: no sweeper bot watching the buyer wallet can drain the SOL after Tx 1 lands but before Tx 2 executes.

This still does **not** protect the *output tokens* after the swap. If you need that, extend the bundle with a third tx that calls `createTransferChecked` to move the tokens to a safe wallet, signed by the buyer. The [`rescue-tokens.js`](rescue-tokens.md) script is a close-enough template — port its ixs into a third tx in `buy-jito.js`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Missing TARGET_MINT` | Forgot to set it. | Set it. |
| `Funder needs >= X SOL` | Funder under-funded. | Top up. |
| `Jupiter quote failed 4xx/5xx` | Jupiter API issue or unroutable token. | Re-check `TARGET_MINT`. For very fresh pump.fun coins, wait a slot — Jupiter needs to index the pool. |
| `Jupiter swap failed` | Quote went stale or slippage too tight. | Re-run with a higher `SLIPPAGE_BPS`. |
| `Bundle submit failed` | Jito-side rejection. | See [Setup → Jito](../setup.md#jito-tip-sizing-and-tip-account-refresh). |
| Bundle lands but `Swap err:` is non-null | Tx 1 funded the buyer, but Tx 2 (swap) reverted on-chain. | The buyer now holds the SOL Tx 1 transferred — recover it with a regular transfer back to the funder. |

## Notes

- `wrapAndUnwrapSol: true` means Jupiter automatically wraps your SOL → WSOL and unwraps any WSOL output. You don't need to manage a WSOL ATA.
- The funder transfers `BUY_SOL + 0.005` to the buyer — the extra 0.005 SOL is a buffer for any ATA rents Jupiter's tx might create (e.g., opening the buyer's ATA for the output token).
- `lite-api.jup.ag` is Jupiter's freemium endpoint. For production volume, pay for a Jupiter API key and switch the URLs.
- Jupiter's swap response includes a recent blockhash; this script reuses it for Tx 1 so both txs in the bundle align. Don't fetch a separate blockhash for Tx 1 — the bundle would be invalid.
