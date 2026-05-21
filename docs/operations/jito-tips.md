# Jito tips and bundle dynamics

This file is the field guide for picking the right Jito tip, handling tip-account rotation, and diagnosing why a bundle didn't land.

For "what is a Jito bundle?" see [`../architecture.md`](../architecture.md). For the broader Block-Engine flow see [Jito's official docs](https://docs.jito.wtf).

## The tip — what it is

A Jito bundle pays a **tip** as part of one of its transactions. The tip is a SOL transfer to one of Jito's 8 rotating tip accounts. Higher tips:

- Outbid other searchers competing for the same slot.
- Make your bundle more attractive to the leader (the leader keeps the tip).

The tip is **separate from the priority fee**. Priority fee raises your tx's inclusion priority within a block; tip is the bid in Jito's bundle auction.

You can pay both. Most scripts here pay both:

- A modest priority fee (`PRIORITY=2000000` micro-lamports/CU = 0.002 SOL per ~1M CU consumed).
- A modest tip (`JITO_TIP=0.005` SOL).

## Tip amounts by use case

| Use case | Suggested tip | Rationale |
|----------|--------------|-----------|
| Off-hours collect | 0.001 SOL | Lowest accepted floor. Bundles still land in uncontested slots. |
| Normal-market collect / consolidate | 0.005 SOL | The default. Lands within 1-2 slots in normal conditions. |
| Active-market launch | 0.01 SOL | Competing with snipers and other launches in same slot. |
| Must-land rescue (leaked-key emergency) | 0.02-0.05 SOL | Don't bargain when funds are at risk. |
| Viral-launch initial dev-buy | 0.05+ SOL | If the launch is anticipated, every searcher is bidding. |

The "right" tip is the lowest tip that still lands consistently. Start low, raise on failures.

## Tip-account rotation

Jito has 8 tip accounts. The list rotates periodically. The atomic toolkit scripts include a hardcoded list compiled at script-write time. If Jito rotates the list and your scripts haven't been updated, you'll see:

```
Error: Bundles must write lock at least one tip account
```

This is the **#1 reason "Invalid" bundles** come back.

**Fix:**

```bash
npm run check-tip-accounts
```

This `tools/check-tip-accounts.ts` script fetches the current list from the Jito Block Engine and prints them. Compare to your hardcoded list and update if drifted.

Recent Jito tip accounts (subject to rotation — verify before relying):

```
T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt
4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE
9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta
DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL
3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT
HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe
ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49
ADuUkR4vqLUMWXxW9gh6D6L8pivKeVBBXQjvA3kZQjY
```

Your live list may differ — `npm run check-tip-accounts` is the source of truth.

## Bundle states

After submission, a bundle goes through:

1. **`Accepted`**: Jito received and validated it. Not landed yet.
2. **`Landed`**: included in a block. Final.
3. **`Invalid`**: validation failed (tip-account drift, blockhash expired, tx error). Will not land.
4. **`Dropped`**: validated but not picked up by the leader. Common in non-Jito leader slots.

The scripts retry on `Invalid` (after fixing the cause) and on `Dropped` (with a fresh blockhash). Polling:

```bash
curl -X POST https://mainnet.block-engine.jito.wtf/api/v1/bundles \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getBundleStatuses","params":[["<bundle-id>"]]}'
```

## Diagnosing "Invalid"

```
Error: Bundle was rejected: Invalid
```

In rough frequency order:

1. **Tip-account drift** (60%+ of cases). Run `npm run check-tip-accounts`, update the list.
2. **Tip below clearing price** (20%). Raise `JITO_TIP`. Quick test: try 0.01 SOL. If that lands, the issue was tip.
3. **One of the txs is malformed** (10%). The scripts validate before submitting, but if you wrote a custom one, double-check signers, blockhash, account ordering.
4. **Bundle has >5 txs** (5%). Jito caps at 5. Trim.
5. **Blockhash expired between assembly and submission** (5%). Re-assemble.

## Diagnosing "Dropped"

```
Bundle was dropped (not included in any block)
```

The Block Engine accepted it, but no leader scheduled it within the bundle's lifetime. Causes:

1. **Non-Jito leader.** Some leaders ignore Jito. Wait 1-2 slots and retry.
2. **Tip too low for the slot.** A leader with many bundles to choose from picks the highest tips. Raise.
3. **Network congestion peak.** Wait 5-10 seconds and retry — congestion peaks are short.
4. **Bundle expired (blockhash too old).** Re-assemble with fresh blockhash.

The scripts retry `Dropped` automatically with a few-second backoff.

## Tip placement in the bundle

The tip ix can be in any tx of the bundle, but conventions matter:

- **`fire-jito.js`**: tip in Tx1 (the funder's tx). Tx2 is creator-only and the creator may not have rent SOL yet to pay the tip.
- **`collect-jito.js`**: single-tx bundle. Tip in that one tx.
- **`consolidate.js`**: tip in the first tx of the bundle.
- **`buy-jito.js`**: tip in the swap tx itself.
- **`rescue-tokens.js`**: tip in the source-wallet's tx (it's the one needing atomicity guarantees).

If you write a custom bundle, put the tip in a tx whose signer has SOL to cover it.

## Priority fee vs Jito tip — both?

Yes, almost always. They do different things:

| | Priority fee | Jito tip |
|---|--------------|----------|
| Goes to | Validator | Jito Block Engine (then validator) |
| Effect | Higher inclusion priority within a block | Higher rank in bundle auction |
| Measured in | μ-lamports per CU | SOL total |
| Default in toolkit | `PRIORITY=2000000` | `JITO_TIP=0.005` |
| When to raise | Network is congested at the leader level | Bundle auction is competitive |

Raising one without the other helps in narrow cases:

- **Raise priority only**: leader is Jito-aware but no bundle competition (off-hours).
- **Raise tip only**: heavy bundle competition but underlying network isn't congested.
- **Raise both**: peak hours, popular launch slot.

## Jito Block Engine endpoints

Default mainnet endpoint:

```
https://mainnet.block-engine.jito.wtf
```

Regional endpoints exist for latency optimization (US, EU, Asia). The toolkit defaults to mainnet; override via:

```bash
JITO_BLOCK_ENGINE_URL=https://amsterdam.mainnet.block-engine.jito.wtf
```

Lower latency to your region = faster bundle acceptance. Test before committing.

## Cost summary

For a typical 2-tx bundle:

| Component | Cost |
|-----------|------|
| 2× network fees | ~0.00001 SOL |
| Priority fee (avg ~200K CU) | ~0.0004 SOL |
| Jito tip | 0.005 SOL (default) |
| **Total overhead per bundle** | **~0.0055 SOL** |

So a typical launch via `fire-jito.js` costs ~0.005 SOL more than the same launch without atomic guarantees. The atomic guarantees are worth that on any operation involving a leaked or shared key.

## Pitfalls

- **Don't pay the tip from a wallet that has no SOL.** Bundle validation catches this, but you waste a tx in fees.
- **Don't put the tip ix in a tx that may fail.** If the failing tx is the tip-payer, the whole bundle reverts and the leader gets nothing — you've wasted a slot for no progress.
- **Don't hardcode tip accounts** without a way to refresh them. The `check-tip-accounts.ts` tool exists for a reason.
- **Don't expect rebates.** Even if your bundle is dropped, the priority fee is still charged. Tips that don't land are refunded; priority fees aren't.

## Related

- [`../architecture.md`](../architecture.md) — bundle layouts and why we use them
- [`cost-estimates.md`](./cost-estimates.md) — full cost breakdowns per flow
- [`../scripts/fire-jito.md`](../scripts/fire-jito.md) — specific tip handling for launches
- [`../scripts/collect-jito.md`](../scripts/collect-jito.md) — specific tip handling for collects
- `tools/check-tip-accounts.ts` — fetches the current tip-account list from Jito
