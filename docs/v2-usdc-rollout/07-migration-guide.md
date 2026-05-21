# Migration Guide: V1 → V2 USDC Awareness

Step-by-step recipes for the most common migration scenarios.

## Scenario 1: You build buy/sell transactions in TypeScript

### Today (V1, SOL only)

```ts
import { PUMP_SDK, OnlinePumpSdk } from '@nirholas/pump-sdk';
import BN from 'bn.js';

const online = new OnlinePumpSdk(connection);
const global = await online.fetchGlobal();
const state = await online.fetchBuyState(mint, user);

const buyIxs = await PUMP_SDK.buyInstructions({
    global,
    bondingCurveAccountInfo: state.bondingCurveAccountInfo,
    bondingCurve: state.bondingCurve,
    associatedUserAccountInfo: state.associatedUserAccountInfo,
    mint,
    user: wallet.publicKey,
    solAmount: new BN(500_000_000), // 0.5 SOL
    amount: tokensOut,
    slippage: 1,
    tokenProgram: TOKEN_PROGRAM_ID,
});
```

### After May 21 — SOL-paired coin via V2 (recommended)

```ts
import { PUMP_SDK, OnlinePumpSdk, WSOL_MINT } from '@nirholas/pump-sdk'; // v1.33+

const buyIxs = await PUMP_SDK.buyV2Instructions({
    ...sameArgsAsAbove,
    solAmount: new BN(500_000_000),
    quoteMint: new PublicKey(WSOL_MINT), // <-- explicit even for SOL pairs
});
```

### After May 21 — USDC-paired coin

```ts
import { PUMP_SDK, USDC_MINT } from '@nirholas/pump-sdk'; // v1.33+

const buyIxs = await PUMP_SDK.buyV2Instructions({
    ...sameArgsAsAbove,
    solAmount: new BN(5_000_000),       // 5 USDC (6 decimals)
    quoteMint: new PublicKey(USDC_MINT),
});
```

The `solAmount` parameter name is preserved for backwards-compat but its units are now **base units of `quoteMint`** (lamports for wSOL, micro-USDC for USDC). The SDK's IDL refresh will rename this to `quoteAmount` over time — track the SDK changelog.

### After May 21 — keep using V1 for SOL pairs (also valid)

Nothing changes:

```ts
const buyIxs = await PUMP_SDK.buyInstructions({ ... });
```

V1 stays alive for SOL pairs. You only **need** to migrate if you want USDC pair support.

## Scenario 2: You monitor pump.fun fee-claim events

### Today (V1, SOL only)

```ts
const CLAIM_INSTRUCTIONS = [
    { disc: '1416567bc61cdb84', label: 'Collect Creator Fee (Pump)', ... },
    { disc: 'a572670079cef751', label: 'Distribute Creator Fees (Pump)', ... },
    // ...
];

function parseClaim(tx) {
    for (const ix of tx.instructions) {
        const disc = ix.data.slice(0, 16);
        const match = CLAIM_INSTRUCTIONS.find(i => i.disc === disc);
        if (!match) continue;

        // Read amount from balance delta
        const amountLamports = preBalance - postBalance;
        const amountSol = amountLamports / 1e9;
        return { amount: amountSol, ticker: 'SOL', claimType: match.label };
    }
}
```

### After May 21

Two additions: **(a) recognize V2 instruction discs**, **(b) parse the trailing `quote_mint` from event logs**.

```ts
const CLAIM_INSTRUCTIONS = [
    // V1 (unchanged)
    { disc: '1416567bc61cdb84', label: 'Collect Creator Fee (Pump)', claimType: 'collect_creator_fee', ... },
    { disc: 'a572670079cef751', label: 'Distribute Creator Fees (Pump)', claimType: 'distribute_creator_fees', ... },
    // ... other V1 entries ...

    // V2 (NEW — map to the same `claimType` as V1 equivalent for downstream uniformity)
    { disc: 'cf118af204221338', label: 'Collect Creator Fee V2 (Pump)', claimType: 'collect_creator_fee', ... },
    { disc: 'ffcb134ff444089f', label: 'Distribute Creator Fees V2 (Pump)', claimType: 'distribute_creator_fees', ... },
    { disc: '01214eb921432c5c', label: 'Transfer Creator Fees to Pump V2', claimType: 'transfer_creator_fees_to_pump', ... },
    { disc: '114df0863abc3595', label: 'Claim Social Fee PDA V2', claimType: 'claim_social_fee_pda', ... },
    { disc: '6ffb31064e4e6a12', label: 'Update Fee Shares V2 (Pump Fees)', claimType: 'distribute_creator_fees', ... },
];

const QUOTE_MINT_INFO = {
    'So11111111111111111111111111111111111111112': { ticker: 'SOL',  decimals: 9, isStable: false },
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { ticker: 'USDC', decimals: 6, isStable: true },
};

function parseClaim(tx) {
    for (const ix of tx.instructions) {
        const disc = ix.data.slice(0, 16);
        const match = CLAIM_INSTRUCTIONS.find(i => i.disc === disc);
        if (!match) continue;

        // (a) Parse event from logs — gives us amount in base units + trailing quote_mint
        const parsed = parseClaimEventFromLogs(tx.meta.logMessages, match.claimType);

        // (b) Fall back to balance delta for V1 events without parseable logs
        const baseUnits = parsed?.amount ?? (preBalance - postBalance);
        const quoteMint = parsed?.quoteMint ?? 'So11111111111111111111111111111111111111112';
        const info = QUOTE_MINT_INFO[quoteMint] ?? QUOTE_MINT_INFO['So11111111111111111111111111111111111111112'];

        return {
            amountQuote: baseUnits / Math.pow(10, info.decimals),
            ticker: info.ticker,
            isStable: info.isStable,
            quoteMint,
            claimType: match.claimType,
            // legacy field — meaningful only when quote is SOL
            amountSol: info.isStable ? 0 : baseUnits / 1e9,
        };
    }
}
```

`parseClaimEventFromLogs` implementation: see [03-quote-mint-handling.md](./03-quote-mint-handling.md).

## Scenario 3: You display claim/trade amounts in a UI

### Today (hardcoded SOL)

```tsx
<span>{event.amountSol.toFixed(4)} SOL</span>
```

### After May 21

Extract a small helper, then use it everywhere:

```tsx
function pickAmount(e): { amount: number; ticker: string; isStable: boolean } {
    if (e.quoteTicker && typeof e.amountQuote === 'number') {
        return { amount: e.amountQuote, ticker: e.quoteTicker, isStable: e.quoteTicker === 'USDC' };
    }
    return { amount: e.amountSol, ticker: 'SOL', isStable: false };
}

// Then:
const { amount, ticker, isStable } = pickAmount(event);
return <span>{amount.toFixed(isStable ? 2 : 4)} {ticker}</span>;
```

For Telegram HTML messages, same idea:

```ts
const ticker = event.quoteTicker ?? 'SOL';
const amount = event.amountQuote ?? event.amountSol;
const display = event.isStableQuote ? amount.toFixed(2) : amount.toFixed(4);
return `💰 <b>Amount:</b> ${display} ${ticker}`;
```

## Scenario 4: You write a database schema for pump.fun activity

### Schema additions

```sql
ALTER TABLE pump_claims
    ADD COLUMN quote_mint TEXT NOT NULL DEFAULT 'So11111111111111111111111111111111111111112',
    ADD COLUMN amount_base_units NUMERIC(20) NOT NULL DEFAULT 0;

-- Backfill existing rows: all pre-May-21 claims are SOL
UPDATE pump_claims
SET quote_mint = 'So11111111111111111111111111111111111111112',
    amount_base_units = amount_lamports
WHERE quote_mint IS NULL;

-- Drop the now-misleading amount_sol column, or keep as a generated column:
ALTER TABLE pump_claims
    ADD COLUMN amount_display NUMERIC GENERATED ALWAYS AS (
        amount_base_units::numeric / CASE quote_mint
            WHEN 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' THEN 1000000
            ELSE 1000000000
        END
    ) STORED;
```

### Query patterns

Per-currency aggregates:

```sql
SELECT quote_mint, COUNT(*), SUM(amount_base_units::numeric / decimals_for(quote_mint)) AS total
FROM pump_claims
WHERE claimed_at > NOW() - INTERVAL '24 hours'
GROUP BY quote_mint;
```

(Define `decimals_for(text)` as a small immutable SQL function for clarity.)

## Scenario 5: You consume pump.fun's REST API

`swap-api.pump.fun` endpoints (e.g. `coins-v2/{mint}`) may or may not surface `quote_mint` at rollout — verify empirically before assuming a shape:

```ts
const data = await fetch(`https://swap-api.pump.fun/coins-v2/${mint}`).then(r => r.json());

// Defensive: accept several possible field names
const quoteMint =
    data.quote_mint
    ?? data.quoteMint
    ?? 'So11111111111111111111111111111111111111112'; // default SOL

const ticker = QUOTE_MINT_INFO[quoteMint]?.ticker ?? 'SOL';
```

When the REST API doesn't surface the field yet, default to SOL. Once it does, your code reads the actual quote without further changes.

## Scenario 6: You're writing a brand-new pump.fun integration after May 21

Just use V2 throughout. The V1/V2 distinction is only relevant when migrating existing code. New code should:

- Always call `*V2Instructions` builders.
- Always parse the trailing `quote_mint` from event records.
- Always use `formatQuoteAmount(baseUnits, quoteMint)` for display.
- Never special-case SOL — it's just one quote mint among the supported set.

## Checklist before deploying a migration

- [ ] Every event parser branches by `bytes.length` (not just by discriminator) when reading V2 records.
- [ ] Every display call uses `quoteTicker` / `amountQuote` with a SOL fallback, not hardcoded `'SOL'`.
- [ ] Every storage row has `quote_mint` populated (default `WSOL_MINT` for V1 backfill).
- [ ] Every SDK call site that intends USDC support passes `quoteMint` explicitly.
- [ ] At least one test exercises a USDC fixture end-to-end, asserting both the amount and the ticker render correctly.
- [ ] No `amount / 1e9` hardcoded anywhere downstream of the parser.
- [ ] Logs and metrics labels include `quote_mint` so SOL vs USDC volume can be split.
