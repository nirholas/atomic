# Troubleshooting

Common errors and fixes. Organized by symptom. For conceptual questions see [`FAQ.md`](./FAQ.md).

## Bundle submission errors

### `"Bundle was rejected: Invalid"`

Jito's Block Engine rejected the bundle before considering inclusion. Causes, in rough frequency order:

1. **Tip account drift.** The hardcoded tip-account list is stale. Run:
   ```bash
   npm run check-tip-accounts
   ```
   If the printed addresses differ from the ones in your code, update them.
2. **Tip below auction-clearing price.** Raise `JITO_TIP=0.01` and retry.
3. **One of the txs already landed.** If a previous bundle attempt partially landed (you sent the same blockhash twice), the duplicate fails. Refresh blockhash.
4. **Tx size > 1232 bytes.** Trim the bundle: fewer instructions, or move some to a separate bundle.

### `"Bundles must write lock at least one tip account"`

Same as above, case 1: tip account drift. The scripts only write-lock accounts in the hardcoded list. Update.

### `"Bundle was dropped"`

The Block Engine accepted the bundle but the leader didn't include it. Causes:

1. **Not a Jito-aware validator.** Some leaders ignore Jito. Retry next slot.
2. **Tip too low.** Raise.
3. **Network congestion peak.** Wait 1-2 slots and retry.

The scripts have a built-in retry loop. If you exhaust retries, increase tip.

### `"Blockhash not found"`

Your bundle was assembled with a blockhash that's expired (>150 slots old). Causes:

1. **You're holding a bundle too long before submitting.** Re-assemble.
2. **Your RPC's recent-blockhash is lagging.** Switch to a paid provider.

The scripts refresh blockhash on retry. If you see this consistently, your RPC is the problem.

## Tx-construction errors

### `"Transaction too large"`

Tx > 1232 bytes. Causes:

1. **Address lookup tables not used.** Some pump-sdk versions require LUTs for the buy instruction. The Jupiter route in `buy-jito.js` handles this automatically.
2. **Too many trailing fee-recipient accounts.** The 2026-04-28 upgrade added 8 fee recipients as trailing accounts on buy/sell. If you're on an older SDK that doesn't deduplicate, you may overflow. Bump pump-sdk.
3. **Excessive priority-fee + compute-budget ixs.** Each compute-budget ix is ~25 bytes. You only need one set.

### `"BuybackFeeRecipient missing"` or `"InvalidAccount"` on buy

pump-sdk drift. The on-chain program requires accounts that your SDK version doesn't include. Two fixes:

1. **Bump pump-sdk** to the version matching the current on-chain program.
2. **Route via Jupiter** using `npm run buy` (`src/buy-jito.js`). Jupiter abstracts the account list.

The atomic toolkit defaults to option 2 for buys, intentionally — pump-sdk drift is a regular occurrence.

### `"InsufficientFunds"` on buy / launch

Your funder doesn't have enough SOL. Check:

```bash
npm run check-balances -- <funder-pubkey>
```

For a launch you need: rent (~0.022) + `DEV_BUY_SOL` + priority fee + Jito tip + 5K lamports network fee × 2 txs.

## RPC errors

### `429 Too Many Requests`

Your RPC is rate-limiting. The public mainnet RPC is aggressive about this. Fix:

- Switch to Helius / Triton / QuickNode. Free tiers exist.
- Set `READ_RPC_URL` separately for read-heavy operations (provenance scans).

### `"Server error: -32601" / unknown method`

Your RPC doesn't support a method the script uses (commonly `getSignaturesForAddress` with paging, or the Jupiter quote endpoint). Switch providers.

### `getSignaturesForAddress: rate limited even with paid RPC`

Provenance scans (`tools/check-pump-funding.ts`) walk back through thousands of signatures. Even paid providers throttle. Options:

- Lower `--max-signatures` (default 1000).
- Use a paid provider's "archive RPC" endpoint if they offer one.
- Run in batches with sleep between pages.

## Secrets / setup errors

### `"FUNDER_SECRET is not set"`

Your `.env` is missing or not loaded. Check:

1. `.env` exists in the directory you're running from (repo root for the `src/` scripts).
2. The variable is set: `cat .env | grep FUNDER_SECRET`.
3. The script uses `dotenv/config` (it does in this repo).

### `"Invalid base58 / invalid keypair"`

The secret string isn't a valid base58-encoded 64-byte Solana secret. Common causes:

1. **You exported a public key** (32 bytes) instead of a secret (64 bytes including pubkey).
2. **Phantom export** includes a header you need to strip. Use Phantom → Settings → Show Private Key.
3. **You pasted a JSON array** (Solana CLI format). Use `FUNDER_KEYPAIR=./funder.json` instead of `FUNDER_SECRET`.

### `"Permission denied" reading keypair JSON`

The file isn't readable by the process. Check permissions: `chmod 600 funder.json`.

## On-chain assertion failures

### `"DESTINATION matches funder — refusing to run"`

You set `DESTINATION` to the same address as the funder. The script refuses because that defeats the purpose of consolidation. Set a *different* safe wallet.

### `"slippage exceeded"`

The Jupiter quote you got exceeds your `SLIPPAGE_BPS`. Two options:

1. Raise slippage (`SLIPPAGE_BPS=1000` for 10%).
2. Reduce `BUY_SOL` — low-liquidity tokens have steep price impact.

### `"creator vault is empty"` on collect

The coin's `coinCreatorVault` PDA has zero accumulated fees. Causes:

1. **The coin is too new.** Fees accumulate per-trade, so a freshly-launched coin with no trades has no vault.
2. **Someone else already collected.** If the creator key is shared, another holder may have drained the vault.
3. **You're checking the wrong mint.** Double-check `MINT` env var.

## Long-running scripts

### `watch-collect.js` stops collecting

The poller exited or stopped. Causes:

1. **RPC rate-limited.** The script's polling interval defaults to 30s. Lower if you're hitting limits.
2. **Wallet balance too low to pay Jito tip.** Top up the funder.
3. **Network outage.** Add a process supervisor (PM2, systemd, Railway's restart policy).

### `distribute.js` runs out of memory

Distributing to many holders builds a large in-memory holder set. Mitigation:

1. Process in batches (the script supports `--batch-size`).
2. Run on a larger instance.
3. Use a paid RPC's `getProgramAccounts` with chunking, not full account fetches.

## When the error isn't here

1. Check `docs/scripts/<script>.md` for that specific script's failure modes.
2. Search closed issues: <https://github.com/nirholas/atomic/issues?q=is%3Aissue+is%3Aclosed>.
3. Open an issue with: the exact error message, the script name, the tx signature (if any), the env vars (redacted), and what you were trying to do.
