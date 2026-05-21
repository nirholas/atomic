# Cost model

How much SOL each operation in this toolkit actually costs, broken down by line item. Useful for sizing the funder wallet, deciding when an operation is worth firing, and budgeting `watch-collect.js` long-term.

All numbers are in SOL, current as of 2026-05-21. Tip and priority assumptions are spelled out per operation.

---

## The cost components

Every Solana operation pays some subset of:

| Component | Typical range | Goes to |
|---|---|---|
| **Base transaction fee** | 0.000005 SOL per signature | Validators |
| **Priority fee** | 0.00001–0.001 SOL | Validators (via `SetComputeUnitPrice`) |
| **Account rent** | 0.001–0.003 SOL per new account | Locked (refunded when account closed) |
| **Jito tip** | 0.001–0.05 SOL | Jito tip account (auctioned inclusion) |
| **Program-level fees** | 0–5% of operation | Program-specific (pump.fun fees) |
| **ATA creation rent** | 0.00203928 SOL | Locked in the new ATA |

Rent is *not* a cost in the strict sense — it's locked in an account and refunded when the account is closed. But for ops that create accounts you'll never close (associated bonding curve, ATAs you may abandon), treat it as a sunk cost.

---

## Per-operation cost

### `fire-jito.js` — launch a coin

Two-tx bundle. Inputs: `JITO_TIP`, `PRIORITY`, `DEV_BUY_SOL`.

| Line item | Amount |
|---|---|
| Tx 1 base fee | 0.000005 (1 signer) |
| Tx 1 priority fee | 0.0001 (PRIORITY=100k, ~1M CU) |
| Tx 1 — SOL transferred to creator (rent floor) | ~0.005 (covers ATAs + tx fees) |
| Tx 1 — Jito tip | `JITO_TIP` (default 0.005) |
| Tx 2 base fee | 0.00001 (2 signers: creator + mint) |
| Tx 2 priority fee | 0.0001 |
| Tx 2 — mint account rent | 0.00146 (locked in the mint) |
| Tx 2 — metadata account rent | 0.0056 (locked in the Metaplex metadata PDA) |
| Tx 2 — bonding curve rent | 0.0029 (locked in the BC PDA) |
| Tx 2 — ABC ATA rent | 0.00203928 |
| Tx 2 — creator ATA rent (if `DEV_BUY_SOL > 0`) | 0.00203928 |
| Tx 2 — dev buy SOL (if `DEV_BUY_SOL > 0`) | `DEV_BUY_SOL` |
| Tx 2 — pump.fun protocol fee on dev-buy | ~1% of `DEV_BUY_SOL` |

**Total without dev-buy:** ~0.020 + `JITO_TIP` SOL.
**With `DEV_BUY_SOL=0.5`:** ~0.022 + 0.5 (buy) + 0.005 (fee) + `JITO_TIP` ≈ 0.535 SOL.

The rent components (~0.013 SOL) are locked, not spent. The "real" out-of-pocket cost without dev-buy is ~0.007 + `JITO_TIP`.

### `fire-atomic-create.js` — single-tx launch

Single tx, no Jito bundle. Inputs: `PRIORITY` only.

| Line item | Amount |
|---|---|
| Base fee | 0.00001 (2 signers) |
| Priority fee | 0.0001 |
| All createV2 rent (mint + metadata + BC + ABC) | ~0.012 |
| SOL transferred to creator | ~0.005 |

**Total:** ~0.017 SOL. The cheapest launch path, but creator wallet has to hold its own ATA and you can't bundle a dev-buy.

### `collect-jito.js` — drain creator vault

Single-tx bundle. Inputs: `JITO_TIP`, `PRIORITY`.

| Line item | Amount |
|---|---|
| Base fee | 0.00001 |
| Priority fee | 0.0001 |
| Jito tip | `JITO_TIP` (default 0.005) |
| pump.fun protocol fee on collect | 0 (collects are free for the creator) |

**Total cost:** ~0.005 + `JITO_TIP` SOL (mostly tip).

**Break-even threshold:** the collect is worth firing only if the vault holds more than your tip. The default `JITO_TIP=0.005` means you should never collect for less than ~0.01 SOL of vault balance (the tip plus enough slack to be worthwhile).

The `MIN_COLLECT_SOL` env var in [`watch-collect.js`](scripts/watch-collect.md) defaults to 0.05 SOL, which is conservative — that's a 10x buffer over the tip.

### `watch-collect.js` — long-running poller

Inputs: `JITO_TIP`, `PRIORITY`, `MIN_COLLECT_SOL`, polling cost.

**Per polled-tick cost:** 1 RPC `getBalance` call (effectively free on a paid plan, may count against rate limits on free).

**Per fired-collect cost:** same as `collect-jito.js` (~0.005 + JITO_TIP).

**Daily cost estimate** (running 24/7, polling every 30s):
- Polling: ~2,880 RPC calls/day. On a paid plan: free. On the public endpoint: 100% of your rate limit, may get throttled.
- Collects: depends on coin activity. A coin generating 1 collect/day costs ~0.006 SOL/day in tip+fees.

**Coin with no activity:** the script idles, costing nothing (just the polling RPC calls).

### `buy-jito.js` — buy via Jupiter bundle

Single Jito bundle (varies, often 2 txs depending on Jupiter route). Inputs: `JITO_TIP`, `PRIORITY`, `BUY_SOL`, `SLIPPAGE_BPS`.

| Line item | Amount |
|---|---|
| Base fee (×N signers) | 0.00001–0.00002 |
| Priority fee | 0.0001 |
| Jito tip | `JITO_TIP` |
| ATA creation (if recipient ATA doesn't exist) | 0.00203928 |
| Jupiter route fee | Typically 0 for pump.fun routes |
| **Pump.fun trading fee on the buy** | 1% of `BUY_SOL` |
| Slippage cost | Up to `SLIPPAGE_BPS / 10000 * BUY_SOL` |

**Total transaction cost (excluding the buy amount):** ~0.003 + `JITO_TIP`.
**Total including the buy:** `BUY_SOL` × (1 + 0.01 + slippage) + tip.

### `consolidate.js` — sweep vault + creator + funder

Single-tx Jito bundle. Inputs: same as `collect-jito.js`.

Same cost structure as `collect-jito.js` (~0.005 + `JITO_TIP`) plus rent reclamation: when you drain the creator wallet to zero, you reclaim ~0.001 SOL of "rent exempt" that was locked. Net cost is closer to `JITO_TIP` only.

### `rescue-tokens.js` — atomic token transfer

Single-tx Jito bundle. Inputs: `JITO_TIP`, `PRIORITY`.

| Line item | Amount |
|---|---|
| Base fee | 0.00001 |
| Priority fee | 0.0001 |
| Jito tip | `JITO_TIP` (recommend 0.01+ when racing a sweeper) |
| Recipient ATA rent (if new) | 0.00203928 |
| Token transfer fee (Token-2022 only, if mint has transfer fee) | Varies (set by mint authority) |

**Total:** ~0.003 + `JITO_TIP` + (potential ATA rent + Token-2022 fee).

### `distribute.js` — USDC distribution

Cost depends on holder count.

| Component | Per-holder cost |
|---|---|
| USDC ATA creation (if recipient has none) | 0.00203928 SOL (one-time, refunded if they ever close it) |
| Token transfer instruction | ~3 bytes of tx data; up to ~30 transfers per tx before hitting 1232-byte limit |

For 1000 holders distributed via Token-2022 USDC: roughly 33 txs needed, each ~0.0001 in fees, total ~0.003 SOL in tx costs + ~2 SOL in ATA creation (if none exist yet). The ATA rent is locked in the recipients' ATAs — refundable to *them* if they close, not to you.

### `metadata.js` — IPFS upload

**No on-chain cost.** Uploads to pump.fun's IPFS endpoint. The metadata URI is referenced by `createV2` but the upload itself doesn't touch Solana.

### `grind.js` — vanity address grind

**No on-chain cost.** Pure CPU work. Cost is electricity / cloud compute time.

### `tools/check-pump-funding.ts` — funding source check

**No on-chain cost.** Read-only RPC calls. Each check is ~5–20 `getSignaturesForAddress` + `getTransaction` calls. On a free plan you'll hit rate limits within a few hundred checks; on a paid plan, free.

---

## Funder wallet sizing

A reasonable starting balance, depending on what you plan to do:

| Use case | Starting balance |
|---|---|
| Launch one coin, manually collect a few times | 0.5 SOL |
| Launch a coin with 1 SOL dev-buy | 2 SOL |
| Run `watch-collect.js` long-term on one coin | 0.5 SOL refilled monthly |
| Launch 5 coins in a session | 1 SOL (without dev-buys) or 5+ SOL (with dev-buys) |
| Heavy rescue/consolidate ops | 0.2 SOL is enough — most of the cost is tip, you don't need a large balance |
| Distribute USDC to 1000 holders | 3 SOL (ATA rent + buffer) |

Always size for **2–3× your actual estimate**. Running out of funder SOL mid-operation strands the operation in a half-finished state.

---

## Hidden costs

Things that don't show up in "tx fee" but compound over time:

### Failed bundles

Every dropped Jito bundle costs the tip. If your landing rate is 50% at tip 0.005 SOL, the *effective* cost per landed bundle is 0.010 SOL. Track your landing rate and tune accordingly (see [`runbooks/tip-too-low.md`](runbooks/tip-too-low.md)).

### ATA bloat

Every coin you buy creates an ATA on your wallet (~0.00203928 SOL). If you actively trade many coins and never close ATAs, you accumulate locked rent. Close empty ATAs to reclaim:

```bash
spl-token close <token-account>
```

For 100 abandoned ATAs that's ~0.2 SOL reclaimable. Not huge but worth it during cleanups.

### RPC plan

A paid RPC plan ($50–100/month) is effectively a cost of doing business if you run `watch-collect.js` long-term. The public endpoint will throttle a 24/7 poller, leading to missed collects (worth more than the RPC fee).

### Failed launches due to metadata issues

If your `metadata.js` upload returns a bad URI (image too large, network glitch), your `createV2` succeeds on chain but the coin doesn't display properly. The launch cost (~0.020 + tip) is sunk. Always test the URI returns valid JSON before launching.

---

## Cost optimization

If you're running this at scale:

1. **Lower tips on collects with low vault balance.** A 0.01 SOL vault doesn't justify a 0.005 SOL tip — use 0.001 floor.
2. **Batch distributes.** Pack as many `Token.transfer` instructions per tx as fit in 1232 bytes (~30 transfers each). Avoid one-tx-per-holder.
3. **Close ATAs after distributing.** If you create a USDC ATA on the recipient that they then ignore, you don't get the rent back, but if *you* created an intermediate ATA on your own wallet, close it.
4. **Skip the Jito bundle when atomicity isn't required.** `fire-atomic-create.js` is cheaper than `fire-jito.js` when you don't need creator-as-fee-payer.
5. **Use one funder per script context.** Funding multiple watchers/scripts from one funder requires extra balance buffer; one funder per script lets each be tightly sized.

---

## Related

- [`docs/setup.md`](setup.md) — initial wallet funding
- [`docs/runbooks/tip-too-low.md`](runbooks/tip-too-low.md) — tip auction tuning
- [`docs/jito-bundle-mechanics.md`](jito-bundle-mechanics.md) — what the tip pays for
- [`docs/transaction-size-budget.md`](transaction-size-budget.md) — byte budget that drives bundle-vs-tx choice
