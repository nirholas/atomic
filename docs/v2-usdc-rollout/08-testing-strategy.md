# Testing Strategy for V2 USDC Code

What to test, what to fixture, and where regressions are most likely to hide.

## The three test surfaces

Every V2-aware codebase has three places that need test coverage. Skipping any of them means hidden bugs.

### Surface 1 — Discriminator coverage

Goal: the V1 → V2 instruction mapping table is complete and stable.

```ts
import { CLAIM_INSTRUCTIONS } from '../types';

describe('CLAIM_INSTRUCTIONS table', () => {
    it('includes both V1 and V2 entries for collect_creator_fee', () => {
        const v1 = CLAIM_INSTRUCTIONS.find(d => d.discriminator === '1416567bc61cdb84');
        const v2 = CLAIM_INSTRUCTIONS.find(d => d.discriminator === 'cf118af204221338');
        expect(v1?.claimType).toBe('collect_creator_fee');
        expect(v2?.claimType).toBe('collect_creator_fee'); // must map to same ClaimType
    });

    it('has exactly 5 V2 discriminators', () => {
        const v2Discs = [
            'cf118af204221338',
            'ffcb134ff444089f',
            '01214eb921432c5c',
            '114df0863abc3595',
            '6ffb31064e4e6a12',
        ];
        for (const d of v2Discs) {
            expect(CLAIM_INSTRUCTIONS.some(e => e.discriminator === d)).toBe(true);
        }
    });

    it('every V2 entry maps to a valid V1 ClaimType', () => {
        const v2 = CLAIM_INSTRUCTIONS.filter(d => d.label.includes('V2'));
        const validTypes = new Set(['collect_creator_fee', 'distribute_creator_fees',
            'transfer_creator_fees_to_pump', 'claim_social_fee_pda']);
        for (const e of v2) expect(validTypes.has(e.claimType)).toBe(true);
    });
});
```

### Surface 2 — Event layout parsing

Goal: V1 and V2 records of the same event are both parsed correctly.

Capture **real** base64 `Program data:` payloads from actual transactions, both pre-rollout (V1) and post-rollout (V2 SOL pair and V2 USDC pair). Store them as fixtures:

```
__fixtures__/events/
├── collect-creator-fee-v1-sol.b64
├── collect-creator-fee-v2-sol.b64
├── collect-creator-fee-v2-usdc.b64
├── distribute-creator-fees-v1-sol.b64
├── distribute-creator-fees-v2-sol-3-shareholders.b64
├── distribute-creator-fees-v2-usdc-2-shareholders.b64
├── social-fee-pda-v1.b64
├── social-fee-pda-v2-sol.b64
└── social-fee-pda-v2-usdc.b64
```

Then the test:

```ts
describe('parseClaimEventFromLogs', () => {
    it('parses V1 collect_creator_fee — defaults quote to SOL', () => {
        const b64 = readFixture('collect-creator-fee-v1-sol.b64');
        const log = `Program data: ${b64}`;
        const r = parseClaimEventFromLogs([log], 'collect_creator_fee');
        expect(r).toEqual({ amount: 50_000_000 });
        expect(r?.quoteMint).toBeUndefined(); // V1 has no trailing mint
    });

    it('parses V2 collect_creator_fee with USDC quote', () => {
        const b64 = readFixture('collect-creator-fee-v2-usdc.b64');
        const log = `Program data: ${b64}`;
        const r = parseClaimEventFromLogs([log], 'collect_creator_fee');
        expect(r?.amount).toBe(5_000_000);  // micro-USDC
        expect(r?.quoteMint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    });

    it('parses V2 distribute_creator_fees through the shareholder vec', () => {
        const b64 = readFixture('distribute-creator-fees-v2-sol-3-shareholders.b64');
        const log = `Program data: ${b64}`;
        const r = parseClaimEventFromLogs([log], 'distribute_creator_fees');
        // The point of this test: verify we walk the vec, not read from end
        expect(r?.amount).toBeGreaterThan(0);
        expect(r?.quoteMint).toBe('So11111111111111111111111111111111111111112');
    });
});
```

**Why fixtures over synthetic byte arrays:** real on-chain payloads include real-world edge cases — empty shareholder vecs, oddly-long user_id strings, max-value u64 amounts, etc. Synthetic fixtures miss these.

**How to capture a fixture:** grab any V2 transaction signature once they exist post-rollout, fetch via `getTransaction`, extract the `Program data:` lines, base64-decode-and-re-encode to normalize, save the bytes. Document the source signature in a sibling `.md` so future maintainers can verify.

### Surface 3 — End-to-end pipeline

Goal: a complete fixture flows through the parser, resolver, formatter, and rendering layers and produces the right output.

```ts
describe('end-to-end claim render', () => {
    it('USDC claim renders as "5.00 USDC"', async () => {
        // Build a fake getTransaction response with a real V2 USDC fixture
        const fakeTx = makeFakeTx({
            programData: readFixture('collect-creator-fee-v2-usdc.b64'),
            instruction: 'cf118af204221338',
        });
        const event = monitor.extractClaim('fake-sig', fakeTx, /* def */, /* keys */);

        expect(event?.amountQuote).toBe(5.0);
        expect(event?.quoteTicker).toBe('USDC');
        expect(event?.isStableQuote).toBe(true);
        expect(event?.amountSol).toBe(0); // explicitly zeroed for non-SOL quote

        // Now format it
        const html = formatClaimNotification(event!, /* item */, null);
        expect(html).toContain('5.00 USDC');
        expect(html).not.toContain('SOL');
    });

    it('SOL claim still renders as "X.XXXX SOL"', async () => {
        const fakeTx = makeFakeTx({
            programData: readFixture('collect-creator-fee-v1-sol.b64'),
            instruction: '1416567bc61cdb84',
        });
        const event = monitor.extractClaim('fake-sig', fakeTx, /* def */, /* keys */);

        expect(event?.amountSol).toBeCloseTo(0.05, 4);
        expect(event?.quoteTicker).toBe('SOL'); // resolved via fallback
    });
});
```

The "USDC does **not** contain 'SOL'" assertion is the regression guard — it catches the most common bug class (a stray hardcoded "SOL" in a formatter).

## Specific regression tests to keep forever

These are bugs that have happened or would happen on a careless V2 migration. Pin them:

1. **`formatSol` is not used for USDC amounts.** Grep test:

   ```ts
   it('claim formatter does not call formatSol for USDC quote', () => {
       const spy = vi.spyOn(formatters, 'formatSol');
       formatClaimNotification(usdcEvent, item, null);
       expect(spy).not.toHaveBeenCalled();
   });
   ```

2. **`distributed` is not read from the end of the event buffer.** Add a V2 fixture with the shortest possible shareholder vec (1 shareholder) and another with the longest reasonable (10+ shareholders); both must parse the same `distributed` value if the buffer is built from the same template.

3. **Lamport balance-delta fallback still works for V1 events without parseable logs.** Sometimes RPC providers truncate logs; the fallback must catch these. Test by feeding a fixture with missing `Program data:` lines and a real balance delta.

4. **`amountSol === 0` for USDC events.** Otherwise downstream legacy code paths render insanity.

   ```ts
   expect(usdcEvent.amountSol).toBe(0);
   expect(usdcEvent.amountQuote).toBeGreaterThan(0);
   ```

5. **`quoteMint` defaults to wSOL when absent.** Otherwise V1 events render as "undefined" or break the formatter.

## Build-instruction test patterns (for SDK code)

When you're testing instruction builders (not event parsers), pin the **account count** and **trailing-account shapes** that the on-chain program enforces. This is what `pump-fun-sdk@1.32.0` did for the Apr-28 fee-recipient upgrade and it's the right pattern for V2:

```ts
describe('PUMP_SDK.buyV2Instructions', () => {
    it('produces an instruction with exactly 18 accounts for SOL quote', async () => {
        const ixs = await PUMP_SDK.buyV2Instructions({ ...args, quoteMint: WSOL_MINT });
        const buyIx = ixs.find(i => discOf(i.data) === 'buy_v2_disc_here');
        expect(buyIx?.keys.length).toBe(18);
    });

    it('uses USDC ATAs when quoteMint is USDC', async () => {
        const ixs = await PUMP_SDK.buyV2Instructions({ ...args, quoteMint: USDC_MINT });
        const buyIx = ixs.find(i => discOf(i.data) === 'buy_v2_disc_here');
        const usdcAta = await getAssociatedTokenAddress(new PublicKey(USDC_MINT), wallet.publicKey);
        expect(buyIx?.keys.some(k => k.pubkey.equals(usdcAta))).toBe(true);
    });

    it('encodes quote_mint argument bytes correctly', async () => {
        const ixs = await PUMP_SDK.buyV2Instructions({ ...args, quoteMint: USDC_MINT });
        const buyIx = ixs.find(i => discOf(i.data) === 'buy_v2_disc_here');
        const usdcMintBytes = new PublicKey(USDC_MINT).toBytes();
        const data = Buffer.from(buyIx!.data);
        // Confirm USDC mint bytes appear at the documented offset
        expect(data.subarray(N, N + 32).equals(usdcMintBytes)).toBe(true);
    });
});
```

The third assertion is the one that catches misaligned argument layouts before they hit the chain.

## What not to bother testing

- **The Solana RPC client itself.** Trust `@solana/web3.js`.
- **Anchor's IDL parser.** Trust `@coral-xyz/anchor`.
- **The chain returning the right value.** That's an integration concern, not a unit one. Run a devnet smoke test before each release if you want that confidence, but don't bloat the unit suite.
- **Float precision on amounts under 2⁵³.** `Number(BigInt(...))` is exact in that range. Only worry if you handle balances above ~9 quadrillion base units.

## Cross-package test sharing

The fixtures in `__fixtures__/events/` should be **shared** across packages — the same V2 USDC collect-creator-fee record should test parsers in `pumpkit/packages/channel`, `pumpkit/packages/claim`, and `pumpfun-claims-bot`. Either:

- Vendor the fixtures into each package, with a `FIXTURES.md` documenting the source, OR
- Ship them as a tiny `@nirholas/pump-test-fixtures` package and depend on it.

The vendor approach is simpler at small scale; the package approach pays off when you have 4+ packages doing the same parsing.

## CI matrix recommendations

For any package that parses pump events:

```yaml
strategy:
  matrix:
    fixture-set: [v1-only, v2-sol-only, v2-usdc-only, mixed]
```

Run the full parser test suite against each fixture set. A package that passes "v1-only" but fails "v2-usdc-only" tells you exactly where the migration is incomplete.
