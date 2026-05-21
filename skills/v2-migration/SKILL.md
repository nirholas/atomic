---
name: atomic-v2-migration
description: Use when the user wants to migrate code, scripts, or downstream consumers from pump.fun's V1 (SOL-pool) layout to V2 (USDC-pool) layout, or is debugging an issue caused by the V2 USDC rollout. Triggers on "V2 USDC", "pump V2", "V1 to V2 migration", "USDC pool", "quote mint", "new discriminator", "BuybackFeeRecipient", "event layout changed", "pump-sdk doesn't decode", "creator fees in USDC now", or any V1→V2 migration question. The rollout happened 2026-05; code written before that date may need updates.
---

# atomic-v2-migration — V1 → V2 USDC pool migration assistant

Pump.fun shipped a V2 program upgrade in May 2026 that changes the quote-mint from SOL to USDC on new launches, adds accounts to existing instructions, and modifies event layouts. Code written against V1 will fail in distinct, diagnosable ways. This skill is the navigation aid: identifies which docs to read for which symptom, lists the breaking changes by impact area, and recommends a migration order.

The repo already contains a comprehensive reference in [`docs/v2-usdc-rollout/`](../../docs/v2-usdc-rollout/) — this skill points there rather than duplicating it. Treat this skill as the index + decision guide for that reference set.

## Decision flow — "is my code affected?"

| Question | If YES |
|---|---|
| Does your code parse pump.fun **events** (Create, Buy, Sell, Swap, Complete)? | Affected. See [02-event-layouts.md](../../docs/v2-usdc-rollout/02-event-layouts.md) |
| Does your code build pump.fun **instructions** directly (not via pump-sdk)? | Affected. See [01-discriminators.md](../../docs/v2-usdc-rollout/01-discriminators.md) |
| Does your code use **pump-sdk** at a version < 1.30? | Probably affected. Bump to ≥ 1.30; check the changelog |
| Does your code assume the **quote-mint is SOL** (e.g. parses lamports from "amount in")? | Affected. See [03-quote-mint-handling.md](../../docs/v2-usdc-rollout/03-quote-mint-handling.md) |
| Does your code consume creator-fee payouts? | Affected — V2 payouts can be USDC, not SOL. Check downstream wallet handling |
| Does your code only **launch / buy / collect** via the scripts in `src/` (this repo)? | Mostly safe — the scripts have been updated. But read [04-pumpkit-changes.md](../../docs/v2-usdc-rollout/04-pumpkit-changes.md) for caveats |
| Does your code subscribe to pump.fun program logs and decode them? | Affected (event layouts changed). See [02-event-layouts.md](../../docs/v2-usdc-rollout/02-event-layouts.md) |
| Does your code only audit wallets (`check-pump-funding`)? | Not affected — provenance check doesn't depend on pool layout |

## What changed (high-level summary)

V2 is not a hard fork — V1 coins still trade on the V1 program. V2 is a new program with new instructions/events. The breaking points for migrating code:

1. **New quote-mint.** V1 used SOL as the quote-mint of every pump.fun coin. V2 introduces USDC-quoted coins. Any code that hardcodes the quote-mint as `So111...` or expects amounts in lamports will mis-handle V2.
2. **New discriminators.** Anchor-style instruction and event discriminators changed for several instructions, with V2-specific variants (e.g. `createV2`, `swapV2`). Code that hardcodes the V1 discriminator bytes will silently skip V2 events. Full table: [01-discriminators.md](../../docs/v2-usdc-rollout/01-discriminators.md).
3. **New required accounts.** Several instructions added accounts (e.g. `BuybackFeeRecipient` on `buy` in a V1 patch; further accounts in V2). pump-sdk < 1.30 emits the old account set; the program rejects with `MissingAccount`.
4. **Event layouts changed.** V2 events have additional fields (quote-mint, USDC-specific math) and re-ordered fields in some cases. Byte-level layouts in [02-event-layouts.md](../../docs/v2-usdc-rollout/02-event-layouts.md).
5. **Creator-fee payout currency.** V2 USDC-quoted coins pay creator fees in USDC, not SOL. Downstream code that assumed SOL payouts to the creator vault will see USDC ATAs accumulate instead.
6. **Pool-state PDA derivation may have changed** for V2-USDC pools. Check the rollout reference if you derive PDAs manually.

## Migration order

If you maintain a downstream codebase that consumes pump.fun events or builds pump.fun txs, migrate in this order. Each step is gated by tests in the next.

1. **Bump pump-sdk to ≥ 1.30** (or the latest at the time you migrate). Run typecheck. Fix any new required arguments.
2. **Update discriminator tables** if you hardcode them. Anchor-style code typically uses the SDK's generated coder — that's safe if the SDK is bumped. Raw byte-level decoders need updating.
3. **Add a quote-mint branch** to every parser that handles amounts: if `quoteMint === USDC`, treat as USDC decimals (6); if `SOL`, lamports (9). [03-quote-mint-handling.md](../../docs/v2-usdc-rollout/03-quote-mint-handling.md) has the conversion patterns.
4. **Update event handlers** to read the new fields. Old handlers will work on V1 events but ignore V2 events (or worse, mis-parse them).
5. **Update downstream display** — UIs, dashboards, alerts. Showing a USDC amount as "SOL" misleads users.
6. **Regression-test against fixtures.** [08-testing-strategy.md](../../docs/v2-usdc-rollout/08-testing-strategy.md) describes the fixture set: V1 events, V2-SOL events, V2-USDC events, edge cases.
7. **Audit creator-fee handlers.** If you have downstream auto-sweeping or accounting on creator vaults, ensure USDC ATAs are recognized.
8. **Bump dependent libraries.** See [05-cross-repo-audit.md](../../docs/v2-usdc-rollout/05-cross-repo-audit.md) for the user's other pump-fun repos and their V2 status.

## Symptoms → fix

| Symptom | Cause | Fix |
|---|---|---|
| `buy` ix builds but tx fails with `MissingAccount` | pump-sdk < 1.30 missing `BuybackFeeRecipient` or other V2 account | Bump pump-sdk; or route via Jupiter ([atomic-buy](../buy/SKILL.md)) |
| Event decoder returns `null` or `undefined` for fresh launches | Hardcoded V1 discriminator filters out V2 events | Update discriminator table per [01-discriminators.md](../../docs/v2-usdc-rollout/01-discriminators.md) |
| "Amount in" displayed as 1e9× too small | Code divides by 1e9 (SOL) but amount is in USDC (1e6) | Branch on quote-mint; use correct decimals |
| Creator vault is empty but coin has trade volume | Coin is V2-USDC; fees pay to USDC ATA, not SOL | Sweep the USDC ATA, not the SOL vault PDA |
| `collectCoinCreatorFee` lands but transfers 0 lamports | Same as above — wrong currency assumption | Update the collector to handle both currencies |
| Event has unexpected extra bytes after decode | V2 event has new trailing fields; old layout misses them | Extend the layout struct per [02-event-layouts.md](../../docs/v2-usdc-rollout/02-event-layouts.md) |
| Dashboard shows V2 launches as "no quote mint" or "unknown" | Code defaults quote-mint to SOL when field is missing in V1 events; V2 events have it explicitly and the parser doesn't read it | Read the new `quoteMint` field |

## Reference index

The rollout reference under [`docs/v2-usdc-rollout/`](../../docs/v2-usdc-rollout/) is exhaustive. Quick navigation:

| File | What it covers |
|---|---|
| [00-context.md](../../docs/v2-usdc-rollout/00-context.md) | Why V2, what changed at the program level |
| [01-discriminators.md](../../docs/v2-usdc-rollout/01-discriminators.md) | Canonical V1 + V2 ix and event discriminators |
| [02-event-layouts.md](../../docs/v2-usdc-rollout/02-event-layouts.md) | Byte-by-byte event record layouts |
| [03-quote-mint-handling.md](../../docs/v2-usdc-rollout/03-quote-mint-handling.md) | Parser, conversion, and display patterns for mixed-currency pools |
| [04-pumpkit-changes.md](../../docs/v2-usdc-rollout/04-pumpkit-changes.md) | What changed in pumpkit specifically |
| [05-cross-repo-audit.md](../../docs/v2-usdc-rollout/05-cross-repo-audit.md) | V2 readiness of related repos (pump-fun-sdk, pump-swap-sdk, pumpfun-claims-bot, pumpfun-creator-rewards, three.ws) |
| [06-prompts-summary.md](../../docs/v2-usdc-rollout/06-prompts-summary.md) | Summary of the executor prompts under `prompts/v2-usdc-rollout/` |
| [07-migration-guide.md](../../docs/v2-usdc-rollout/07-migration-guide.md) | Per-scenario recipes |
| [08-testing-strategy.md](../../docs/v2-usdc-rollout/08-testing-strategy.md) | Fixtures, regressions, CI matrix |
| [09-glossary.md](../../docs/v2-usdc-rollout/09-glossary.md) | Terminology: quote-mint, bonding curve, graduation, BuybackFeeRecipient, etc. |

Executor prompts (for running migration agents):

- [01-pump-fun-sdk.md](../../prompts/v2-usdc-rollout/01-pump-fun-sdk.md) — migrate the upstream SDK
- [02-pump-swap-sdk.md](../../prompts/v2-usdc-rollout/02-pump-swap-sdk.md) — migrate the swap SDK
- [03-pumpfun-claims-bot.md](../../prompts/v2-usdc-rollout/03-pumpfun-claims-bot.md) — port the claims bot
- [04-pumpfun-creator-rewards.md](../../prompts/v2-usdc-rollout/04-pumpfun-creator-rewards.md) — update creator-rewards display
- [05-three-ws-sync.md](../../prompts/v2-usdc-rollout/05-three-ws-sync.md) — re-sync vendored files

## When you don't need to migrate

If your code only:
- Audits wallet provenance via `check-pump-funding.ts` — unaffected.
- Runs this repo's scripts (`npm run launch / collect / buy / rescue / consolidate / distribute`) — the scripts have been updated. Read [04-pumpkit-changes.md](../../docs/v2-usdc-rollout/04-pumpkit-changes.md) for any version-specific caveats.
- Manipulates Solana primitives below pump.fun (raw SPL transfers, SOL transfers, ATA creation) — unaffected.

If you exclusively trade on V1 coins (i.e. coins that launched before May 2026 and never migrated) and your tooling doesn't touch V2 coins, you can defer migration. But V1 launches are now rare; the V1 ecosystem is decaying.

## Related

- [atomic-buy](../buy/SKILL.md) — uses Jupiter to dodge most V1/V2 SDK drift
- [atomic-launch](../launch/SKILL.md) — `createV2` is the post-migration launch path
- [atomic-bundle-debug](../bundle-debug/SKILL.md) — for `MissingAccount`-style migration symptoms
- [docs/v2-usdc-rollout/](../../docs/v2-usdc-rollout/) — full reference
- [prompts/v2-usdc-rollout/](../../prompts/v2-usdc-rollout/) — executor prompts
