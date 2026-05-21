# Task: Sync `@nirholas/pump-swap-sdk` to upstream V2 USDC rollout

## Context

pump.fun is enabling **USDC as a quote mint** on 2026-05-21. The PumpSwap AMM program adds a new instruction `transfer_creator_fees_to_pump_v2` (discriminator `01214eb921432c5c`) and threads `quote_mint` through the AMM trade paths so pools can be paired against either wSOL or USDC.

The TypeScript SDK at `nirholas/pump-swap-sdk` is at v1.14.0 and is a mirror of upstream `@pump-fun/pump-swap-sdk`. The upstream release that includes V2 support is `@pump-fun/pump-swap-sdk@1.15.0`. The mirror needs to catch up.

USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
wSOL mint: `So11111111111111111111111111111111111111112`

## What to deliver

A v1.15.0 release of `@nirholas/pump-swap-sdk` that mirrors the upstream `@pump-fun/pump-swap-sdk@1.15.0` V2 USDC additions, while preserving any nirholas-specific additions already in the fork.

### Mandatory scope

1. **Diff the fork against upstream.** Fetch the upstream tarball:
   ```bash
   npm pack @pump-fun/pump-swap-sdk@1.15.0
   ```
   Extract it and diff against the current repo. Identify which files changed between v1.14.0 and v1.15.0 upstream.

2. **Apply the upstream V2 changes**, specifically:
   - `src/idl/pump_amm.json` — refresh to the v1.15.0 IDL. Confirm `transfer_creator_fees_to_pump_v2` (disc `01214eb921432c5c`) appears.
   - Any new V2 instruction builders in `src/sdk/` (`ammBuyV2Instruction`, `ammSellV2Instruction`, etc. — names must match upstream).
   - Any `quoteMint` parameter additions to existing builders.
   - Update `OnlinePumpAmmSdk` wrappers to mirror upstream.
   - Sync any new exports in `src/index.ts`.

3. **Preserve nirholas-specific code.** The fork has added utilities/exports beyond upstream. Do not remove them. When upstream and fork conflict on the same file, hand-merge — upstream wins for IDL and core instruction builders, fork wins for additive utilities.

4. **Tests.** Re-run the upstream test suite locally after merge. Add one test that builds an `ammBuyV2` instruction with `quoteMint = USDC_MINT` and asserts the account list contains a USDC ATA. All existing fork-specific tests must continue to pass.

5. **`package.json`**: Bump `version` to `1.15.0` to match upstream. Update the `description` if needed to mention V2.

6. **CHANGELOG.md**: Add `## [1.15.0] — 2026-05-21` entry summarizing the V2 USDC sync. Cite the upstream version this mirrors.

### Non-goals

- Do not refactor the fork's directory structure or rename files beyond what upstream did.
- Do not publish to npm.
- Do not bump `@solana/web3.js` or other peer deps unless upstream did.

## Execution

1. Clone the repo:
   ```bash
   gh repo clone nirholas/pump-swap-sdk /tmp/pump-swap-sdk
   cd /tmp/pump-swap-sdk
   ```

2. Install deps:
   ```bash
   npm install
   ```

3. Pull upstream:
   ```bash
   mkdir /tmp/upstream-pump-swap && cd /tmp/upstream-pump-swap
   npm pack @pump-fun/pump-swap-sdk@1.15.0
   tar xf pump-fun-pump-swap-sdk-1.15.0.tgz
   ```

4. Apply the diffs. Re-run `npm run build && npm test` after each significant change so you catch breaks early.

5. When the build and tests pass, commit as **one commit** on the default branch:
   ```bash
   git -c user.name="nirholas" -c user.email="nirholas@users.noreply.github.com" \
     commit -m "feat(sdk): sync to @pump-fun/pump-swap-sdk@1.15.0 (V2 USDC quote-mint support)"
   ```

   No `Co-Authored-By` trailer.

6. Push to the default branch:
   ```bash
   git push origin HEAD
   ```

7. Delete this prompt file:
   ```bash
   rm /workspaces/v2-usdc-prompts/02-pump-swap-sdk.md
   ```

8. Print the commit hash, the new package version, and a one-line summary of the upstream files synced.

## Acceptance criteria

- [ ] `npm run build` succeeds.
- [ ] `npm test` passes — including the new USDC ATA assertion.
- [ ] `grep -c "01214eb921432c5c" src/idl/pump_amm.json` returns > 0 (transfer_creator_fees_to_pump_v2 disc is in the IDL).
- [ ] `package.json` version is `1.15.0`.
- [ ] One commit lands on the default branch, authored by `nirholas <nirholas@users.noreply.github.com>`.
- [ ] This prompt file no longer exists.

## If you get blocked

If the upstream package is not yet published to npm (404 on `npm pack @pump-fun/pump-swap-sdk@1.15.0`), check the upstream GitHub repo at `https://github.com/pump-fun/pump-swap-sdk` for the matching tag. If neither npm nor GitHub has v1.15.0 yet, stop, do not invent the changes, and report that the upstream release has not landed. The fork should wait, not fabricate the V2 builders.
