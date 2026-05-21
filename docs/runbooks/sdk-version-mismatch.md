# Runbook: SDK version mismatch / `InvalidInstructionData`

The pump.fun program upgrades occasionally. When it does, the SDK's account list or instruction discriminator becomes stale. Your `buy`, `sell`, or `createV2` reverts with `InvalidInstructionData` or `AccountNotFound` even though everything looks right.

This runbook is the diagnostic and recovery flow.

---

## Symptom

You see something like:

```
Error: failed to send transaction: Transaction simulation failed:
  Error processing Instruction 2: custom program error: 0x0
  Program log: instruction data: [array of bytes]
  Program log: AnchorError occurred. Error Code: InstructionDidNotDeserialize. Error Number: 102.
```

Or:

```
Error: Account NotFound: <some-pubkey>
```

The "failing" ix didn't fail last week. Nothing in your code changed.

---

## Quick diagnosis

### 1. Is the program ID still the same?

```bash
solana account 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P --output json | jq .account.executable
```

Should return `true`. If `false` or "Account not found", pump.fun has redeployed to a different address (very rare but has happened). Update `PUMP_PROGRAM_ID` in [`src/lib/programs.ts`](../../src/lib/programs.ts).

### 2. When was the pump.fun program last upgraded?

```bash
solana account 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P --output json | jq .account.data
```

The upgrade authority publishes a new program version with each release. You can also check Solscan's "Recent Transactions" tab on the program account to see the last `Upgrade` instruction.

If the last upgrade is within 24 hours of your error: you're hitting a new program version. Continue to step 3.

### 3. What's the SDK's expected discriminator vs. the program's actual?

The Anchor discriminator is the first 8 bytes of an instruction's data, derived from `sha256("global:" + instruction_name)[:8]`. If the SDK is calling an old instruction name and the program has been renamed, the discriminator mismatches and the program rejects with `InstructionDidNotDeserialize`.

Check your SDK version:

```bash
npm ls @nirholas/pump-sdk
```

If outdated, bump:

```bash
npm i @nirholas/pump-sdk@latest
```

Then re-run the operation. If the operation succeeds, the SDK had the fix.

### 4. Is the account list mismatched?

If the SDK is current but you still get `AccountNotFound` or "account missing": the program may require a new account that's not in your tx. Look at the inner-instruction logs to find which account index is missing:

```bash
solana confirm -v <failing-sig>
```

The verbose output lists every account the program tried to read. Cross-reference against your tx's account list.

---

## Common scenarios

### Scenario A: pump.fun adds a new fee recipient

When pump.fun adds a new fee account (e.g. "buyback fee recipient"), the `buy` and `sell` instructions start requiring it in the account list. Old SDK versions don't include it.

**Symptom:** `buy` reverts with `AccountNotFound` or `AccountNotProvided`.

**Fix:**
1. Bump `@nirholas/pump-sdk` to the version that includes the new fee recipient.
2. If no SDK version is available yet, **route the buy through Jupiter** via [`buy-jito.js`](../scripts/buy-jito.md). Jupiter's pump.fun adapter typically updates within hours of a program change.

This is *the* most common SDK-mismatch scenario. The toolkit's `buy-jito.js` exists primarily for this reason.

### Scenario B: A new instruction is added that the SDK doesn't know about

When pump.fun adds an instruction (e.g. `createV3`), old code that calls `createV2` still works — `createV2` is not removed, just deprecated. New code that wants the new ix needs the new SDK.

**Symptom:** `createV2` continues to work, but you see other developers using `createV3` and want to upgrade.

**Fix:** Bump the SDK. The deprecation period for pump.fun ixs is typically 3+ months — you have time.

### Scenario C: An existing instruction's parameters change

Less common, but possible: pump.fun changes the data layout of an instruction (e.g. adds a `creator` parameter to `createV2`).

**Symptom:** `InstructionDidNotDeserialize` even though the discriminator matches.

**Fix:** Bump the SDK. If no SDK version supports the new layout, you're blocked — wait for the SDK, or read the new layout from pump.fun's IDL (published on chain via the Anchor program) and patch manually.

### Scenario D: V1 → V2 quote-mint changes

The V2 USDC quote-mint upgrade (rolled out 2026-05-21) changed how the bonding curve handles non-SOL quote assets. Old code that assumes SOL quote breaks on USDC-quote coins.

**Symptom:** Trades on certain coins revert with `InvalidQuoteMint` or similar.

**Fix:** See the full reference at [`docs/v2-usdc-rollout/`](../v2-usdc-rollout/). The key change: every trade ix now takes a `quoteMint` account; old SDKs hard-coded SOL.

### Scenario E: Migration authority changes

The migration authority can be rotated (e.g. for security or contractual reasons). The SDK hard-codes the migration authority pubkey in [`src/lib/programs.ts`](../../src/lib/programs.ts) (`PUMPFUN_MIGRATION_AUTHORITY`).

**Symptom:** [`tools/check-pump-funding.ts`](../../tools/check-pump-funding.ts) starts misclassifying migrated-wallet funding as "not pump-seeded."

**Fix:** Watch pump.fun's announcement channels for migration authority rotation. Update `PUMPFUN_MIGRATION_AUTHORITY`. Add the *new* authority to the wallet-detection logic but also keep the *old* — historical wallets were seeded by the old authority and you want them still classified.

---

## Recovery workflow

When you confirm it's an SDK mismatch (not your own bug):

1. **Pause the affected scripts.** Don't keep retrying — failed bundles cost tips even when they revert.
2. **Bump the SDK.** `npm i @nirholas/pump-sdk@latest` and check the release notes for the affected ix.
3. **Sim before resubmitting.** `simulateTransaction` will catch the same error pre-flight without paying a tip.
4. **If no SDK version yet exists for the new program version:**
   - For buys, switch to `buy-jito.js` (Jupiter route).
   - For sells, also via Jupiter.
   - For `createV2`, wait. Don't try to launch with a broken SDK — you'll either fail (wasted tip) or worse, succeed in a partial state.

---

## Watching for SDK staleness proactively

The toolkit pins `@nirholas/pump-sdk` to a `^1.33.0` range in [`package.json`](../../package.json). That accepts minor updates automatically; major version bumps require an explicit bump.

To stay current:

1. Watch [the SDK's releases page](https://github.com/anthropics/pump-sdk/releases) (subscribe to release notifications).
2. Run `npm outdated @nirholas/pump-sdk` weekly.
3. Test SDK upgrades on devnet first, if pump.fun has a devnet deployment of the new version.

You don't have to be on the latest SDK at all times. But you should be no more than one minor version behind, and you should be aware *when* you're behind.

---

## Reading the on-chain IDL

In a pinch, you can read pump.fun's Anchor IDL directly from chain:

```bash
anchor idl fetch 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P --provider.cluster mainnet
```

This dumps the canonical IDL. Compare against what the SDK exports to find diffs. Not glamorous, but it's the ground truth.

---

## Related

- [`docs/pump-fun-protocol.md`](../pump-fun-protocol.md) — program IDs, accounts, instructions reference
- [`docs/v2-usdc-rollout/`](../v2-usdc-rollout/) — the most recent program upgrade
- [`docs/scripts/buy-jito.md`](../scripts/buy-jito.md) — Jupiter fallback for buys
- [`@nirholas/pump-sdk` releases](https://github.com/anthropics/pump-sdk/releases) — upstream version history
