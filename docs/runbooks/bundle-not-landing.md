# Runbook: bundle not landing

Your `npm run launch` (or any `*-jito.js` script) submitted a bundle, but it never confirms. This runbook is the triage flow.

**Time budget:** ~5 minutes of triage before deciding whether to retry, raise the tip, or abandon the operation.

---

## Symptom

The script prints something like:

```
[fire-jito] bundle submitted: <bundle-id>
[fire-jito] waiting for confirmation...
[fire-jito] timeout after 30s — bundle not confirmed
```

The funder wallet still has the SOL (no tx ever landed) or the funder wallet is down by exactly the tip + priority fees (a tx landed but the bundle didn't, see [Edge case](#edge-case-tx-landed-but-bundle-didnt)).

---

## Quick decision tree

```
1. Does `solana confirm <txSig>` show the tx as confirmed?
   ├── YES, all txs confirmed → bundle landed late. Stop the script, don't retry.
   │                            Your operation succeeded; the script just timed out polling.
   ├── PARTIAL (some confirmed, some not) → bundle did NOT land atomically.
   │                                        Something is very wrong. Go to "Edge case" below.
   └── NO, no tx confirmed     → bundle dropped. Go to step 2.

2. Run `npm run check-tip-accounts` (verify your tip account list isn't stale).
   ├── DIFFS → update src/lib/programs.ts with new tip accounts, retry.
   └── NO DIFFS → go to step 3.

3. Is your tip ≥ 0.005 SOL?
   ├── NO  → raise JITO_TIP to 0.005 and retry.
   └── YES → go to step 4.

4. Check Jito tip percentiles: https://www.jito.wtf/
   ├── 75th percentile > your tip → raise to that percentile, retry.
   └── Your tip > 75th percentile → go to step 5.

5. Check RPC health (see docs/runbooks/rpc-degraded.md).
   ├── RPC degraded → fix or switch RPC, retry.
   └── RPC healthy → go to step 6.

6. Inspect the bundle status: `getBundleStatuses([<bundle-id>])`.
   ├── err: "Bundle dropped" → block engine rejected; check the err message and act on it.
   └── No record → bundle never reached the block engine; network issue.
```

---

## Step-by-step

### 1. Did anything actually land?

Even when the script says "timeout," sometimes the bundle landed and your client just lost the confirmation. Check the tx signatures:

```bash
solana confirm <signature>  # repeat for each tx in the bundle
```

If `confirmed` for all → the bundle worked, your operation succeeded, the script's polling just gave up too early. **Do not retry** — you'll either duplicate the operation (e.g. launch a second coin) or burn a fresh blockhash for no reason. Move on.

If `unconfirmed` or `failed` for all → bundle didn't land. Continue.

### 2. Is your tip account list stale?

Jito rotates the tip account set occasionally. If your hardcoded list is out of date, the block engine will reject the bundle with "Bundles must write lock at least one tip account."

```bash
npm run check-tip-accounts
```

This script in [`tools/check-tip-accounts.ts`](../../tools/check-tip-accounts.ts) compares your in-code list against the live `getTipAccounts` endpoint. If there are diffs, update [`src/lib/programs.ts`](../../src/lib/programs.ts) with the live list and retry.

Frequency of rotation: maybe every few months. If you haven't pulled the repo recently, this is the first thing to check.

### 3. Is your tip too low?

The tip is an auction bid. During congestion, the floor moves up.

- Floor: 0.001 SOL (always rejected by block engine if below this).
- Quiet markets: 0.005 SOL lands ~90% of the time.
- Active markets: 0.01–0.02 SOL needed.
- During a meme spike or major launch: 0.05–0.1 SOL needed.

Check current tip percentiles at https://www.jito.wtf/. The block engine landing rate jumps sharply at the 50th–75th percentile of recent landed bundles. Set `JITO_TIP` to that value and retry.

See [`docs/runbooks/tip-too-low.md`](tip-too-low.md) for the deeper tuning guide.

### 4. Is your RPC degraded?

A degraded RPC can cause:
- Stale blockhash by the time the bundle reaches the leader (blockhash expires).
- Missed `getSignatureStatus` responses (your client thinks the bundle didn't land when it did).
- Slow `getLatestBlockhash` (you build the bundle against an already-old blockhash).

Quick check:

```bash
curl -s "$RPC_URL" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

Expected: `{"jsonrpc":"2.0","result":"ok","id":1}`.

If the result is anything else (slow response, `behind`, error), switch RPCs. See [`docs/runbooks/rpc-degraded.md`](rpc-degraded.md).

### 5. Is the bundle malformed?

If the block engine returned `"Invalid bundle"` or your sim caught an error before submission, the bundle never had a chance. The most common malformations:

- **Missing tip transfer.** Every bundle needs at least one `SystemProgram.transfer` to a Jito tip account. Verify your bundle's Tx 1 has it.
- **Mismatched blockhashes.** Some bundle txs were built against different blockhashes (race condition in your code). Fetch the blockhash once and pass it to every tx.
- **Tx signatures don't verify.** A signer was missing or signed against the wrong message. The Jito block engine rejects the whole bundle.
- **Tx > 1232 bytes.** Each tx still has the regular size limit. If any tx exceeds it, the bundle is rejected.

Add `console.log("tx bytes:", tx.serialize().length)` after building each tx to confirm sizes.

### 6. Did the bundle reach the block engine?

If `getBundleStatuses([bundleId])` returns null/no record, the bundle never even reached Jito. Either your network is down or the block engine RPC is having an issue.

```bash
curl -s "https://mainnet.block-engine.jito.wtf/api/v1/bundles" \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getInflightBundleStatuses","params":[["<bundle-id>"]]}'
```

If you get an HTTP error (502, 504), the block engine itself is having issues. Wait 30 seconds and retry — block engine outages are usually brief.

---

## Edge case: tx landed but bundle didn't

If `solana confirm <txSig>` shows that the **tip-paying tx** (the funder's SystemProgram.transfer) landed but the *other* tx in the bundle (the `createV2` / `collectCoinCreatorFee` / etc.) didn't, something is badly broken — bundles are supposed to be atomic.

This can happen in two rare scenarios:

1. **You submitted the txs individually**, not as a bundle. Double-check your code is calling `jitoClient.sendBundle([tx1, tx2])`, not `connection.sendTransaction(tx1)` followed by `connection.sendTransaction(tx2)`.
2. **A leader running an outdated Jito-modified validator** processed your txs in non-atomic mode. Extremely rare in 2026 — most validators run current versions.

If you're in this state, you've paid the tip and possibly burned a mint keypair (for `createV2`) without the operation succeeding. Treat as a small loss, generate a new mint, and retry the operation properly.

---

## Prevention

After fixing a not-landing incident, the most useful change is to **add visibility** so the next one is faster to diagnose:

1. **Log the bundle ID and all tx sigs on submission.** Every script in this repo does this — verify your logging captures them.
2. **Log the tip amount paid.** When you later tune, you need to know what didn't work.
3. **Log the slot/blockhash at submission time.** Compare against `getSignatureStatus`'s `slot` if the tx lands later — helps diagnose blockhash expiry.

---

## Related

- [`docs/runbooks/tip-too-low.md`](tip-too-low.md) — tip auction tuning
- [`docs/runbooks/rpc-degraded.md`](rpc-degraded.md) — RPC triage
- [`docs/jito-bundle-mechanics.md`](../jito-bundle-mechanics.md) — what's supposed to happen
