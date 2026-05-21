<!-- Thanks for contributing. Fill in the sections that apply; delete the rest. -->

## What changed

<!-- One or two sentences. What's different after this PR? -->

## Why

<!-- Motivation, related issue, or the specific failure mode this fixes. -->

## Risk surface

Tick what this PR touches:

- [ ] Signs or submits Solana transactions
- [ ] Reads or loads keypairs (env, file, anywhere)
- [ ] Changes a Jito-bundle layout (tx count, ordering, signer set)
- [ ] Changes priority fee, compute unit limit, or Jito tip defaults
- [ ] Changes pump.fun instruction-builder arguments (`createV2`, `collectCoinCreatorFee`, etc.)
- [ ] Adds, removes, or upgrades a dependency
- [ ] Changes the public API of `src/lib/` (used by tools + downstream consumers)
- [ ] Docs / tests / CI only — no runtime change

## How I tested

<!--
  Pick what applies. For anything in the "signs or submits" category, manual
  mainnet/devnet verification is strongly preferred over unit tests alone.
-->

- [ ] `npm test` passes locally
- [ ] `npm run typecheck` passes locally (if applicable)
- [ ] Dry-run on mainnet-beta with `DRY_RUN=1` (where supported)
- [ ] Live run on a throwaway wallet — tx signature(s): `…`
- [ ] N/A (docs / config only)

## Secrets checklist

Confirm before requesting review:

- [ ] No base58 secrets, keypair JSON arrays, mnemonics, or seed phrases anywhere in the diff (including comments, test fixtures, sample logs)
- [ ] No RPC URLs containing live `api-key=` values
- [ ] No wallet pubkeys you wouldn't want associated with your GitHub identity (see [SECURITY.md](../SECURITY.md))
- [ ] If a keypair was used during testing, it has been rotated or burned

## Follow-ups

<!-- Anything intentionally left out of scope. Link issues if filed. -->
