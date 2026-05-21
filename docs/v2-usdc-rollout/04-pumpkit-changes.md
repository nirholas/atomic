# pumpkit V2 USDC Changes (2026-05-19)

Captures everything that shipped to [`nirholas/pumpkit`](https://github.com/nirholas/pumpkit) in the May-19 work cycle that brought the framework in line with the May-21 V2 USDC rollout.

## Commits

| SHA | Subject |
|-----|---------|
| `bced3b1` | `feat(channel): add pump.fun V2 support with USDC quote awareness` *(pre-existing prior commit; channel package work)* |
| `c0f965d` | `feat(claim,core,web): quote-mint aware claim parsing and rendering` |
| `a7bf5a9` | `feat(web): render V2 quote ticker in distribution card and Dashboard mapping` |
| `3c29d0c` | `docs(web): add V2 USDC rollout note to CreateCoin walkthrough` |
| *(uncommitted in working tree at time of capture)* | core formatter cleanup: import `WSOL_MINT` from `solana/programs.ts` instead of redeclaring it |

## Package-by-package summary

### `packages/channel/` (already V2-aware before this cycle)

Bone-stock observability bot for pump.fun fee claims. Pre-existing commit `bced3b1` had already:

- Added V2 instruction discriminators in `src/types.ts`.
- Added `WSOL_MINT`, `USDC_MINT`, `QUOTE_MINT_INFO`.
- Added quote-aware fields to `FeeClaimEvent`: `quoteMint`, `quoteTicker`, `isStableQuote`, `amountQuote`, `lifetimeClaimedQuote`.
- Updated `src/claim-monitor.ts` to parse trailing `quote_mint` from all four V2 event layouts.
- Partially updated `src/formatters.ts` to render via `quoteTicker` / `amountQuote`.

This package was the reference implementation for the claim/core/web work below.

### `packages/claim/` (the biggest gap before this cycle)

Standalone Telegram fee-claim tracker bot. Was V1-only — would have silently missed every V2 claim after May 21.

**Changes:**

- **`src/types.ts`** — Added `WSOL_MINT`, `USDC_MINT`, `QUOTE_MINT_INFO`. Appended 5 V2 instruction definitions to `CLAIM_INSTRUCTIONS` (each mapped to its V1 `ClaimType` for downstream unification). Added 4 quote-aware fields to `FeeClaimEvent`: `quoteMint`, `quoteTicker`, `isStableQuote`, `amountQuote`.

- **`src/rpc-monitor.ts`** — Rewrote `extractClaim()` to parse `meta.logMessages` event data and pull the trailing `quote_mint`. Added a new top-level helper `parseClaimEventFromLogs(logMessages, claimType)` handling all 5 event discriminators with branch-by-length. Kept lamport-balance-delta as the V1 fallback. Updated the `log.info` line to render the actual ticker.

- **`src/monitor.ts`** (relay WebSocket client) — Extended `RelayFeeClaimMessage` with the 4 V2 fields. Forwarded them through to `FeeClaimEvent`. Log line uses dynamic ticker.

- **`src/formatters.ts`** — `formatClaimNotification()` now uses `event.quoteTicker ?? 'SOL'` and `event.amountQuote ?? event.amountSol`. Display precision is 2dp when `isStableQuote`, 4dp otherwise. The Telegram "Amount:" line shows correct currency for USDC claims.

**Verification:** all package typechecks pass cleanly.

### `packages/core/`

Shared utilities used by all the bots.

**Changes:**

- **`src/formatter/links.ts`** — Added quote-aware formatter:

  ```ts
  export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  export const QUOTE_MINT_INFO: Record<string, { ticker; decimals; isStable }> = {
      [WSOL_MINT]: { ticker: 'SOL',  decimals: 9, isStable: false },
      [USDC_MINT]: { ticker: 'USDC', decimals: 6, isStable: true },
  };
  export function formatQuoteAmount(baseUnits: number | bigint, quoteMint?: string): string {
      const info = QUOTE_MINT_INFO[quoteMint ?? WSOL_MINT] ?? QUOTE_MINT_INFO[WSOL_MINT]!;
      const amount = Number(baseUnits) / Math.pow(10, info.decimals);
      const precision = info.isStable ? 2 : (amount < 1 ? 4 : 2);
      return `${amount.toFixed(precision)} ${info.ticker}`;
  }
  ```

  `WSOL_MINT` itself stays in `src/solana/programs.ts` as the single source of truth; `links.ts` imports it.

- **`src/formatter/templates.ts`** — `ClaimEventData` and `FeeDistEventData` gained optional `quoteMint`. `formatClaim()` and `formatFeeDistribution()` (and the per-shareholder lines) use `formatQuoteAmount` instead of `formatSol`. `formatSol` itself is preserved (existing tests use it, V1 callers keep working).

- **`src/formatter/index.ts`** and **`src/index.ts`** — Export `formatQuoteAmount`, `USDC_MINT`, `QUOTE_MINT_INFO`.

**Verification:** 53/53 vitest tests pass. `formatSol` backward-compat preserved.

### `packages/web/`

React dashboard.

**Changes:**

- **`src/components/EventCard.tsx`** — `FeedEvent` interface extended with optional `amountQuote: number` and `quoteTicker: string`. Added `pickAmount(e)` helper:

  ```ts
  export function pickAmount(e: FeedEvent): { amount: number; ticker: string; isStable: boolean } {
      if (e.quoteTicker && typeof e.amountQuote === 'number') {
          return { amount: e.amountQuote, ticker: e.quoteTicker, isStable: e.quoteTicker === 'USDC' };
      }
      return { amount: e.amountSol, ticker: 'SOL', isStable: false };
  }
  ```

  All four event-card branches (whale, graduation, claim, distribution) use it. Distribution card's per-shareholder rows also render in the resolved ticker (assumes shareholders share the parent's quote mint, which is correct on-chain).

- **`src/pages/Dashboard.tsx`** — `toFeedEvent(e, i)` now passes through `amountQuote` and `quoteTicker` from the SSE payload.

- **`src/pages/CreateCoin.tsx`** — Added a new `BotBubble` after the SDK Features grid explaining the V2 rollout, noting that V2 buy/sell builders are pending in the next `@nirholas/pump-sdk` release, and linking to the official docs. Plain-English content so non-technical readers understand what's changing.

**Verification:** typecheck clean.

## What was deliberately not done in pumpkit

These choices were validated against the user during the work cycle:

1. **No V2 buy/sell wiring.** pumpkit doesn't submit trades anywhere — `src/solana/sdk-bridge.ts` is read-only fetches. The `@nirholas/pump-sdk@1.32.0` peer dep doesn't yet expose V2 buy/sell builders with `quoteMint`. That work is queued in [`prompts/v2-usdc-rollout/01-pump-fun-sdk.md`](../../prompts/v2-usdc-rollout/01-pump-fun-sdk.md). After that ships, bump the peer dep in `packages/core/package.json`.

2. **No live USDC option in CreateCoin.** That's a docs page, not a live trader. The new bubble explains the deferred trading-side work to readers.

3. **`packages/monitor/`** has pre-existing typecheck errors unrelated to V2 (missing exports from `./types.js` for several existing names). Left as-is — fixing belongs in a separate cleanup commit.

## Files touched (final list)

```
packages/channel/src/types.ts                    (pre-existing, bced3b1)
packages/channel/src/claim-monitor.ts            (pre-existing, bced3b1)
packages/channel/src/formatters.ts               (pre-existing, bced3b1)

packages/claim/src/types.ts                      (c0f965d)
packages/claim/src/rpc-monitor.ts                (c0f965d)
packages/claim/src/monitor.ts                    (c0f965d)
packages/claim/src/formatters.ts                 (c0f965d)

packages/core/src/formatter/links.ts             (c0f965d, then post-cleanup)
packages/core/src/formatter/templates.ts         (c0f965d)
packages/core/src/formatter/index.ts             (c0f965d, then post-cleanup)
packages/core/src/index.ts                       (c0f965d, then post-cleanup)

packages/web/src/components/EventCard.tsx        (c0f965d, a7bf5a9)
packages/web/src/pages/Dashboard.tsx             (c0f965d)
packages/web/src/pages/CreateCoin.tsx            (3c29d0c)
```

## Lessons for the cross-repo work

These observations from the pumpkit pass shaped the standalone prompts under `../../prompts/v2-usdc-rollout/`:

1. **The V1/V2 boundary lives in event parsing, not instruction decoding.** Instruction discs are easy — just append to a table. The risk is in events where the same discriminator now means a different layout.
2. **Preserving `formatSol` is worth the duplication.** Existing tests and call sites stay green; new code uses `formatQuoteAmount`. Forcing a rename would have churned every test fixture.
3. **`amountSol = isStable ? 0 : (baseUnits / 1e9)`** is the cheap correctness trick. Without it, legacy code paths silently mis-display USDC amounts as wildly-incorrect SOL values.
4. **`pickAmount(e)` in the UI is worth extracting once.** The four event-card branches all need the same logic; inlining it leads to bugs at the third copy.
