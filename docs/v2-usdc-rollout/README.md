# pump.fun V2 USDC Quote-Mint Rollout — Engineering Reference

> A complete reference for the **2026-05-21** pump.fun upgrade that enables USDC as a quote mint alongside SOL. Captures discriminators, event byte-layouts, parsing logic, migration steps, per-repo readiness, and the standalone prompts used to bring the nirholas-owned repos in line.

## TL;DR

- **What changed on-chain (2026-05-21):** pump.fun introduced V2 versions of the create / buy / sell / fee-claim instructions that accept a **`quote_mint`** argument and emit a trailing `quote_mint` pubkey on event records. Coins paired against **USDC** can only be traded through the V2 path. SOL pairs keep V1 working (and the V2 path is also valid for SOL pairs, just with `quote_mint = wSOL`).
- **Why it matters:** any code that parses pump.fun events, decodes claim instructions, or builds buy/sell txs needs to handle the trailing `quote_mint` field and the new V2 discriminator hex values, or it will silently mis-parse USDC-paired activity.
- **What was done in this work cycle (2026-05-19 → 2026-05-21):**
  1. Updated [pumpkit](https://github.com/nirholas/pumpkit) — channel, claim, core, and web packages — to be fully V2-aware.
  2. Audited all 9 nirholas pump-related repos for V2 readiness.
  3. Authored 5 standalone executor prompts covering every remaining repo (pump-fun-sdk, pump-swap-sdk, pumpfun-claims-bot, pumpfun-creator-rewards, three.ws).
  4. Captured the full reference set in this directory.

## How this directory is organized

| File | Purpose |
|------|---------|
| [00-context.md](./00-context.md) | Plain-English explanation of the rollout, the on-chain changes, and the downstream impact. |
| [01-discriminators.md](./01-discriminators.md) | Canonical table of V1 + V2 instruction discriminators across the Pump, PumpSwap AMM, and Pump-fees programs. |
| [02-event-layouts.md](./02-event-layouts.md) | Byte-by-byte layout reference for every claim/trade event, V1 and V2. The thing you grep when something parses wrong. |
| [03-quote-mint-handling.md](./03-quote-mint-handling.md) | How to resolve a `quote_mint` pubkey to ticker + decimals, convert base units → human amounts, and choose display precision. Includes the reference TypeScript implementation. |
| [04-pumpkit-changes.md](./04-pumpkit-changes.md) | Exact diff of what shipped in pumpkit on 2026-05-19, file by file, commit by commit. |
| [05-cross-repo-audit.md](./05-cross-repo-audit.md) | Per-repo V2 readiness table for every nirholas pump-related repo, with file paths and the specific gaps that exist. |
| [06-prompts-summary.md](./06-prompts-summary.md) | Index of the 5 standalone executor prompts under `../../prompts/v2-usdc-rollout/`, including what each delivers and dependency notes. |
| [07-migration-guide.md](./07-migration-guide.md) | How a downstream caller migrates from V1 to V2: SDK calls, event consumers, display layers. |
| [08-testing-strategy.md](./08-testing-strategy.md) | What to test, what fixtures to capture, and how to keep V1/V2 layouts cleanly tested. |
| [09-glossary.md](./09-glossary.md) | Key terms: quote mint, wSOL, USDC mint, ATA, Anchor discriminator, etc. |

The 5 standalone executor prompts live alongside this reference at [`../../prompts/v2-usdc-rollout/`](../../prompts/v2-usdc-rollout/). Each prompt clones its target repo, makes the V2 changes, runs the verification checklist, commits as `nirholas <nirholas@users.noreply.github.com>`, pushes, and self-deletes.

## Key constants (memorize these)

| Constant | Value |
|----------|-------|
| wSOL mint | `So11111111111111111111111111111111111111112` |
| USDC mint | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Pump program | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| PumpSwap AMM program | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| Pump fees program | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |
| Rollout date | 2026-05-21 |

## Authoritative external sources

- **Official protocol docs:** <https://github.com/pump-fun/pump-public-docs>
- **Creator-fee instruction docs:**
  - <https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md>
  - <https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md>
- **Canonical Rust reference implementation:** [`nirholas/pumpfun-rust-client`](https://github.com/nirholas/pumpfun-rust-client) — see `src/sdk/pump_v2.rs`, `examples/buy_v2.rs`, `examples/sell_v2.rs`, `tests/v2_custom_quote_mint.rs`.
- **Canonical TypeScript reference implementation:** [`nirholas/agent-payments-sdk`](https://github.com/nirholas/agent-payments-sdk) — see `src/solana/pump-events.ts` and the `swap/scripts/build-*-v2-tx.mjs` family.

## Quick links by role

**"I need to monitor pump.fun events and not miss USDC claims":** start with [02-event-layouts.md](./02-event-layouts.md) and [03-quote-mint-handling.md](./03-quote-mint-handling.md). Reference impl in [pumpkit `packages/claim/src/rpc-monitor.ts`](https://github.com/nirholas/pumpkit/blob/main/packages/claim/src/rpc-monitor.ts).

**"I need to build V2 buy/sell transactions in TypeScript":** start with [07-migration-guide.md](./07-migration-guide.md). The SDK work itself is tracked under [`prompts/v2-usdc-rollout/01-pump-fun-sdk.md`](../../prompts/v2-usdc-rollout/01-pump-fun-sdk.md).

**"I need to display USDC amounts correctly in a UI":** start with [03-quote-mint-handling.md](./03-quote-mint-handling.md). Reference impls in [`packages/core/src/formatter/links.ts`](https://github.com/nirholas/pumpkit/blob/main/packages/core/src/formatter/links.ts) (`formatQuoteAmount`) and [`packages/web/src/components/EventCard.tsx`](https://github.com/nirholas/pumpkit/blob/main/packages/web/src/components/EventCard.tsx) (`pickAmount`).

**"I want the full status of every nirholas pump repo":** [05-cross-repo-audit.md](./05-cross-repo-audit.md).
