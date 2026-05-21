# Task: Add V2 USDC quote-mint awareness to `nirholas/pumpfun-claims-bot`

## Context

pump.fun is rolling out **V2 instructions on 2026-05-21** that allow coins to be paired against USDC in addition to SOL. V2 fee-claim instructions emit the same event discriminators as V1 but append a trailing `quote_mint` pubkey to the event record, and V2 instructions use new discriminator hex values.

The standalone repo `nirholas/pumpfun-claims-bot` is a Telegram fee-claim monitor whose `src/types.ts` lists only V1 instruction discriminators and does not parse the quote-mint trailing field. Once V2 ships, the bot will silently miss any claim made via the V2 instructions on USDC-paired coins (and any V2 claim on SOL-paired coins).

The pumpkit monorepo at `nirholas/pumpkit` shipped this exact fix on 2026-05-19 in commit `c0f965d` (`feat(claim,core,web): quote-mint aware claim parsing and rendering`). **Mirror that work into this standalone repo.**

USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
wSOL mint: `So11111111111111111111111111111111111111112`

V2 instruction discriminators to add:

| Instruction | Hex disc | Program |
|-------------|----------|---------|
| collect_creator_fee_v2 | `cf118af204221338` | Pump (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) |
| distribute_creator_fees_v2 | `ffcb134ff444089f` | Pump |
| transfer_creator_fees_to_pump_v2 | `01214eb921432c5c` | PumpSwap AMM (`pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`) |
| claim_social_fee_pda_v2 | `114df0863abc3595` | Pump fees (`pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`) |
| update_fee_shares_v2 | `6ffb31064e4e6a12` | Pump fees |

V2 event layouts (deltas relative to V1):

- `CollectCreatorFeeEvent` (disc `7a027f010ebf0caf`): V2 appends `quote_mint(32)` at byte offset 56.
- `DistributeCreatorFeesEvent` (disc `a537817004b3ca28`): V2 appends `quote_mint(32)` immediately after the `distributed(u64)` field (which itself sits after the variable-length shareholder vec — walk the vec to find the offset).
- `SocialFeePdaClaimed` (disc `3212c141edd2eaec`): V2 appends `recipient_balance_before(8) + recipient_balance_after(8) + quote_mint(32) + lifetime_stable_claimed(u64)` after `lifetime_claimed`.
- `ClaimCashbackEvent` (disc `e2d6f62107f293e5`): no V2 trailing field — leave parsing as-is.
- `CollectCoinCreatorFeeEvent` (disc `e8f5c2eeeada3a59`): no quote-mint trailing field per current spec; leave as-is unless on-chain spec changes.

The reference implementation lives in pumpkit's `packages/claim/` directory. The key files to mirror are `packages/claim/src/types.ts`, `packages/claim/src/rpc-monitor.ts` (the `parseClaimEventFromLogs` helper), `packages/claim/src/monitor.ts`, and `packages/claim/src/formatters.ts`.

## What to deliver

1. **`src/types.ts`** (or equivalent):
   - Add `WSOL_MINT` and `USDC_MINT` constants.
   - Add `QUOTE_MINT_INFO: Record<string, { ticker, decimals, isStable }>` with entries for both.
   - Append the 5 V2 instruction definitions to the `CLAIM_INSTRUCTIONS` array. Each must map to the same `ClaimType` as the V1 equivalent so downstream handlers stay unified. Use the labels: `'Collect Creator Fee V2 (Pump)'`, `'Distribute Creator Fees V2 (Pump)'`, `'Transfer Creator Fees to Pump V2'`, `'Claim Social Fee PDA V2'`, `'Update Fee Shares V2 (Pump Fees)'`.
   - Add to `FeeClaimEvent`: `quoteMint?: string`, `quoteTicker?: string`, `isStableQuote?: boolean`, `amountQuote?: number`.

2. **RPC monitor / event parser**:
   - Parse `meta.logMessages` for Anchor `Program data:` lines and extract event payloads.
   - For each event discriminator, decode the layout and pull out the amount (in base units of the quote mint) and the trailing `quote_mint` pubkey when present.
   - Resolve quote-mint metadata via `QUOTE_MINT_INFO`, defaulting to wSOL when no `quote_mint` is parseable (preserves V1 behavior).
   - Set `amountQuote = baseUnits / 10^decimals`. Set `amountSol = baseUnits / 1e9` only when the quote is SOL — leave it 0 for USDC (downstream code branches on `isStableQuote`).
   - The lamport-balance-delta fallback must remain for V1 events that don't emit parseable log data.

3. **Telegram formatter**:
   - Render `${amountDisplay} ${ticker}` instead of `${amountSol.toFixed(4)} SOL`. Use 2 decimal places when `isStableQuote` is true, 4 when false.
   - The "Amount:" line in the notification must show USDC for USDC claims.

4. **README**:
   - Add a short note that the bot now decodes V2 USDC claims as of the 2026-05-21 rollout.

5. **Tests** (if a test harness exists):
   - One fixture-driven test parsing a V2 `CollectCreatorFeeEvent` with USDC quote mint and asserting `amountQuote`, `quoteTicker`, `isStableQuote` are populated correctly.
   - One fixture for the V1 path to confirm no regression.
   - If no test infrastructure exists, add a minimal `vitest` or `jest` setup with at least the two parse tests above. Do not skip this — the V1/V2 layout boundary is exactly where regressions hide.

### Non-goals

- Do not change the bot's storage / Telegram-command surface.
- Do not add USDC pricing / oracle lookups — the bot reports the on-chain amount only.
- Do not introduce a dependency on `@pumpkit/claim` — this is a standalone repo and must stay so.

## Execution

1. Clone both repos so you can use pumpkit as the reference:
   ```bash
   gh repo clone nirholas/pumpfun-claims-bot /tmp/pumpfun-claims-bot
   gh repo clone nirholas/pumpkit /tmp/pumpkit-reference
   cd /tmp/pumpfun-claims-bot
   ```

2. Install deps and verify the baseline builds cleanly:
   ```bash
   npm install
   npm run build || npm run typecheck
   ```
   If the baseline is broken, stop and report — don't fix unrelated breakage in this task.

3. Implement the scope above. Cross-reference `/tmp/pumpkit-reference/packages/claim/src/` for the canonical implementation, but **rewrite to match the local repo's conventions** — do not paste pumpkit code verbatim if the local file uses different naming, imports, or formatting.

4. Run typecheck + tests after each meaningful change.

5. Commit as **one commit** on the default branch:
   ```bash
   git -c user.name="nirholas" -c user.email="nirholas@users.noreply.github.com" \
     commit -m "feat: add V2 USDC quote-mint awareness for 2026-05-21 pump.fun rollout"
   ```

   No `Co-Authored-By` trailer.

6. Push:
   ```bash
   git push origin HEAD
   ```

7. Delete this prompt file:
   ```bash
   rm /workspaces/v2-usdc-prompts/03-pumpfun-claims-bot.md
   ```

8. Print the commit hash and a one-line summary.

## Acceptance criteria

- [ ] `npm run build` or `npm run typecheck` succeeds with no errors.
- [ ] All tests pass — including the new V2 parse test.
- [ ] `grep -c "cf118af204221338" src/types.ts` returns > 0.
- [ ] `grep -c "USDC_MINT\|EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" src/types.ts` returns > 0.
- [ ] `grep -ic "quote_mint\|quoteMint" src/` returns > 0.
- [ ] One commit lands on the default branch, authored by `nirholas <nirholas@users.noreply.github.com>`.
- [ ] This prompt file no longer exists.

## If you get blocked

If the repo's layout has drifted so far from the pumpkit reference that the port doesn't make sense (e.g. the bot has moved to a different architecture), stop and report the divergence rather than forcing a fit. Do not commit half-finished discriminator additions to the default branch.
