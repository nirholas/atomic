# Changelog

All notable changes to this project will be documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
