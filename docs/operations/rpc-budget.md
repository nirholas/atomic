# RPC budget

Solana RPC calls per script in [`src/`](../../src/), with
endpoint-plan sizing recommendations. Pair with
[`cost-estimates.md`](cost-estimates.md) — that page covers on-chain
SOL spend; this one covers RPC quota spend.

Every script reads `RPC_URL` from env and defaults to
`https://api.mainnet-beta.solana.com`. The public endpoint has tight
per-IP limits (typically 40 RPS, with `getProgramAccounts` and
`getParsedTransaction` rate-limited further). Anything in the
"watch / poll / distribute" category needs a private endpoint.

## Per-script RPC profile

Counts assume one successful execution path. Retries and failures
inflate everything.

### `metadata.js`

Zero Solana RPC calls. Hits pump.fun's IPFS endpoint only.

### `fire-jito.js`

| Method | Count | Notes |
|---|---:|---|
| `getBalance(funder)` | 1 | Pre-flight balance check |
| `getLatestBlockhash` | 1 | Shared between Tx1 and Tx2 |
| `sendBundle` (Jito, not Solana RPC) | 1 | To `mainnet.block-engine.jito.wtf` |
| `getSignatureStatuses([sig1, sig2])` | ≤30 | Polled every 2s, exits on confirmation |
| **Total Solana RPC** | **3–33** | Typical happy path: ~5 calls |

### `fire-atomic-create.js`

| Method | Count | Notes |
|---|---:|---|
| `getLatestBlockhash` | 1 | |
| `sendTransaction` | 1 | |
| `confirmTransaction` | 1 (long-poll) | Subscribes to slot updates |
| **Total** | **~3** | Cheapest of the launchers from an RPC perspective. |

### `collect-jito.js`

| Method | Count | Notes |
|---|---:|---|
| `OnlinePumpSdk.getCreatorVaultBalance` | 1 | Wraps `getAccountInfo` on the vault PDA |
| `getBalance(creator)` | 1 | |
| `getBalance(funder)` | 1 | |
| `OnlinePumpSdk.collectCoinCreatorFeeInstructions` | 1 | Returns ixs; uses `fetchGlobal` + a couple of account fetches internally (~3 RPC calls) |
| `getLatestBlockhash` | 1 | |
| `simulateTransaction` | 1 | Pre-flight; aborts on sim error |
| `sendBundle` (Jito) | 1 | |
| `getSignatureStatuses([sig])` | ≤30 | |
| **Total Solana RPC** | **~8–38** | Typical: ~10 |

### `watch-collect.js`

The dominant long-term RPC consumer in the toolkit.

| Activity | Frequency | RPC calls each | Daily total |
|---|---:|---:|---:|
| Vault poll (`getCreatorVaultBalance`) | every `POLL_MS` (default 30s) | 1 | 2,880 |
| `collect-jito.js` spawn when threshold crossed | depends on vault accrual | ~10 | varies |
| **Typical low-volume coin** | — | — | **~2,890/day** |
| **Typical high-volume coin (6 collects/day)** | — | — | **~2,940/day** |

At default 30s polling, a single `watch-collect` consumes ~88K
Solana RPC calls/month. Most providers' free tiers (100K/mo) survive
one watcher; running several requires a paid tier.

To reduce: bump `POLL_MS` to 60s or 120s for low-volume coins.

### `consolidate.js`

Same shape as `collect-jito.js` (single Jito bundle tx): ~10 RPC
calls on the happy path.

### `buy-jito.js`

| Method | Count | Notes |
|---|---:|---|
| `getBalance(funder)` | 1 | |
| Jupiter quote (HTTP, not RPC) | 1 | `lite-api.jup.ag` |
| Jupiter swap (HTTP, not RPC) | 1 | |
| `getLatestBlockhash` | 1 | |
| `sendBundle` (Jito) | 1 | |
| `getSignatureStatuses([sig1, sig2])` | ≤30 | |
| **Total Solana RPC** | **~3–33** | Typical: ~5 |

### `rescue-tokens.js`

| Method | Count | Notes |
|---|---:|---|
| `getAccountInfo(destination ATA)` | 1 | Decides whether to add `createATA` ix |
| `getTokenAccountBalance(source ATA)` | 1 | Only if `AMOUNT_RAW` unset |
| `getLatestBlockhash` | 1 | |
| `sendBundle` (Jito) | 1 | |
| `getSignatureStatuses([sig])` | ≤30 | |
| **Total Solana RPC** | **~3–34** | Typical: ~6 |

### `distribute.js`

The heaviest single-run RPC consumer. Scales with **holder count**.

| Stage | Method | Count |
|---|---|---:|
| 1. Collect | `getCreatorVaultBalance` | 1 |
| 1. Collect | `collectCoinCreatorFeeInstructions` (internal fetchGlobal etc.) | ~3 |
| 1. Collect | `getLatestBlockhash` + `sendTransaction` + `confirmTransaction` | 3 |
| 2. Swap | `getBalance(creator)` | 1 |
| 2. Swap | Jupiter quote + swap (HTTP, not RPC) | 0 |
| 2. Swap | `sendRawTransaction` + `getLatestBlockhash` + `confirmTransaction` | 3 |
| 3. USDC balance | `getParsedAccountInfo` | 1 |
| 4. Holder snapshot | **`getProgramAccounts(TOKEN_PROGRAM_ID, filters)`** | **1 (very expensive — returns every token account for the mint)** |
| 5. ATA check | `getAccountInfo` per holder (concurrency=20) | **N** (number of post-filter holders) |
| 6. Airdrop | per batch: `getLatestBlockhash` + `sendTransaction` + `confirmTransaction` | **3 × ⌈N_eligible / 8⌉** |

**Worked example for 1,000 raw holders, 240 eligible:**
- Pre-airdrop: ~11 RPC calls
- ATA check: 240 RPC calls
- Airdrop: 30 batches × 3 = 90 RPC calls
- **Total: ~341 RPC calls + 1 `getProgramAccounts`**

The `getProgramAccounts` call alone returns all token accounts for
the mint (~1,000 entries, each ~165 bytes plus account metadata —
roughly 200–500 KB response). Many providers either bill this as
many "credits" or rate-limit it specifically; check your endpoint's
billing model.

### `grind.js`

Zero RPC. Pure CPU.

### `tools/check-pump-funding.ts`

| Method | Count |
|---|---:|
| `getSignaturesForAddress` paged | ⌈signatures / 1000⌉, up to `maxSignatures / 1000` = 1 by default |
| `getParsedTransaction` | 1 per non-errored signature, until the first inbound transfer is found |

For a wallet whose first inbound is also its first overall tx:
**~2 RPC calls**. For a wallet where you need to walk back through
500 unrelated txs: **~502 RPC calls** (one per tx). The
`maxSignatures` knob bounds this.

### `tools/sanity-check.ts`, `tools/check-balances.ts`, `tools/check-tip-accounts.ts`

A handful of calls each — read the file headers. All are designed to
be safe to run repeatedly.

## RPC provider sizing

Recommended tier per use case, assuming a mainstream provider
(Helius, Triton, QuickNode):

| Use case | Monthly RPC volume | Recommended tier |
|---|---:|---|
| One-shot launch and walk away | ~10 calls | **Free** |
| Launch + manual collect a few times/week | ~50 calls/week | **Free** |
| Single `watch-collect` running 24/7 | ~90K calls/month | **Free or starter** (varies by provider) |
| 3–5 watchers running 24/7 | ~270K–450K calls/month | **Starter / developer** |
| Weekly `distribute` to 500-holder coins | ~1.5K calls/run × 4 = 6K + ~1 `getProgramAccounts`/run | Free or starter, but check `getProgramAccounts` billing |
| Continuous watchers + weekly distributions across multiple coins | 500K+ calls/month | **Growth / business** tier |

## Commitment levels

Every script uses `'confirmed'` commitment. This is the right default —
`'finalized'` is too slow for the polling loops, and `'processed'`
risks rolling back. Don't change without understanding the rollback
window.

## What to monitor

If you're running a watcher long-term, instrument:

1. **Per-method call count.** Compare to your provider's dashboard
   weekly. A sudden spike usually means `confirmTransaction` is
   long-polling against a stuck tx — check the Solscan link printed
   by the script.
2. **`getProgramAccounts` latency.** This call is the most provider-
   specific in the toolkit. Median latencies of >5s suggest the
   provider is rate-limiting; switch to a dedicated indexer (Helius
   DAS API, etc.) for production `distribute.js`.
3. **Error-rate by method.** Persistent `429`s on
   `getSignatureStatuses` mean your watcher's confirmation polling
   is starving other calls; raise the inter-poll delay (currently
   hardcoded at 2s).
4. **Bundle confirmation time.** Track time from `sendBundle` to the
   first `confirmed` status in the polling loop. > 60s consistently
   means `JITO_TIP` is too low for current network conditions — see
   [`cost-estimates.md`](cost-estimates.md).

## Caching what you can

Helpers worth adding (not yet in `src/`):

- Cache `fetchGlobal` for the pump program across collect runs —
  the struct rarely changes mid-day. `OnlinePumpSdk` re-fetches it
  on every call by default.
- Cache the Jito tip-account list returned by `getTipAccounts`
  (refresh weekly via `tools/check-tip-accounts.ts`) — avoids ad-hoc
  fixes to the hardcoded list.
- For `watch-collect.js`, batch `getMultipleAccounts` if you ever
  watch >1 creator pubkey from one process; today it's strictly
  single-pubkey.

## See also

- [`docs/operations/cost-estimates.md`](cost-estimates.md) — the
  on-chain SOL cost side.
- [`docs/setup.md`](../setup.md) — choosing an endpoint provider.
- [`tools/check-tip-accounts.ts`](../../tools/check-tip-accounts.ts)
  — keeps the hardcoded Jito tip list current without manual
  intervention.
- [`tools/sanity-check.ts`](../../tools/sanity-check.ts) — no-spend
  pre-flight that exercises the RPC for connectivity without
  costing tx fees.
