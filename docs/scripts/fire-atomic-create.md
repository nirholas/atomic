# fire-atomic-create.js

Launch a pump.fun coin in a **single Solana transaction** — no Jito bundle, no Jito tip. The funder pays the fee; the creator wallet co-signs but pays nothing.

The trade-off versus [`fire-jito`](fire-jito.md): on Solscan, the "from" of the create tx is the **funder**, not the creator. On-chain attribution (the creator field inside `createV2`) is still the creator wallet, so pump.fun's website shows the right creator — but anyone reading the tx in a block explorer sees the funder's wallet as the signer.

- **Source:** [`src/fire-atomic-create.js`](../../src/fire-atomic-create.js)
- **npm alias:** `npm run launch-single`
- **Pattern:** single tx (no bundle), three signers (funder, creator, mint)

## When to use this

- You don't want to pay a Jito tip.
- You don't care about the create tx's Solscan "from" matching the creator (i.e., your audience reads pump.fun, not Solscan).
- You want the smallest possible failure surface: one tx, no Jito infrastructure.

For maximum on-chain attribution to the creator, use [`fire-jito`](fire-jito.md) instead.

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `URI` | **yes** | — | Metadata URI from [`metadata.js`](metadata.md). |
| `NAME` | no | `MyCoin` | Token name. |
| `SYMBOL` | no | `MEME` | Ticker. |
| `FUNDER_SECRET` | **yes** | — | Base58 secret. Pays the tx fee and transfers `RENT_SOL` to the creator inside the same tx. |
| `CREATOR_SECRET` | **yes** | — | Base58 secret. Signs `createV2` but does *not* pay fees. |
| `MINT_SECRET` | no | random | Optional vanity mint. |
| `HOLDER_REWARD` | no | `false` | `true` launches a [holder-reward coin](../concepts/holder-rewards.md): creator fees accrue to `holderRewardsPda(mint)` and pump.fun pays them out to holders. Refused before anything is signed while the Pump `Global` account has holder rewards disabled. |
| `CASHBACK` | no | unset | Rejected when truthy. The Pump program 2.0 no longer creates cashback coins (`create_v2` error 6082); use `HOLDER_REWARD=true` instead. |
| `RENT_SOL` | no | `0.035` | SOL the funder transfers to the creator wallet inside this tx, to pre-fund whatever rent the `createV2` ix needs from the creator. |
| `PRIORITY` | no | `3000000` | Per-CU price in micro-lamports, converted to a total lamport fee at `CU_LIMIT`. |
| `PRIORITY_FEE_LAMPORTS` | no | — | Total priority fee in lamports. Overrides `PRIORITY`. This is what v1 charges natively. |
| `LOADED_ACCOUNTS_DATA_LIMIT` | no | measured | Byte budget for loaded account data. Measured from chain with headroom when unset. |
| `TRANSACTION_VERSION` | no | `1` | `1` for transaction v1 (4096-byte limit) or `0` to fall back. |
| `CU_LIMIT` | no | `300000` | Compute-unit limit. `createV2` is expensive; don't lower below the default. |
| `RPC_URL` | no | mainnet-beta | Standard RPC; tx goes through `sendRawTransaction`. |

## What it does

1. Loads funder + creator + mint keypairs.
2. Verifies funder balance ≥ `RENT_SOL + 0.005` SOL.
3. Builds a single versioned tx with: compute-budget ixs, `SystemProgram.transfer(funder → creator, RENT_SOL)`, then `PUMP_SDK.createV2Instruction({…, holderReward })`. With `HOLDER_REWARD=true` the script first reads the Pump `Global` account and stops if holder rewards are disabled.
4. Funder is the fee payer; tx is signed by funder + creator + mint.
5. Logs serialized size against the limit for the chosen version (4096 bytes on v1, 1232 on v0) and rejects anything larger.
6. Runs `simulateTransaction` first; on simulation failure, prints logs and exits.
7. `sendRawTransaction` with `maxRetries: 5`, then `confirmTransaction`.
8. On confirmation prints mint, pump.fun URL, Solscan URL.

## Example

```bash
URI=https://ipfs.io/ipfs/Qm… \
NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
npm run launch-single
```

Output:

```
Funder (fee payer): 7d9V…3rUf
Creator:            9aPq…Yz1k
Mint:               HxYr…vLkN
Funder balance: 0.1 SOL
Tx size: 886 bytes (v1 limit 4096) | loaded-accounts budget: 1310720 bytes
Sim OK. CU consumed: 178432
Sending...
LAUNCHED.
Mint:    HxYr…vLkN
Pump URL: https://pump.fun/coin/HxYr…vLkN
Solscan: https://solscan.io/tx/3Rk…
```

## Why this fits in one tx (when [`fire-jito`](fire-jito.md) needs two)

Both scripts call the same `PUMP_SDK.createV2Instruction({…})`. The difference is *who pays the tx fee*:

- In **`fire-jito`**, the create tx's *fee payer* is the creator. The creator wallet has 0 SOL until Tx 1 of the bundle lands. So the rent-funding transfer cannot live in the create tx itself — it must be a separate, earlier tx. Hence the bundle.
- In **`fire-atomic-create`**, the fee payer is the funder. The funder already has SOL. So the rent-funding transfer can be a regular `SystemProgram.transfer` instruction *before* `createV2` in the same tx. Everything fits.

Same atomicity guarantee (single Solana tx is atomic by definition), different "from" field on Solscan.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Missing URI` | Forgot `metadata.js`. | Run [`metadata.js`](metadata.md) first. |
| `Funder needs >=` | Funder under-funded. | Top up to ≥ `RENT_SOL + 0.005`. |
| `Transaction is N bytes; version 1 limit is 4096` | The tx outgrew the v1 envelope. | The create tx is normally under 1 KB. If a `pump-sdk` upgrade added this many accounts, split the work with [`fire-jito`](fire-jito.md). |
| `Transaction exceeds the version 0 limit of 1232 bytes` | Running with `TRANSACTION_VERSION=0`. | Drop the fallback and use v1, which has more than three times the room. |
| `Sim failed: …` | `createV2` reverted in simulation. | Read the printed `Logs:` block. Most likely cause: stale `@pump-fun/pump-sdk` vs. live program. |
| `Tx errored` after send | Tx landed on-chain but failed. | Same root cause as sim failure but raced past the sim — should be rare. |

## Notes

- The single-tx form is the right default for solo launches where the creator is *you* and Solscan attribution doesn't matter.
- This script doesn't talk to Jito at all — works on any plain Solana RPC.
- `simulateTransaction` runs with `sigVerify: false, replaceRecentBlockhash: false` — the same blockhash that will be sent — so the sim is a tight predictor of the real tx's behavior.
