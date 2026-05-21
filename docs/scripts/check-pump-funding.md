# tools/check-pump-funding.ts

A small CLI wrapper around [`detectSeededByPump`](../../src/lib/funding-source.ts). Answers one question:

> Was this wallet's **first ever inbound SOL transfer** from a known pump.fun address (a fee recipient or the migration authority)?

If yes, the wallet is *seeded by pump.fun* — bootstrapped by the protocol itself rather than by an external party. This is a forensic signal, not a permission check: it doesn't tell you the wallet is *currently* doing anything pump.fun-related, only that pump.fun put the very first lamports there.

- **CLI source:** [`tools/check-pump-funding.ts`](../../tools/check-pump-funding.ts)
- **Library source:** [`src/lib/funding-source.ts`](../../src/lib/funding-source.ts)
- **npm alias:** `npm run check-funding -- <walletAddress> [rpcUrl]`
- **Runtime:** TypeScript via `tsx` (in `devDependencies`).

## When to use this

- You're investigating where a wallet originally got its SOL.
- You want to verify a creator wallet was actually bootstrapped by pump.fun (e.g. confirming a "first creator coin" claim).
- You're building anti-Sybil heuristics and want a clear-cut "this wallet's history begins with pump.fun" signal.

## Usage

```bash
# Via npm
npm run check-funding -- <walletAddress>
npm run check-funding -- <walletAddress> <rpcUrl>

# Direct with tsx
npx tsx tools/check-pump-funding.ts <walletAddress>
RPC_URL=https://rpc.helius.xyz/?api-key=… npx tsx tools/check-pump-funding.ts <walletAddress>
```

The double-dash (`--`) is required for `npm run` to pass positional args to the script. Without it, npm swallows them.

## What it does

1. Reads the wallet address from `argv[2]` and an optional RPC URL from `argv[3]` (falls back to `RPC_URL` env, then mainnet-beta).
2. Calls `detectSeededByPump(wallet, connection)` which:
   - Pages `getSignaturesForAddress` newest → oldest until it has all signatures (up to `maxSignatures = 1000`).
   - Reverses to oldest → newest, then iterates: for each non-errored tx, fetches the parsed tx and checks whether the wallet's lamport balance *increased*. The first such tx is the *first inbound transfer*.
   - For that tx, identifies the sender as the non-wallet account with the largest balance *decrease*.
   - Returns: `seededByPump`, the sender's pubkey, the tx signature, slot, lamports, scan stats.
3. Prints a colored verdict + details.

## Example

```bash
$ npm run check-funding -- 9aPqQ…Yz1k

Wallet: 9aPqQ…Yz1k
RPC:    https://api.mainnet-beta.solana.com
Scanning signatures…

Verdict:           SEEDED BY PUMP.FUN
First funder:      5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD
First funding tx:  3pR…
Slot:              312456789
Amount:            0.050000 SOL
Signatures seen:   148
Done in 4231ms
```

Versus a wallet funded from a regular exchange:

```bash
$ npm run check-funding -- BnDZ…QnG3

Verdict:           NOT seeded by pump.fun
First funder:      8sTGoZmFm2Mu… (some exchange hot wallet)
First funding tx:  4Tq…
Slot:              298311022
Amount:            1.000000 SOL
Signatures seen:   12
Done in 1812ms
```

## Pump sources

The set treated as "pump.fun-origin" is hardcoded in [`src/lib/programs.ts`](../../src/lib/programs.ts):

- `PUMPFUN_FEE_ACCOUNT` — legacy fee recipient (pre-April 28, 2025 upgrade).
- `PUMP_FEE_RECIPIENTS` — 8 fee recipients added in the April 28, 2025 program upgrade.
- `PUMPFUN_MIGRATION_AUTHORITY` — the wallet that handles migration to Raydium when a coin graduates.

If pump.fun adds new fee recipients in a future upgrade, add them to `PUMP_FEE_RECIPIENTS` in that file.

To pass *extra* sources at runtime without editing the library (e.g. for testing), use the library directly rather than the CLI:

```ts
import { Connection } from '@solana/web3.js';
import { detectSeededByPump } from './src/lib/funding-source.js';

const conn = new Connection('…');
const result = await detectSeededByPump(walletAddress, conn, {
  extraPumpSources: ['SomeOtherAddressYouTreatAsPumpOrigin'],
  maxSignatures: 2000,
});
```

## Library API

```ts
function detectSeededByPump(
  wallet: string,
  connection: Connection,
  options?: DetectSeededByPumpOptions
): Promise<FundingSourceResult>;

interface DetectSeededByPumpOptions {
  /** Max signatures to walk back. Default 1000. */
  maxSignatures?: number;
  /** Page size for getSignaturesForAddress. Default & RPC max = 1000. */
  pageSize?: number;
  /** Additional addresses to treat as pump.fun-origin sources. */
  extraPumpSources?: Iterable<string>;
}

interface FundingSourceResult {
  seededByPump: boolean;
  firstFunder: string | null;
  firstFundingSignature: string | null;
  firstFundingSlot: number | null;
  firstFundingLamports: number | null;
  scannedSignatures: number;
  scanTruncated: boolean; // hit maxSignatures cap without finding an inbound
}
```

## Failure modes and edge cases

| Symptom | Cause | What to do |
|---|---|---|
| `Usage: …` printed, exit 1 | No wallet address passed. | Pass one. Remember the `--` for `npm run`. |
| `(scan hit the maxSignatures cap — older history not examined)` | The wallet has > 1000 signatures and none of the first 1000 (newest) showed an inbound SOL transfer — extremely unusual; almost any wallet's earliest signature is its initial funding. The scan went oldest-to-newest after collecting up to `maxSignatures`. | Pass a larger `maxSignatures` via the library API (the CLI doesn't expose this). |
| `Verdict: NOT seeded by pump.fun` for a wallet you know pump.fun created | The wallet was funded *via* pump.fun's UI but the first inbound SOL came from the *user*, not from pump.fun itself. This script only catches the strict definition. | Expected — the strict definition is "the protocol bootstrapped you," not "you used the website." |
| Slow on public RPC | `getSignaturesForAddress` + `getParsedTransaction` are heavyweight. | Use a paid RPC. Helius is particularly fast for this. |
| Returns the wrong "first funder" for complex first txs | The heuristic is "the non-wallet account with the largest lamport decrease." Edge cases: txs that move SOL through PDAs, multi-recipient txs, or where the protocol PDA acts as a passthrough. | If accuracy matters, examine the tx manually (`solscan.io/tx/<sig>`). |

## Test coverage

The library is unit-tested at [`src/lib/funding-source.test.ts`](../../src/lib/funding-source.test.ts) (vitest). The tests use a hand-rolled fake `Connection` to cover:

- A wallet first funded by a pump fee recipient.
- A wallet first funded by a random address.
- Legacy `PUMPFUN_FEE_ACCOUNT` and `PUMPFUN_MIGRATION_AUTHORITY` recognition.
- Walking past outbound + errored txs to find the first inbound.
- Empty-signature edge case.
- `extraPumpSources` option.
- Pagination through multiple signature pages.

Run with `npm test`.

## Notes

- The library has **zero pump-sdk dependency** — it only uses `@solana/web3.js`. That makes it cheap to vendor into other projects (and easy to test).
- "First inbound" specifically means the first tx where the wallet's *lamport balance increased*. Token transfers, NFT mints, and signature-only txs are not considered "funding events."
- The verdict is independent of the wallet's *current* activity. A wallet seeded by pump.fun could now be a perfectly normal trading wallet; the verdict only describes its origin.
