# Jito bundle mechanics

A deep reference on how Jito bundles actually work, the failure modes you will hit, and the assumptions every script in this repo bakes in. [`architecture.md`](architecture.md) covers the *why*; this page covers the *how*.

If you have already read the Jito docs and want the toolkit-specific cheatsheet, jump to [Toolkit conventions](#toolkit-conventions).

---

## What a bundle is, mechanically

A Jito bundle is an ordered group of **1 to 5 transactions** submitted via the [Jito Block Engine](https://jito-labs.gitbook.io/mev/searcher-resources/block-engine) instead of the regular `sendTransaction` path.

Three properties the regular tx path does *not* give you:

| Property | What it means |
|---|---|
| **All-or-nothing** | Either every tx in the bundle lands in the same block in the order you specified, or none of them do. There is no partial-landing failure mode. |
| **No interleaving** | No other transaction can be sandwiched between your txs. Searchers cannot front-run, back-run, or insert between bundle txs. |
| **Auctioned inclusion** | Bundles compete on tip size. A bundle with a higher tip per CU consumed gets prioritized into the block over one with a lower tip. |

A bundle is **not** a single fat tx — each tx still has its own 1232-byte limit, signature set, blockhash, and compute budget. The bundle is just a wrapper that says "treat these N as one unit."

---

## How a bundle is submitted

The repo uses Jito's JSON-RPC `sendBundle` endpoint, exposed through `@jito-foundation/jito-js-rpc`. The request is shaped like:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sendBundle",
  "params": [
    [
      "<base58-encoded signed tx 1>",
      "<base58-encoded signed tx 2>"
    ]
  ]
}
```

The response is a `bundleId` (UUID). The endpoint accepts the bundle but does **not** confirm landing — confirmation requires polling `getBundleStatuses` or watching for the txs' signatures in `getSignatureStatus`.

### The block engine endpoints

Jito runs region-specific block engines. Picking the wrong one adds latency and reduces win rate:

| Region | URL |
|---|---|
| Mainnet (Amsterdam) | `https://amsterdam.mainnet.block-engine.jito.wtf` |
| Mainnet (Frankfurt) | `https://frankfurt.mainnet.block-engine.jito.wtf` |
| Mainnet (New York)  | `https://ny.mainnet.block-engine.jito.wtf` |
| Mainnet (Tokyo)     | `https://tokyo.mainnet.block-engine.jito.wtf` |
| Mainnet (Salt Lake) | `https://slc.mainnet.block-engine.jito.wtf` |

This repo defaults to `mainnet.block-engine.jito.wtf` (Jito's region-routing front), which is the simplest choice but ~20–40ms slower than directly hitting the closest region. If you run a colocated bot, override the endpoint to the nearest region.

---

## The tip account, in detail

A bundle is only valid if **at least one tx in the bundle** writes a non-zero SOL transfer to one of Jito's tip accounts. There are eight of them; they rotate occasionally.

The current canonical list (as embedded in this repo's scripts and verified via `tools/check-tip-accounts.ts`):

```
96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5
HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe
Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY
ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49
DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh
ADuUkR4vqLUMWXxW9gh6D6L8pivKeVBBjNo1d5VbVibK
DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL
3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT
```

(See [`@nirholas/pump-sdk/src/jito/tip-accounts.ts`](https://github.com/anthropics/pump-sdk) for the upstream canonical list; this repo mirrors it in [`src/lib/programs.ts`](../src/lib/programs.ts).)

### Tip account rotation

Jito occasionally rotates the set. If a bundle returns `"Bundles must write lock at least one tip account"`, your hard-coded list is stale. Two fixes:

1. **Fetch dynamically.** Call `getTipAccounts` on the block engine RPC each run and pick one at random.
2. **Update the hardcoded list.** Run [`tools/check-tip-accounts.ts`](../tools/check-tip-accounts.ts) to diff your in-code list against the live one.

### How much to tip

The tip is a Solana auction bid. The block engine ranks bundles by **tip ÷ CU consumed** and includes top bidders until block CU budget is exhausted. Implications:

- A small bundle (low CU) with a small tip can outcompete a bigger bundle with the same tip.
- During congestion, the bidding floor moves. Floor is 0.001 SOL but landing often requires 0.005–0.02 in busy markets.
- **The tip is paid even if the bundle reverts at the program level.** A failed `createV2` tx still costs you the tip. There is no refund.
- The tip is **not** the same as the Solana priority fee. You typically pay both. Priority fee tightens leader-slot inclusion *within* the block engine pipeline; the tip wins the inclusion auction itself.

### Tip placement in the bundle

The tip transfer must be in **a tx the searcher signs** — you cannot tip from someone else's wallet. In this repo:

- `fire-jito.js` — tip transfer is in Tx 1 (the funder's tx), bundled before the createV2 tx.
- `collect-jito.js` / `consolidate.js` / `rescue-tokens.js` — single-tx bundles, so the tip transfer is in the same tx as the business logic.
- `buy-jito.js` — tip transfer is in a separate funder tx, with the Jupiter swap in Tx 2.

---

## Atomicity guarantees (and what they don't guarantee)

A bundle's all-or-nothing property is **strong but narrow**. It promises:

✅ Either all txs land in the same block in order, or none do.
✅ No other tx (yours or anyone's) lands between them.
✅ The bundle is processed atomically at the leader's pipeline stage.

It does **not** promise:

❌ That the bundle lands at all. Most attempts during congestion don't.
❌ That program execution inside the txs succeeds. If `createV2` reverts because metadata is malformed, the bundle "lands" (state changes are recorded) but your business logic failed and you still paid the tip.
❌ Idempotency. If you submit the same bundle twice and both land, both run. (In practice the second attempt usually fails because the first consumed the blockhash window or the mint address.)
❌ Replay protection across blockhashes. Bundle dedupe is best-effort.

### What "all-or-nothing" actually means at the protocol level

The Jito-modified validator buffers the bundle's txs through normal Banking Stage in order. If any tx in the sequence **fails to execute** (signature verify failure, blockhash too old, insufficient lamports for fees), the whole bundle is dropped from the slot. If every tx executes — *even if some revert at the program level* — the bundle counts as landed and the tip is paid.

**Crucial distinction**: bundle "landing" ≠ business logic success. A bundle of two txs where Tx 1 succeeds and Tx 2 reverts inside its program will land — Tx 1's state changes are persisted, Tx 2's revert is recorded, and you've paid the tip. This is why every script in this repo simulates with `simulateTransaction` before bundling: a sim catches program-level reverts before you pay the tip.

---

## Sharing a blockhash across bundle txs

Every tx in a bundle should share **the same recent blockhash**. Two reasons:

1. **Confirmation simplicity.** When you wait for the bundle to land, you check signature statuses against the same blockhash. Different blockhashes mean different confirmation deadlines.
2. **Slot consistency.** Jito's bundle scheduler does not enforce same-blockhash, but a leader may reject a bundle where different txs have different blockhash freshness.

The repo's helper pattern: fetch `getLatestBlockhash` once, build all bundle txs against that blockhash, sign, submit.

```javascript
const { blockhash } = await connection.getLatestBlockhash("confirmed");
const tx1 = new Transaction({ recentBlockhash: blockhash, feePayer: funder.publicKey });
const tx2 = new Transaction({ recentBlockhash: blockhash, feePayer: creator.publicKey });
// ... add instructions, sign, bundle
```

`commitment: "confirmed"` is right for bundle blockhash. `"finalized"` is too old (high chance of expiry before landing); `"processed"` is unreliable (the blockhash may not actually be in any leader's view yet).

---

## Confirmation: polling vs websocket

Once you submit, you need to know if it landed. Three approaches:

### 1. Poll `getBundleStatuses` on the block engine

The block engine exposes a status endpoint:

```javascript
const status = await jitoClient.getBundleStatuses([bundleId]);
// → { value: [{ bundle_id, transactions, slot, confirmation_status, err }] }
```

Pros: tells you slot + bundle-level error reason if it didn't land.
Cons: requires the block engine RPC; you need to keep polling.

### 2. Poll `getSignatureStatuses` on Solana RPC

```javascript
const statuses = await connection.getSignatureStatuses(txSignatures);
```

Pros: works against any RPC, including your existing connection.
Cons: tells you about each tx separately; doesn't tell you the bundle's verdict (was it dropped pre-execution or did a tx revert post-execution).

### 3. Subscribe via WebSocket

```javascript
connection.onSignature(signature, (notification) => { ... }, "confirmed");
```

Pros: real-time, no polling.
Cons: WebSocket subs are flaky on most public RPCs; subscription leaks are common in long-running scripts. The repo's `watch-collect.js` deliberately polls instead.

### Recommended pattern

For one-shot scripts (`fire-jito.js`, `collect-jito.js`):

```
1. submit bundle → get bundleId + sigs
2. wait ~3s (typical leader latency)
3. getSignatureStatuses(sigs)
4. if all confirmed: success
5. if any failed or all unknown:
     getBundleStatuses(bundleId) → reason
     if blockhash-expired or dropped: retry with new blockhash
     else: surface error to user
```

The repo uses ~30s total timeout with 1s polling. Anything longer and the blockhash will have expired anyway.

---

## Failure modes, in order of frequency

| Symptom | Likely cause | Fix |
|---|---|---|
| `"Bundle dropped"` / no landing within 30s | Tip too low for current market | Raise `JITO_TIP` (0.005 → 0.01 → 0.02) |
| `"Blockhash not found"` after submit | RPC and block engine see different recent slots; bundle's blockhash is too old by the time it reaches the leader | Refresh blockhash, retry. Use `commitment: "confirmed"` not `"finalized"`. |
| `"Bundles must write lock at least one tip account"` | Stale tip account list | Refresh from `getTipAccounts` or update [`src/lib/programs.ts`](../src/lib/programs.ts) |
| `"Invalid bundle"` / 400 from block engine | Malformed tx in bundle; usually a sim error caught upstream | Run `simulateTransaction` per tx; the failing one will surface |
| `"Bundle landed but tx N reverted"` | Program-level failure (e.g. createV2 sees bad metadata, slippage exceeded) | The bundle's atomicity is intact; debug the failing program call directly. Tip was paid. |
| `"Tip account lockout"` | Two bundles in the same slot contend for the same tip account | Pick a different tip account from the list (round-robin), or accept the occasional drop |
| Long delay, then `"Confirmed"` 60s+ later | Bundle landed but Solana RPC lag means your client only found out later. Bundle was probably fine. | None — landed late is still landed. Don't auto-retry. |

See [`docs/runbooks/bundle-not-landing.md`](runbooks/bundle-not-landing.md) for the diagnostic flow when bundles consistently fail.

---

## Bundle simulation: simulate before you tip

Every Jito-bundle script in this repo calls `simulateTransaction` on each tx **before** submitting to the block engine. The reason: **the tip is non-refundable**. A bundle that lands and reverts at the program level still costs you the tip.

The sim catches:
- Bad account references (e.g. wrong PDA derivation for mint metadata).
- Insufficient lamports for fee + rent + tip.
- Program-level errors (e.g. `createV2` rejecting the metadata URI).
- Compute-budget exhaustion.

It does **not** catch:
- Tip too low (sim runs the tx in isolation, not against block engine bidding).
- Race conditions (another tx changes state between sim and submit — rare but possible for shared accounts).
- Blockhash expiry between sim and submit.

The sim cost is negligible (1 RPC call per tx). Skipping the sim to save latency is a false economy; the tip you save from one caught error pays for years of sim calls.

---

## Toolkit conventions

What every Jito-using script in this repo does the same way:

1. **Single blockhash for the whole bundle.** Fetched once at start.
2. **Tip account chosen randomly per bundle** from the canonical list in [`src/lib/programs.ts`](../src/lib/programs.ts).
3. **`SetComputeUnitPrice` and `SetComputeUnitLimit` on every tx.** Price = `PRIORITY` env var (default 100,000 micro-lamports). Limit set per tx based on what's inside.
4. **Funder always pays the tip.** Creator is never the tip-payer, even when the creator signs other instructions in the same bundle.
5. **Bundle is built → simulated → submitted → polled for confirmation.** Failures at any stage abort and surface the error; no auto-retry of the same bundle.
6. **Region defaults to `mainnet.block-engine.jito.wtf`** (auto-routing). Override with `JITO_BLOCK_ENGINE_URL` if you have latency requirements.

---

## What this repo deliberately doesn't do

- **No private bundle relays.** All bundles go through Jito's public block engine. There's no MEV-share, no auction sidecar.
- **No back-running.** This toolkit is for owning-side ops (you launching, you collecting). It does not include front-runner or sandwich tooling and intentionally avoids that direction.
- **No bundle-as-a-tx tricks.** Some bots pack 5 txs into a bundle to dodge the per-tx CU cap. This repo's bundles are always 1 or 2 txs; bundling more would obscure intent without measurable gain for the launch/collect use case.
- **No tip optimization.** The repo uses a fixed `JITO_TIP` env var and lets the user pick. If you want dynamic tipping based on percentile of recent landed bundles, you'll need to write that wrapper.

---

## Related

- [`docs/architecture.md`](architecture.md) — the *why* behind the toolkit
- [`docs/transaction-size-budget.md`](transaction-size-budget.md) — why bundle splitting is forced on you
- [`docs/runbooks/bundle-not-landing.md`](runbooks/bundle-not-landing.md) — when nothing is landing
- [`docs/runbooks/tip-too-low.md`](runbooks/tip-too-low.md) — tuning the tip in busy markets
- [`tutorials/09-jito-bundle-anatomy.md`](../tutorials/09-jito-bundle-anatomy.md) — beginner walkthrough of one bundle
