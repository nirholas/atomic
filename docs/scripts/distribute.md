# distribute.js

USDC rewards distribution for a SOL-paired pump.fun coin. End-to-end:

1. Collect accumulated creator fees (SOL) from the pump creator vault into the creator wallet.
2. Quote and execute a SOL → USDC swap on Jupiter for `REWARD_PERCENT` of the freshly-collected SOL.
3. Snapshot token holders for the mint.
4. Filter out the bonding-curve PDA, the creator wallet, and any holders below `MIN_BPS` of supply or without an open USDC ATA.
5. Compute **sqrt-weighted** shares (a sqrt of balance, not balance directly — favours small holders over whales).
6. Airdrop USDC in batched txs (8 transfers per tx).

Distinct from every other script in this repo: **does not use the funder/Jito pattern at all**. It uses the *creator* wallet as fee payer throughout. The creator wallet must have its private key locally and must hold enough SOL to cover all the tx fees of the distribution batches.

- **Source:** [`src/distribute.js`](../../src/distribute.js)
- **npm alias:** `npm run distribute`
- **Pattern:** sequential standard txs (not bundles), with optional Jupiter swap.

## When to use this

- You launched a coin, fees have accumulated, and you want to redistribute a percentage of those fees as USDC to current holders.
- You're OK using the creator wallet directly as the fee payer (i.e. the creator key is *yours*, not leaked).
- You want sqrt-weighted distribution rather than pro-rata.

There's also an `EMERGENCY` mode (`EMERGENCY=1 EMERGENCY_TO=<addr>`) that skips all the holder logic and dumps all USDC in the creator's ATA to a single address.

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `MINT` | **yes** | — | Token mint. Used both for snapshotting and excluding the bonding curve. |
| `CREATOR_SECRET` *or* `CREATOR_KEYPAIR` | **yes** | — | Base58 secret, *or* path to a Solana CLI keypair JSON. Signs collect, swap, and every airdrop tx. |
| `REWARD_PERCENT` | no | `80` | % of newly collected SOL to convert + airdrop. |
| `MIN_BPS` | no | `10` | Holder eligibility floor in basis points of total supply (10 bps = 0.1%). |
| `SLIPPAGE_BPS` | no | `100` | Jupiter swap slippage (100 bps = 1%). |
| `DRY_RUN` | no | unset | If `1`, prints the plan but sends no txs. |
| `EMERGENCY` | no | unset | If `1`, sweeps all creator-wallet USDC to `EMERGENCY_TO`. Skips collect, swap, holder logic. |
| `EMERGENCY_TO` | when `EMERGENCY=1` | — | Destination address for emergency mode. Must have an open USDC ATA. |
| `RPC_URL` | no | mainnet-beta | `getProgramAccounts` is expensive — pick a paid RPC for production. |

## What it does — full sequence

### Normal run

```
[1] Read creator vault balance via OnlinePumpSdk.getCreatorVaultBalance.
    If > 0:
       Send collectCoinCreatorFee tx (creator signs + pays).
       Creator wallet now holds (existing SOL + vault SOL).

[2] Compute swapLamports:
       Math.min(creatorBalance - 0.01 SOL rent buffer,
                floor(collectedNow * REWARD_PERCENT / 100))
    If <= 0, skip to step 4.

[3] Fetch Jupiter quote (SOL → USDC), get a pre-built swap tx, creator signs, send + confirm.

[4] Read creator's USDC ATA balance.
    If 0, exit "nothing to distribute".

[5] Snapshot token holders:
       getProgramAccounts(TOKEN_PROGRAM, filter for this mint, dataSize=165)
       Exclude: bonding-curve PDA, creator wallet, system program (1111…).
       Filter: holder.amount >= totalSupply * MIN_BPS / 10000.
       For each holder, check whether a USDC ATA exists (skip if not — they can't receive).

[6] Compute sqrt-weighted shares:
       weight_i = sqrt(balance_i)
       reward_i = pot * weight_i / sum(weights)
    Drop any holder with reward_i = 0 lamports.

[7] Airdrop in batches of 8 transferChecked ixs per tx (a safe size that fits in a single tx).
    For each batch: build tx, sign with creator, send + confirm.
    Log batch sigs.
```

### Emergency mode (`EMERGENCY=1`)

Bypasses steps 1–6. Reads the creator's USDC ATA balance. If non-zero and the destination ATA exists, sends one tx transferring the entire balance to `EMERGENCY_TO`.

This is what you use if normal distribution misbehaves and you want to pull all the USDC into a single wallet for manual handling.

### Dry run (`DRY_RUN=1`)

Walks the entire flow, prints what *would* happen, sends nothing. Holder snapshot still runs (it's read-only).

## Example — normal distribution

```bash
MINT=<token mint base58> \
CREATOR_SECRET=<base58> \
REWARD_PERCENT=80 \
MIN_BPS=10 \
npm run distribute
```

Output (truncated):

```
Creator: 9aPq…Yz1k
Mint:    HxYr…vLkN
Mode:    normal, 80% of fees to holders, sqrt-weighted, min 10bps

[1] Creator vault balance: 0.142 SOL
    collected. sig: 4Sv…

[2] Creator wallet SOL balance: 0.1532
    Swapping to USDC: 0.1136 SOL

    quote: expect 28.4321 USDC
    swap sig: 7Pk…

[3] Creator USDC balance: 28.4321 USDC

[4] Snapshotting holders...
    raw holders: 432
    after exclusions + min 10 bps: 89
    checking USDC ATAs (this is slow — N RPC calls)...
    checked 89/89
    eligible (with USDC ATA): 64

[5] Distributing 28.42 USDC to 64 holders (sqrt-weighted)
    sample (top 5 weighted):
      8Xb…  0.823412 USDC
      2Mn…  0.741299 USDC
      …

    batch 1/8 sig: …
    batch 2/8 sig: …
    …

DONE.
```

## Example — emergency sweep

```bash
MINT=<token mint base58> \
CREATOR_SECRET=<base58> \
EMERGENCY=1 \
EMERGENCY_TO=<your safe wallet pubkey> \
npm run distribute
```

Sends all USDC in the creator's ATA to the safe wallet in a single tx.

## Why sqrt-weighting

`reward_i ∝ sqrt(balance_i)` instead of `reward_i ∝ balance_i`.

Effect: doubling your balance increases your reward by ~1.41×, not 2×. Whales still get more than minnows but with diminishing returns — favours broad participation over concentration. This is sometimes called "quadratic" or "anti-Sybil" weighting (it's quadratic in the *cost* of acquiring more weight: to double your reward, you'd need to quadruple your balance).

If you want pro-rata weighting instead, replace `Math.sqrt(...)` with `Number(h.amount)` in [`src/distribute.js`](../../src/distribute.js).

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Missing MINT` / `Provide CREATOR_SECRET (base58) or CREATOR_KEYPAIR (path)` | Required env not set. | Set them. |
| `nothing to collect.` | Creator vault was empty. | Either fees haven't accumulated, or someone else (or another script) already collected. |
| `Jupiter quote failed` / `Jupiter swap failed` | Jupiter API issue or unroutable trade. | Re-run, bump `SLIPPAGE_BPS`. |
| `nothing to distribute.` | After collect+swap, the creator's USDC balance is still 0. | Check Solscan: did the swap actually land? |
| Holder snapshot is very slow | `getProgramAccounts` against public mainnet RPC. | Use a paid RPC (Helius, Triton). |
| `Emergency destination has no USDC ATA` | `EMERGENCY_TO` hasn't been used for USDC before. | Send 1 USDC to `EMERGENCY_TO` from any wallet first, then re-run. |
| A batch in step 7 fails | Could be RPC timeout, blockhash expiry, or insufficient compute. | The script catches the error and continues to the next batch — holders in the failed batch get nothing this run. Re-run; previously-paid holders just get a second distribution. **Idempotency is not guaranteed** — you may want to track which sigs landed and exclude already-paid holders on retry. |

## Notes

- The script reads the creator vault *before* deciding `swapLamports`, but actually executes a separate `collectCoinCreatorFee` tx — so the SOL being swapped is what's in the creator wallet at that point, capped by the vault amount × `REWARD_PERCENT`. The `Math.min(creatorBal - rentBuffer, …)` clamp guarantees you don't accidentally swap your rent.
- **No retry / idempotency.** If the script crashes mid-airdrop, holders covered by completed batches got USDC; holders in incomplete batches got nothing. Re-running will airdrop again to *everyone* eligible at that moment. For high-stakes distributions, capture the per-batch sigs and parse them against the distribution plan.
- Holder snapshot uses **only the legacy SPL Token program** (`TOKEN_PROGRAM_ID`). pump.fun coins are **Token-2022** — the snapshot here may miss holders. If you're distributing to pump.fun coin holders specifically, switch the snapshot to `TOKEN_2022_PROGRAM_ID` (or do both and merge). This is an open inconsistency in [`src/distribute.js`](../../src/distribute.js).
- Uses Jupiter's `lite-api.jup.ag` (no API key). For production, switch to a paid Jupiter endpoint.
