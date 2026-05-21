# Task: Add pump.fun V2 USDC quote-mint support to `@nirholas/pump-sdk`

## Context

pump.fun is rolling out **V2 instructions on 2026-05-21** that allow coins to be paired against **USDC** in addition to SOL. The official protocol changes:

- New V2 instructions on the Pump bonding-curve program: `buy_v2`, `sell_v2`, `collect_creator_fee_v2`, `distribute_creator_fees_v2`, plus `transfer_creator_fees_to_pump_v2` on the PumpSwap AMM, and `claim_social_fee_pda_v2` / `update_fee_shares_v2` on the Pump fees program.
- Every V2 instruction takes a **`quote_mint: Pubkey`** argument. For SOL-paired coins, callers pass wrapped SOL (`So11111111111111111111111111111111111111112`). For USDC-paired coins they pass USDC (`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`).
- V2 events have a trailing `quote_mint` pubkey appended to their record layouts.
- The current installed SDK (`@nirholas/pump-sdk@1.32.0`, repo `nirholas/pump-fun-sdk`) only covers the 2026-04-28 fee-recipient upgrade. It has `createV2` but no `buyV2`/`sellV2` and `buyInstructions`/`sellInstructions` don't accept a `quoteMint` argument.

The Rust counterpart **already implements this** — use it as the canonical reference: <https://github.com/nirholas/pumpfun-rust-client>, especially `src/sdk/pump_v2.rs`, `examples/buy_v2.rs`, `examples/sell_v2.rs`, `tests/v2_custom_quote_mint.rs`, and `idls/pump.json`.

Official protocol docs to consult while you work:

- <https://github.com/pump-fun/pump-public-docs>
- <https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/COLLECT_CREATOR_FEE.md>
- <https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md>

## What to deliver

A new `@nirholas/pump-sdk` release that lets TypeScript callers build and submit V2 buy/sell/claim transactions for both SOL- and USDC-paired coins.

### Mandatory scope

1. **Refresh the IDL** in `src/idl/pump.json` (and `pump_amm.json`, `pump_fees.json` if affected). Mirror the on-chain program IDL exactly. Re-derive the discriminators from the new IDL — do not hand-edit them. The key V2 disc hexes you should see appear are: `cf118af204221338` (collect_creator_fee_v2), `ffcb134ff444089f` (distribute_creator_fees_v2), `01214eb921432c5c` (transfer_creator_fees_to_pump_v2), `114df0863abc3595` (claim_social_fee_pda_v2), `6ffb31064e4e6a12` (update_fee_shares_v2). Confirm `buy_v2` and `sell_v2` are present in the bonding-curve IDL.
2. **Add `PUMP_SDK.buyV2Instructions`, `PUMP_SDK.sellV2Instructions`, `PUMP_SDK.buyV2ExactSolInInstruction`** (and any V2 AMM equivalents like `ammBuyV2Instruction` / `ammSellV2Instruction` if the program exposes them). Each must take an optional `quoteMint: PublicKey` parameter that **defaults to wrapped SOL** to preserve V1 ergonomics. When a non-SOL quote mint is passed, the builder must:
   - Derive the bonding-curve / pool ATAs against the quote mint (not assume wSOL).
   - Pass `quote_mint` as the on-chain argument.
   - Still append the 8-fee-recipient mutable trailing accounts from the 2026-04-28 upgrade.
   Use `pickBreakingFeeRecipient()` (already in v1.32.0) — do not regress that work.
3. **Add `OnlinePumpSdk` wrappers** (`buyV2Instructions`, `sellV2Instructions`) that fetch global / bonding-curve state and delegate, matching the existing v1 wrapper pattern.
4. **Add V2 claim instruction builders**: `collectCreatorFeeV2Instruction`, `distributeCreatorFeesV2Instruction`, `transferCreatorFeesToPumpV2Instruction`, `claimSocialFeePdaV2Instruction`, `updateFeeSharesV2Instruction`. Each accepts the same `quote_mint` argument.
5. **Quote-mint-aware event parsing**. Any existing event decoder (`pump-events.ts` or similar) must read the trailing `quote_mint` pubkey on V2 event layouts and expose it on the decoded type. Layouts:
   - `CollectCreatorFeeEvent` V2: `disc(8) + ts(8) + creator(32) + creator_fee(u64) + quote_mint(32)`
   - `DistributeCreatorFeesEvent` V2: `... + distributed(u64) + quote_mint(32)` (after the shareholder vec)
   - `SocialFeePdaClaimed` V2 trailing: `recipient_balance_before(8) + recipient_balance_after(8) + quote_mint(32) + lifetime_stable_claimed(u64)`
6. **Export the new entrypoints** from `src/index.ts` and from the type definitions.
7. **Add USDC mint constant**: `export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')` alongside the existing wSOL/NATIVE_MINT constant.
8. **Tests** in `src/__tests__/`:
   - Pin V2 account counts and trailing-account shapes for buy_v2/sell_v2 with both SOL and USDC quote mints.
   - One end-to-end builder test that builds a USDC-quote buy and asserts the `quote_mint` argument bytes are present in the instruction data at the right offset.
   - Round-trip parse of a V2 `CollectCreatorFeeEvent` with USDC quote mint.
   - All existing jest suites must still pass.
9. **Docs**:
   - Add a `docs/MIGRATION.md` section titled "Upgrading to V1.33.0 — V2 quote-mint support" with a code diff showing how a caller migrates from `buyInstructions` to `buyV2Instructions`.
   - Add `docs/pump-public-docs/V2_USDC_QUOTE.md` summarizing the protocol change (you can paraphrase from the official `pump-public-docs` repo).
10. **CHANGELOG.md**: Add a `## [1.33.0] — 2026-05-21` section above the existing `1.32.0` entry. Mention the V2 rollout, the new public exports, the new IDL discriminators, and explicitly note that this is the breaking on-chain release.
11. **`package.json`**: Bump `version` to `1.33.0`. Do not change the publishConfig or peerDependencies.

### Non-goals

- Do not change any V1 instruction builder signatures. Existing callers passing only SOL must continue to compile and behave identically.
- Do not bump `@solana/web3.js` or other deps unless an upstream IDL parser issue forces it.
- Do not publish to npm — that is a separate manual step.

## Execution

1. Clone the repo:
   ```bash
   gh repo clone nirholas/pump-fun-sdk /tmp/pump-fun-sdk
   cd /tmp/pump-fun-sdk
   ```
   Verify you're on the default branch and the tree is clean.

2. Install deps:
   ```bash
   npm install
   ```

3. Implement the scope above. Run `npm run build && npm test` continuously. Do not commit anything until **all tests pass and the build is clean**.

4. When all tests pass, commit the work as **two commits** on the default branch:
   - First commit: `feat(sdk): add V2 USDC quote-mint support for buy/sell/claim instructions` — the code, IDL, and exports.
   - Second commit: `docs(sdk): document V1.33.0 V2 USDC migration` — CHANGELOG + MIGRATION + V2_USDC_QUOTE docs + version bump.

   Each commit must be authored as **nirholas** with the noreply email:
   ```bash
   git -c user.name="nirholas" -c user.email="nirholas@users.noreply.github.com" \
     commit -m "feat(sdk): add V2 USDC quote-mint support for buy/sell/claim instructions"
   ```

   The commit message body should describe the scope. Do **not** include any `Co-Authored-By` trailer.

5. Push directly to the default branch:
   ```bash
   git push origin HEAD
   ```

6. Delete this prompt file:
   ```bash
   rm /workspaces/v2-usdc-prompts/01-pump-fun-sdk.md
   ```

7. Print the two commit hashes and the SDK version in the final response.

## Acceptance criteria

- [ ] `npm run build` succeeds with no TS errors.
- [ ] `npm test` passes — both existing suites and the new V2 tests.
- [ ] `grep -c "buy_v2" src/idl/pump.json` returns > 0.
- [ ] `grep -c "buyV2Instructions" src/index.ts` returns > 0.
- [ ] `grep -c "USDC_MINT" src/index.ts` returns > 0.
- [ ] `package.json` version is `1.33.0`.
- [ ] Two commits land on the default branch, both authored by `nirholas <nirholas@users.noreply.github.com>`.
- [ ] `git log -2 --format='%an <%ae>'` shows the right author on both commits.
- [ ] This prompt file no longer exists.

## If you get blocked

If you cannot find authoritative V2 account layouts or argument orderings, **do not invent them**. Stop, push a WIP branch named `wip/v2-usdc-rollout`, leave a note at the top of `CHANGELOG.md` describing what's missing, and report the blocker. Do not push half-implemented builders to the default branch.
