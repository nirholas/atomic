# Changelog

All notable changes to this project will be documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed: `@nirholas/pump-sdk` 2 (Pump program 2.0)
- **Moved from `@nirholas/pump-sdk` ^1.30.0 to ^2.0.0**, which tracks the Pump program 2.0 upgrade, syncs the IDL to the deployed 47-instruction program, and pulls in `@pump-fun/pump-swap-sdk` 1.20. The SDK no longer depends on puppeteer or playwright, so the install is much smaller.
- **Cashback launches are rejected.** The program refuses new cashback coins (`create_v2` error 6082) and the SDK throws `CashbackDeprecatedError`. The launchers no longer pass a cashback flag, and `CASHBACK=true` stops them with a message pointing at holder rewards. Examples 01 and 02, which asked for cashback, now use holder rewards.
- **Bonding-curve reserve fields are renamed** to `virtualQuoteReserves` / `realQuoteReserves`; the old `*SolReserves` names read `undefined`. No script read them; the concept docs that did are updated.

### Added: holder-reward launches
- **`HOLDER_REWARD=true` on `fire-jito.js` and `fire-atomic-create.js`.** Launches a holder-reward coin: the curve's creator becomes `holderRewardsPda(mint)` and pump.fun pays creator fees out to holders. The launcher reads the Pump `Global` account first and stops before signing anything if holder rewards are disabled (error 6084), and logs where fees will accrue.
- [`src/lib/launch-options.js`](src/lib/launch-options.js): the shared, strictly parsed launch-mode options, with unit tests covering flag parsing, the cashback rejection, the Global gate, and the SDK's `create_v2` holder-reward encoding.
- [`docs/concepts/holder-rewards.md`](docs/concepts/holder-rewards.md).

### Fixed
- Examples 03, 04, and 08 called collect and vault helpers the SDK never exported (`PUMP_SDK.fetchBondingCurve`, `collectCoinCreatorFeeInstruction({ mint, user })`, `getCreatorVaultPda`). They now use `OnlinePumpSdk.collectCoinCreatorFeeInstructions` and `getCreatorVaultBalanceBothPrograms`, and refuse holder-reward coins, whose fees the creator cannot collect.
- Example 01 called a nonexistent `createV2Instructions`; it now uses `createV2Instruction`.

### Added
- **Transaction v1 support, on by default.** Every signing path builds a v1 transaction (SIMD-0385): a 4096-byte wire limit instead of 1232, resource limits as message config instead of ComputeBudget instructions, and priority priced as a total lamport fee instead of a per-CU rate. `TRANSACTION_VERSION=0` falls back.
- [`src/lib/transaction.js`](src/lib/transaction.js) — the shared version-aware builder: signs from web3.js instructions, measures the loaded-accounts-data budget from chain, converts a legacy `PRIORITY` price into the same total spend, packs instructions to the version's limit, and simulates or sends raw bytes so v1 works without web3.js serializing it. Covered by unit tests.
- [`src/lib/jito.js`](src/lib/jito.js) — shared Block Engine helpers. Bundles are submitted base64-encoded, because base58 is deprecated and cannot carry a 4096-byte v1 transaction.
- `PRIORITY_FEE_LAMPORTS`, `LOADED_ACCOUNTS_DATA_LIMIT`, and `TRANSACTION_VERSION` environment variables.
- [`SECURITY.md`](SECURITY.md) — keypair handling, leak response, why the atomic / Jito-bundle patterns matter.
- This `CHANGELOG.md`.

### Changed
- `fire-jito.js` and `fire-atomic-create.js` build v1 transactions through the shared builder, report size against the version's limit, and print the measured loaded-accounts budget.
- An oversized version 0 transaction now explains itself instead of surfacing web3.js's `encoding overruns Uint8Array`.

### Prior history

The repo's earlier work — restructure around `src/`, per-script docs under `docs/scripts/`, [`skills/`](skills/) directory, V2 USDC rollout reference under [`docs/v2-usdc-rollout/`](docs/v2-usdc-rollout/), CI workflow, [`LICENSE`](LICENSE), and [`CONTRIBUTING.md`](CONTRIBUTING.md) — landed before this changelog existed. See `git log` for the full picture.
