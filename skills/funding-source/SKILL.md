---
name: atomic-funding-source
description: Use when the user wants to determine whether a Solana wallet was "seeded by pump.fun" — i.e. its first inbound SOL transfer came from a known pump.fun fee recipient or migration authority. Useful for wallet provenance audits, distinguishing genuine pump.fun-originated activity from cosplay, or detecting if a creator wallet was bootstrapped by the protocol itself. Triggers on "was this wallet funded by pump", "check-pump-funding", "wallet provenance", "detect pump-seeded wallet", "is this a pump.fun wallet", or any wallet-origin audit task.
---

# atomic-funding-source — check whether a wallet was seeded by pump.fun

`tools/check-pump-funding.ts` walks a wallet's signatures backwards in time, finds the first inbound SOL transfer, and reports whether the sender matches a **known pump.fun source** (the fee-recipient pubkeys or the migration authority).

The shared helper `detectSeededByPump()` lives in `src/lib/funding-source.ts` and is the canonical implementation.

## When to invoke

Pick this skill when the user wants to:

- **Audit a creator wallet's provenance**: did pump.fun's own infrastructure fund it, or was it bootstrapped externally?
- **Cluster wallets** suspected of being part of a pump.fun-coordinated set.
- **Verify a claim** that "wallet X is the official pump.fun deployer / treasury / etc." — most such claims are false.
- **Investigate a suspicious wallet** that shows up in fee-distribution events.

Skip this skill for:

- Checking a wallet's *current balance* → use `tools/check-balances.ts` instead.
- Tx-history exploration beyond first-inbound → use Solscan or Helius RPC directly.
- Determining if a wallet *traded* on pump.fun (any wallet that bought a pump coin satisfies this trivially).

## Definitions

A wallet is "seeded by pump.fun" iff:

- Its **first inbound SOL transfer** came from one of:
  - A known pump.fun fee recipient (the 8 addresses in `PUMP_FEE_RECIPIENTS` + the legacy `PUMPFUN_FEE_ACCOUNT`).
  - The migration authority `39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg`.

This is a **strict** definition. A wallet funded by an exchange withdrawal that *then* received pump.fun fees later does **not** count.

## Required environment

Optional:

```bash
RPC_URL=https://api.mainnet-beta.solana.com   # paid provider strongly recommended
```

No signing keys needed. Read-only operation.

## Usage

```bash
npm run check-funding -- <wallet-pubkey>
# or
tsx tools/check-pump-funding.ts <wallet-pubkey>

# With options:
tsx tools/check-pump-funding.ts <wallet-pubkey> --max-signatures 2000
```

Output (JSON):

```json
{
  "seededByPump": true,
  "firstFunder": "39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg",
  "firstFundingSignature": "5xK...sig",
  "firstFundingSlot": 250123456,
  "firstFundingLamports": 50000000,
  "scannedSignatures": 142,
  "scanTruncated": false
}
```

Key fields:

- **`seededByPump`**: the verdict. `true` only if the first-funder pubkey is in the known-pump-source set.
- **`firstFunder`**: the actual first-funder pubkey, regardless of `seededByPump`. Useful for tracing non-pump-funded wallets too.
- **`scanTruncated`**: `true` if the scan hit `maxSignatures` without finding an inbound transfer. Result is then uncertain — re-run with a larger `--max-signatures`.

## Failure modes and fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `scanTruncated: true` and `seededByPump: false` | Wallet has too much activity for the default 1000-signature scan | Re-run with `--max-signatures 5000` or higher. |
| RPC `429 Too Many Requests` | Public mainnet RPC rate-limit | Use a paid provider (Helius free tier is enough for moderate use). |
| `"Wallet has no signatures"` | Wallet is empty / never used | The verdict is trivially `seededByPump: false`. |
| `firstFunder` is a wallet you don't recognize | Wallet was funded by a third party — exchange, OTC, etc. | This is the most common outcome. Most wallets are not pump-seeded. |

## Worked example — auditing a suspected pump.fun "treasury"

```bash
$ npm run check-funding -- 5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD
{
  "seededByPump": false,
  "firstFunder": "Some...Funder",
  "firstFundingSignature": "...",
  "scannedSignatures": 1000,
  "scanTruncated": true
}
```

This wallet's first inbound funding wasn't from a pump.fun source within the first 1000 signatures of history. Re-run with a deeper scan if you suspect very old wallets:

```bash
$ npm run check-funding -- 5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD -- --max-signatures 5000
```

## How `detectSeededByPump` works (internal)

The library function in `src/lib/funding-source.ts`:

1. Calls `getSignaturesForAddress(wallet, { limit: pageSize })` repeatedly, walking back through history.
2. For each signature, fetches the parsed tx via `getTransaction`.
3. Inspects the tx for an inbound SOL transfer to `wallet` (system-program `transfer` instructions where `wallet` is the destination).
4. The **earliest** such transfer's source is the "first funder".
5. Returns whether that source is in `PUMP_FEE_RECIPIENT_SET ∪ { PUMPFUN_MIGRATION_AUTHORITY }`.

It caps at `maxSignatures` to bound RPC cost. Set higher for thoroughly-aged wallets.

## Reference

- CLI: [`tools/check-pump-funding.ts`](../../tools/check-pump-funding.ts)
- Library: [`src/lib/funding-source.ts`](../../src/lib/funding-source.ts)
- Per-tool docs: [`docs/scripts/check-pump-funding.md`](../../docs/scripts/check-pump-funding.md)
- Constants source: [`src/lib/programs.ts`](../../src/lib/programs.ts) (`PUMP_FEE_RECIPIENTS`, `PUMPFUN_MIGRATION_AUTHORITY`)
