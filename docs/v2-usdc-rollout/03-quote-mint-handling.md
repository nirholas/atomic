# Quote-Mint Handling: Parsing, Conversion, Display

This document is the operational reference for any code that needs to handle the new `quote_mint` field — from the parser layer all the way up to UI rendering.

## The `QUOTE_MINT_INFO` table

The canonical lookup table. Use this everywhere; do not inline ticker/decimals strings.

```ts
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const QUOTE_MINT_INFO: Record<
    string,
    { ticker: string; decimals: number; isStable: boolean }
> = {
    [WSOL_MINT]: { ticker: 'SOL',  decimals: 9, isStable: false },
    [USDC_MINT]: { ticker: 'USDC', decimals: 6, isStable: true },
};
```

`isStable` is the display hint: stable quotes (USDC) get 2-decimal precision because they're dollar values; non-stable quotes (SOL) get 4-decimal precision for small amounts.

When new quote mints are added (USDT, etc.), add them to this table and downstream code Just Works.

## The fallback rule

> **When `quote_mint` cannot be resolved, default to wSOL.**

This preserves V1 behavior exactly. Every parser path should look like:

```ts
const resolvedQuoteMint = parsedQuoteMint ?? WSOL_MINT;
const quoteInfo = QUOTE_MINT_INFO[resolvedQuoteMint] ?? QUOTE_MINT_INFO[WSOL_MINT]!;
```

The double fallback (`?? WSOL_MINT` then `?? QUOTE_MINT_INFO[WSOL_MINT]!`) guards against both "no field present" and "field present but mint unknown" — defensive but cheap.

## Converting base units → human amounts

```ts
const quoteDivisor = Math.pow(10, quoteInfo.decimals);
const amountQuote = baseUnits / quoteDivisor;
```

- For SOL pairs: `baseUnits` is lamports, divisor is `10⁹`.
- For USDC pairs: `baseUnits` is micro-USDC, divisor is `10⁶`.

For large precision (claims over ~2 SOL or ~$2,000 USDC), prefer `Number(BigInt)` math:

```ts
const amountQuote = Number(baseUnitsBigInt) / quoteDivisor;
```

`Number(BigInt)` is exact up to 2⁵³ which is fine for any realistic claim.

## The reference TypeScript implementation

Lives in pumpkit at [`packages/core/src/formatter/links.ts`](https://github.com/nirholas/pumpkit/blob/main/packages/core/src/formatter/links.ts):

```ts
export function formatQuoteAmount(baseUnits: number | bigint, quoteMint?: string): string {
    const info = QUOTE_MINT_INFO[quoteMint ?? WSOL_MINT] ?? QUOTE_MINT_INFO[WSOL_MINT]!;
    const amount = Number(baseUnits) / Math.pow(10, info.decimals);
    const precision = info.isStable ? 2 : (amount < 1 ? 4 : 2);
    return `${amount.toFixed(precision)} ${info.ticker}`;
}
```

Use as a drop-in upgrade to legacy `formatSol(lamports)` calls. Same call signature when only one arg is passed — defaults to SOL, behaves identically.

## Display precision rules

| Currency | Amount range | Decimals | Rationale |
|----------|--------------|----------|-----------|
| SOL | `< 1` | 4 | Dust-level claims (cashback, social fees) need precision. |
| SOL | `>= 1` | 2 | Larger claims read cleanly. |
| USDC | any | 2 | Dollar values, always cents. |

For chart axes or aggregated stats you may want different rules — adjust at the rendering layer, not at the parsing layer.

## Reference parser pattern

The shape every event parser should follow (see [pumpkit/packages/claim/src/rpc-monitor.ts](https://github.com/nirholas/pumpkit/blob/main/packages/claim/src/rpc-monitor.ts) for the production version):

```ts
function parseClaimEventFromLogs(
    logMessages: string[],
    claimType: ClaimType,
): { amount: number; quoteMint?: string } | null {
    for (const line of logMessages) {
        if (!line.includes('Program data:')) continue;
        const b64 = line.split('Program data: ')[1]?.trim();
        if (!b64) continue;

        try {
            const bytes = Buffer.from(b64, 'base64');
            if (bytes.length < 8) continue;
            const disc = Buffer.from(bytes.subarray(0, 8)).toString('hex');
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

            // CollectCreatorFeeEvent
            if (disc === '7a027f010ebf0caf' && claimType === 'collect_creator_fee') {
                if (bytes.length < 56) continue;
                const amount = Number(view.getBigUint64(48, true));
                const quoteMint = bytes.length >= 88
                    ? new PublicKey(bytes.subarray(56, 88)).toBase58()
                    : undefined;
                return { amount, quoteMint };
            }
            // ... (other event arms)
        } catch { /* skip unparseable */ }
    }
    return null;
}
```

Then the call site resolves quote info:

```ts
const parsed = parseClaimEventFromLogs(meta.logMessages ?? [], def.claimType);
const baseUnits = parsed?.amount ?? 0;
const resolvedQuoteMint = parsed?.quoteMint ?? WSOL_MINT;
const quoteInfo = QUOTE_MINT_INFO[resolvedQuoteMint] ?? QUOTE_MINT_INFO[WSOL_MINT]!;
const amountQuote = baseUnits / Math.pow(10, quoteInfo.decimals);
const amountSol = quoteInfo.isStable ? 0 : baseUnits / LAMPORTS_PER_SOL;
```

The `amountSol = quoteInfo.isStable ? 0 : ...` is the **subtle correctness move**. Legacy code may still read `amountSol` directly. For USDC claims, that legacy code would render wildly wrong numbers — so we explicitly zero it out and force callers to use `amountQuote` + `quoteTicker`.

## Display-layer pattern (web UI)

The pumpkit web Dashboard uses this `pickAmount(e)` helper to keep the rendering call sites compact:

```ts
export function pickAmount(e: FeedEvent): { amount: number; ticker: string; isStable: boolean } {
    if (e.quoteTicker && typeof e.amountQuote === 'number') {
        return { amount: e.amountQuote, ticker: e.quoteTicker, isStable: e.quoteTicker === 'USDC' };
    }
    return { amount: e.amountSol, ticker: 'SOL', isStable: false };
}
```

Then in JSX:

```tsx
const { amount, ticker, isStable } = pickAmount(event);
return <span>{amount.toFixed(isStable ? 2 : 1)} {ticker}</span>;
```

The pattern: **prefer V2 fields when present, fall back to legacy fields with SOL assumed.** Same shape works for any UI framework.

## Storage / database considerations

If you store claim records in a DB, you'll want two new columns:

| Column | Type | Notes |
|--------|------|-------|
| `quote_mint` | `text` (base58 pubkey) | Default `So11111111111111111111111111111111111111112` for V1 backfill. |
| `amount_base_units` | `numeric(20)` or `bigint` | The raw u64. Decimals are derived from quote_mint at query time. |

Do **not** store `amount_sol` as a float — it's lossy for large lamport values and meaningless for USDC. If you absolutely need a UI-ready field, store it as a generated column: `GENERATED ALWAYS AS (amount_base_units::numeric / power(10, decimals_for(quote_mint))) STORED`.

Backfill SQL for existing V1 rows:

```sql
UPDATE claims SET quote_mint = 'So11111111111111111111111111111111111111112'
WHERE quote_mint IS NULL;
```

## Common mistakes to avoid

1. **Hardcoding `/ 1e9`** anywhere downstream of an event read. You won't notice until the first USDC claim renders 1000× wrong.
2. **Hardcoding `'SOL'` ticker** in formatter functions. Same problem.
3. **Branching on instruction discriminator alone** to decide which event layout to parse. V1 and V2 emit the *same* event disc; branch on `bytes.length` (for fixed events) or walk the borsh fields (for variable ones).
4. **Reading `distributed` from the end of `DistributeCreatorFeesEvent`.** V2 has a trailing `quote_mint` so the offset moves. Walk the shareholder vec to find `distributed` explicitly.
5. **Assuming `quote_mint` is always one of the two we know about.** New quote mints can be whitelisted in the future. Treat unknown mints as a soft-fail (default to SOL, log a warning) — never crash.
6. **Mixing up `lamports_per_sol = 1e9` with `micro_usdc_per_usdc = 1e6`.** Always look up via `QUOTE_MINT_INFO[mint].decimals`.

## Cross-language considerations

The same rules apply outside TypeScript:

- **Rust:** see [`pumpfun-rust-client/src/sdk/pump_v2.rs`](https://github.com/nirholas/pumpfun-rust-client). Idiom: `quote_mint: Pubkey` defaults to `spl_token::native_mint::ID` (which equals wSOL).
- **Python:** mirror the `QUOTE_MINT_INFO` dict; use `Decimal` math for amounts above ~9 significant figures.
- **Go:** keep amounts as `*big.Int` until display; mirror the lookup table.
