# FAQ

Common questions about the `atomic` toolkit. For specific error messages, see [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md). For terminology, see [`GLOSSARY.md`](./GLOSSARY.md).

## General

### What does this repo do that I can't do with the regular pump-sdk?

The pump-sdk produces single transactions. This repo wraps multi-step flows (fund-then-create, collect-then-drain, buy-then-transfer) in **Jito bundles** so they land atomically. There's no time-window between txs for an MEV bot or sweeper to insert.

Use cases the regular SDK can't safely cover:

- Launch where the *funder* wallet differs from the *creator* wallet. Naive flow requires the funder to transfer rent SOL to the creator first; that money rests on the creator wallet for ~1 slot, long enough for a sweeper to take it.
- Collect creator fees on a coin whose creator key is shared/leaked. Naive collect leaves the SOL on the leaked wallet briefly before drain — race-able.
- Buy a token into a wallet that's known to attract sweepers. Same window problem.

### Why "atomic"?

Atomic in the database sense: a multi-step operation either all happens or none of it does. Jito bundles guarantee this on Solana — every tx in a bundle lands in the same block, in order, or the whole bundle reverts.

### Why Jito instead of priority fees?

Priority fees compete for inclusion in the next block but don't bind multiple txs together. A bundle of 2-5 txs paying the same priority fee is *not* guaranteed to execute in sequence — the leader can interleave other users' txs between them. Jito bundles do guarantee sequence.

Priority fees still matter *inside* a bundle: they increase the odds that the leader is a Jito-aware validator that processes the bundle at all.

### How much does a launch cost?

Roughly:

| Cost | Amount |
|------|--------|
| pump.fun create rent | ~0.022 SOL |
| Optional dev-buy | whatever you set in `DEV_BUY_SOL` |
| Priority fee | `PRIORITY` micro-lamports × CU consumed (~50K-200K CU per tx) |
| Jito tip | `JITO_TIP` (default 0.005 SOL, recommend 0.01-0.02 in busy markets) |
| Network fees | ~5000 lamports per tx |

So a no-dev-buy launch via `fire-jito` runs ~0.027-0.04 SOL total in a normal market, more in spikes. See [`docs/operations/cost-estimates.md`](./docs/operations/cost-estimates.md) for breakdowns.

## Wallets and keys

### What's the difference between funder and creator?

- **Funder**: the wallet that pays SOL for rent, priority fees, and Jito tip. Should be your hot wallet — keep its balance small.
- **Creator**: the wallet that appears as the coin's `creator` on Solscan and in pump.fun's UI. Can be a different identity from the funder. The `createV2` tx is signed by the creator; the funder is the fee payer.

The atomic patterns let these be different addresses without an exposed window where rent SOL sits on the creator wallet.

### Should I use the same wallet for funder and creator?

Sometimes. Cases:

- **Yes, same wallet**: solo launches, your own coin, you have full custody of one key.
- **No, separate**: brand launches with public/shared creator identity, multi-sig setups, leaked/shared creator keys.

The scripts work either way. Setting `FUNDER_SECRET == CREATOR_SECRET` in `.env` is supported but a couple of pre-flight assertions will note it.

### How do I generate a vanity creator address?

Two options:

1. `solana-keygen grind --starts-with abc:1` — Rust, multithreaded, fast.
2. `npm run grind` — JS, slow, but no Solana CLI dependency.

Vanity grinds are CPU-bound. A 3-char prefix is seconds. A 4-char prefix is minutes. A 5-char prefix is hours. A 6-char prefix is days. Plan accordingly.

### What if my creator key leaks?

Run [`docs/runbooks/leaked-key-response.md`](./docs/runbooks/leaked-key-response.md). Short version: drain the wallet immediately via `npm run consolidate` to a fresh safe wallet, then update `DESTINATION` going forward. Don't try to "rescue" funds in pieces — sweepers will get the rest while you're still typing.

## Jito and bundles

### What's the right tip?

- **0.001 SOL** is the floor — accepted but rarely lands during contested slots.
- **0.005 SOL** is a sane default for normal markets.
- **0.01-0.02 SOL** when bundles come back as `Invalid` or `Dropped` from the Block Engine.
- **0.05+ SOL** for must-land critical operations (initial liquidity in a viral launch, time-sensitive rescue). Beyond this, you're often better off retrying than escalating further.

See [`docs/operations/jito-tips.md`](./docs/operations/jito-tips.md) for the auction dynamics.

### Why does my bundle come back as "Invalid"?

Most common causes:

1. **Tip account out of date.** Jito rotates tip accounts. The scripts use a hardcoded list; if it drifts, you'll get `Invalid` errors. Run `npm run check-tip-accounts` to fetch the current list and update if needed.
2. **Tip below auction-clearing price.** Increase `JITO_TIP`.
3. **Blockhash expired between bundle assembly and submission.** The scripts refresh blockhash on retry; if you're sub-classing the bundle builder make sure to do the same.
4. **Bundle txs total > 5.** Jito caps bundles at 5 txs. The scripts in this repo top out at 2-3.

### Can I run bundles against Jito Devnet?

There is no Jito Devnet. The Block Engine is mainnet-only. Test against a throwaway mainnet wallet with minimal funds.

## pump.fun protocol

### What changed in the 2026-05-21 V2 USDC rollout?

USDC became a valid quote mint alongside wrapped SOL. V2 instructions take a `quote_mint` argument. SOL-paired coins still work with the V1 instructions; USDC-paired coins require V2.

The full engineering reference is at [`docs/v2-usdc-rollout/`](./docs/v2-usdc-rollout/). Key files:

- [`02-event-layouts.md`](./docs/v2-usdc-rollout/02-event-layouts.md) — byte-by-byte event record layouts.
- [`03-quote-mint-handling.md`](./docs/v2-usdc-rollout/03-quote-mint-handling.md) — reference parser/formatter code.
- [`07-migration-guide.md`](./docs/v2-usdc-rollout/07-migration-guide.md) — V1→V2 migration recipes by scenario.

### Do I need to update my scripts for V2?

- **If you only handle SOL pairs**: no. V1 keeps working.
- **If you handle USDC pairs**: yes. You need V2 builders that accept `quote_mint`.
- **If you parse events**: yes. The trailing `quote_mint` pubkey can mis-display SOL amounts as USDC (or vice versa) if ignored.

The atomic toolkit's `buy-jito.js` routes via Jupiter, which abstracts the V1/V2 distinction. For direct pump-sdk calls, you'll need `@nirholas/pump-sdk@1.33.0+` (the V2-aware release; see [`prompts/v2-usdc-rollout/01-pump-fun-sdk.md`](./prompts/v2-usdc-rollout/01-pump-fun-sdk.md) for the upgrade ticket).

### What's the difference between `createV2` and the V2 USDC rollout?

Confusingly, these are unrelated:

- **`createV2`**: the pump.fun create instruction added before the May-21 rollout. Adds `creator` pubkey, mayhem mode, and cashback toggle to the original `create`. Has been the standard since early 2026.
- **V2 USDC rollout (May 21)**: a separate batch of `*_v2` instructions for buy/sell/claim that introduces the `quote_mint` argument. Independent of the `createV2` instruction.

So `createV2` was on-chain before the May-21 V2 rollout — same `_v2` suffix, different upgrade.

## Operations

### Should I use Helius, Triton, or QuickNode?

Any of them. See [`docs/operations/rpc-providers.md`](./docs/operations/rpc-providers.md) for a comparison. Short version:

- **Helius**: best general-purpose for pump.fun work. Generous free tier, good Solana DAS APIs.
- **Triton**: best raw RPC performance. Higher cost.
- **QuickNode**: best multi-chain if you also touch EVM. Tighter rate limits on the free tier.

Avoid the public mainnet RPC for anything production. Rate limits will kill your scripts.

### Can I run watch-collect on Railway?

Yes. The script is a long-running poller. See [`tutorials/`](./tutorials/) — there's a Railway deployment tutorial in the parallel agent's series, or write your own based on the env-var setup.

### How do I know if my distribute.js payout went through?

Each Jito bundle returns a bundle ID. Check status:

```bash
curl -X POST https://mainnet.block-engine.jito.wtf/api/v1/bundles \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getBundleStatuses","params":[["<bundle-id>"]]}'
```

Or watch the destination wallet for the inbound transfer.

## Contributing

### How do I add a new script?

1. Open an issue describing what flow it covers and why the existing scripts can't do it.
2. After ack: add `src/<your-script>.js`, a corresponding `docs/scripts/<your-script>.md`, and a `skills/<your-script>/SKILL.md`.
3. Add an `npm run <name>` entry in `package.json`.
4. Manual-test against a throwaway wallet. Include the tx signature in the PR.

### Why is the structure so opinionated?

Because the scripts move real money. The opinionation pays for itself the first time someone catches a typo in `DESTINATION` before sending. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`AGENTS.md`](./AGENTS.md) for the full house style.
