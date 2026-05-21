# Event Record Byte Layouts (V1 vs V2)

All Anchor events are emitted via `Program data: <base64>` log lines in transaction `meta.logMessages`. The decoded bytes start with the 8-byte event discriminator, then the borsh-encoded record body.

Conventions used below:

- `disc(8)`: 8-byte little-endian Anchor discriminator (see [01-discriminators.md](./01-discriminators.md))
- `pubkey(32)`: 32-byte Solana pubkey
- `u64(8)`: little-endian unsigned 64-bit
- `u8(1)`: single byte
- `string`: borsh string = `len(u32 LE) + utf8_bytes(len)`
- `vec<T>`: borsh vec = `len(u32 LE) + T * len`

## `CollectCreatorFeeEvent`

Disc: `7a027f010ebf0caf`

### V1 layout (40 bytes minimum)

```
offset  size  field
0       8     disc                    = 7a027f010ebf0caf
8       8     timestamp (u64)
16      32    creator (pubkey)
48      8     creator_fee (u64)        ← amount in lamports (SOL pairs)
```

### V2 layout (88 bytes when quote_mint is wSOL or USDC)

```
offset  size  field
0       8     disc                    = 7a027f010ebf0caf
8       8     timestamp (u64)
16      32    creator (pubkey)
48      8     creator_fee (u64)        ← amount in BASE UNITS of quote_mint
56      32    quote_mint (pubkey)      ← NEW in V2
```

**Parser rule:** if `bytes.length >= 88`, read the quote mint at offset 56; otherwise treat as V1 (default to wSOL).

## `DistributeCreatorFeesEvent`

Disc: `a537817004b3ca28`

This event has a **variable-length shareholder vec** in the middle, so the trailing fields can't be read by absolute offset — you must walk the vec.

### V1 layout

```
offset                       size            field
0                            8               disc                    = a537817004b3ca28
8                            8               timestamp (u64)
16                           32              mint (pubkey)
48                           32              bonding_curve (pubkey)
80                           32              sharing_config (pubkey)
112                          32              admin (pubkey)
144                          4               shareholders.len (u32 LE)
144 + 4                      34 * len        shareholders[]: (pubkey + u16 shareBps) each
144 + 4 + (34 * len)         8               distributed (u64)        ← total amount in lamports
```

### V2 layout

```
... same up to and including `distributed` ...
144 + 4 + (34 * len) + 8     32              quote_mint (pubkey)      ← NEW in V2
```

### Reference parsing code

```ts
const SHARE_VEC_OFFSET = 8 + 8 + 32 + 32 + 32 + 32; // 144
const shareCount = bytes.readUInt32LE(SHARE_VEC_OFFSET);
const distributedOffset = SHARE_VEC_OFFSET + 4 + shareCount * 34;
const distributed = view.getBigUint64(distributedOffset, true);
// V2 only
const qmOffset = distributedOffset + 8;
const quoteMint = bytes.length >= qmOffset + 32
    ? new PublicKey(bytes.subarray(qmOffset, qmOffset + 32)).toBase58()
    : undefined;
```

**Do not** read `distributed` from the end of the buffer — that breaks on V2 because of the trailing `quote_mint`.

## `ClaimCashbackEvent`

Disc: `e2d6f62107f293e5`

Cashback has **no V2 variant** at rollout time — cashback is always SOL-denominated.

### Layout (48 bytes minimum)

```
offset  size  field
0       8     disc                    = e2d6f62107f293e5
8       32    user (pubkey)
40      8     amount (u64)             ← lamports
48      8     timestamp (u64)
56      8     total_claimed (u64)
64      8     total_cashback_earned (u64)
```

**Parser rule:** always SOL; do not look for a quote_mint trailing field.

## `CollectCoinCreatorFeeEvent`

Disc: `e8f5c2eeeada3a59`

This is the **PumpSwap AMM** variant of collect-creator-fee. No quote-mint trailing field per current spec — the AMM pool itself already encodes `quote_mint` on the pool account so the event doesn't repeat it.

### Layout (56 bytes minimum)

```
offset  size  field
0       8     disc                    = e8f5c2eeeada3a59
8       8     timestamp (u64)
16      32    coin_creator (pubkey)
48      8     coin_creator_fee (u64)   ← base units of pool's quote_mint
```

**Parser rule:** to know the quote currency, you need to fetch the pool account that emitted this event and read its `quote_mint` field. The pool address is in the parent instruction's account list. Do **not** assume SOL.

## `SocialFeePdaClaimed`

Disc: `3212c141edd2eaec`

The most layout-complex event. Contains a variable-length string in the middle.

### V1 layout

```
offset  size            field
0       8               disc                            = 3212c141edd2eaec
8       8               timestamp (u64)
16      4 + uidLen      user_id (borsh string)           ← e.g. "12345678" (GitHub numeric ID as string)
16+4+L  1               platform (u8)                    ← 2 = GitHub
17+4+L  32              social_fee_pda (pubkey)
49+4+L  32              recipient (pubkey)
81+4+L  32              social_claim_authority (pubkey)
113+4+L 8               amount_claimed (u64)             ← lamports
121+4+L 8               claimable_before (u64)
129+4+L 8               lifetime_claimed (u64)
137+4+L 8               recipient_balance_before (u64)
145+4+L 8               recipient_balance_after (u64)
```

(`L` = byte length of the user_id string.)

### V2 trailing fields

```
153+4+L 32              quote_mint (pubkey)              ← NEW in V2
185+4+L 8               lifetime_stable_claimed (u64)    ← NEW in V2
```

### Reference parsing code

```ts
let offset = 16; // skip disc + ts
const uidLen = bytes.readUInt32LE(offset);
offset += 4 + uidLen + 1; // skip string + platform u8
offset += 32 + 32 + 32;   // skip 3 pubkeys
const amountClaimed = view.getBigUint64(offset, true); offset += 8;
const claimableBefore = view.getBigUint64(offset, true); offset += 8;
const lifetimeClaimed = view.getBigUint64(offset, true); offset += 8;
// V2 only: skip recipient_balance_{before,after} then read quote_mint
const quoteMint = bytes.length >= offset + 16 + 32
    ? new PublicKey(bytes.subarray(offset + 16, offset + 16 + 32)).toBase58()
    : undefined;
const lifetimeStableClaimed = bytes.length >= offset + 16 + 32 + 8
    ? view.getBigUint64(offset + 16 + 32, true)
    : undefined;
```

## `CompleteEvent` and `CompleteAmmMigrationEvent`

Disc: `5f72619cd42e9808` and `bde95db95c94ea94`

Graduation lifecycle events. Currently no documented V2 layout extension. Confirm against latest IDL if your code parses these.

## `TradeEvent`

Disc: `bddb7fd34ee661ee`

Emitted on every buy/sell. The on-chain layout encodes `sol_amount`, `token_amount`, etc. — review your local IDL for the V2 record layout, which adds `quote_mint`. Treat the same as the claim events: if a trailing `quote_mint` is present, the amounts are in base units of *that* mint, not necessarily lamports.

## Fallback parsing strategy (production rule)

For each event, always:

1. **Branch by record length first**, not by instruction discriminator. The V2 event disc matches V1 — but `bytes.length` cleanly distinguishes them for fixed-layout events (everything except DistributeCreatorFees, where you have to walk the vec).
2. **Default to wSOL** when no `quote_mint` is parseable. This preserves V1 behavior exactly.
3. **Read `amount` in base units, then convert at display time** via the resolved mint's decimals. Don't decide the divisor at parse time — that's where USDC claims get mangled.
4. **Keep a lamport balance-delta fallback** for instructions that don't emit parseable events (e.g. log truncation, novel instruction variants). This is what [pumpkit/packages/claim/src/rpc-monitor.ts](https://github.com/nirholas/pumpkit/blob/main/packages/claim/src/rpc-monitor.ts) does.

## Worked example: USDC vs SOL collect_creator_fee

Same instruction (`collect_creator_fee_v2`), same event disc (`7a027f010ebf0caf`), different quote mints.

**USDC pair, $5.00 claimed:**

```
disc      7a027f010ebf0caf
ts        00 00 00 00 00 00 00 00 (zeroed for example)
creator   <32 bytes>
fee_u64   404b4c0000000000           ← 5_000_000 micro-USDC = 5 USDC
quote     <32 bytes of USDC mint>
```

Total bytes: 88. Parser reads `quote_mint` → USDC → decimals=6 → `5_000_000 / 10⁶ = 5.00 USDC`. ✅

**SOL pair, 0.05 SOL claimed (V2 path with explicit wSOL quote):**

```
disc      7a027f010ebf0caf
ts        ...
creator   <32 bytes>
fee_u64   80f0fa0200000000           ← 50_000_000 lamports = 0.05 SOL
quote     <32 bytes of wSOL mint>
```

Total bytes: 88. Parser reads `quote_mint` → wSOL → decimals=9 → `50_000_000 / 10⁹ = 0.05 SOL`. ✅

**SOL pair, 0.05 SOL claimed (V1 path):**

```
disc      7a027f010ebf0caf
ts        ...
creator   <32 bytes>
fee_u64   80f0fa0200000000           ← 50_000_000 lamports = 0.05 SOL
```

Total bytes: 56. Parser sees `bytes.length < 88`, defaults to wSOL → `0.05 SOL`. ✅

**The failure mode this prevents:** an unaware parser reading the V2 USDC record above with `amount / 1e9` would display `0.005 SOL`, off by 200× in the wrong currency.
