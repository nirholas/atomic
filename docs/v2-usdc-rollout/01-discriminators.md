# Instruction & Event Discriminators

Anchor instruction discriminators are the first 8 bytes of an instruction's data payload. Event discriminators are the first 8 bytes of an event record emitted via `Program data:` log lines. All values below are little-endian byte order, lowercase hex.

> ⚠️ V2 instructions emit the **same event discriminators** as V1. Only the trailing record layout differs. See [02-event-layouts.md](./02-event-layouts.md).

## Program IDs

| Program | Address |
|---------|---------|
| Pump (bonding curve) | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` |
| PumpSwap AMM | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` |
| Pump fees | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` |

## Token-creation instructions (Pump)

| Instruction | Disc | Notes |
|-------------|------|-------|
| `create` | `181ec828051c0777` | Legacy single-arg create. |
| `create_v2` | `d6904cec5f8b31b4` | Adds creator pubkey, mayhem mode, cashback toggle. Pre-existed before May-21 rollout. |

## Fee-claim instructions

### V1 (continue to work for SOL-paired coins)

| Instruction | Disc | Program | Creator-claim? |
|-------------|------|---------|-----------------|
| `collect_creator_fee` | `1416567bc61cdb84` | Pump | ✅ |
| `claim_cashback` | `253a237ebe35e4c5` | Pump | ❌ |
| `distribute_creator_fees` | `a572670079cef751` | Pump | ✅ |
| `collect_coin_creator_fee` | `a039592ab58b2b42` | PumpSwap AMM | ✅ |
| `claim_cashback` | `253a237ebe35e4c5` | PumpSwap AMM | ❌ |
| `transfer_creator_fees_to_pump` | `8b348655e4e56cf1` | PumpSwap AMM | ✅ |
| `claim_social_fee_pda` | `e115fb85a11ec7e2` | Pump fees | ✅ |

### V2 (2026-05-21 rollout) — required for USDC-paired coins, valid for SOL-paired coins

| Instruction | Disc | Program | Maps to V1 ClaimType |
|-------------|------|---------|----------------------|
| `collect_creator_fee_v2` | `cf118af204221338` | Pump | `collect_creator_fee` |
| `distribute_creator_fees_v2` | `ffcb134ff444089f` | Pump | `distribute_creator_fees` |
| `transfer_creator_fees_to_pump_v2` | `01214eb921432c5c` | PumpSwap AMM | `transfer_creator_fees_to_pump` |
| `claim_social_fee_pda_v2` | `114df0863abc3595` | Pump fees | `claim_social_fee_pda` |
| `update_fee_shares_v2` | `6ffb31064e4e6a12` | Pump fees | `distribute_creator_fees` (CPIs into `distribute_creator_fees_v2`) |

`update_fee_shares_v2` is admin-driven: it CPIs into `distribute_creator_fees_v2` internally. Match it so you don't miss admin-pushed payouts in fee monitors.

## Trade instructions

These are the user-facing buy/sell entry points. V1 versions remain canonical for SOL pairs; V2 is required for USDC pairs.

### Bonding curve (Pump)

| Instruction | Disc | Notes |
|-------------|------|-------|
| `buy` | (look up in `pump.json` IDL) | V1 — assumes SOL via wSOL ATA. |
| `sell` | (look up in `pump.json` IDL) | V1 — assumes SOL via wSOL ATA. |
| `buy_exact_sol_in` | (look up in `pump.json` IDL) | V1 — fixed SOL input. |
| `buy_v2` | (refresh IDL from upstream) | V2 — takes `quote_mint` arg. See [`pumpfun-rust-client/src/sdk/pump_v2.rs`](https://github.com/nirholas/pumpfun-rust-client). |
| `sell_v2` | (refresh IDL from upstream) | V2 — takes `quote_mint` arg. |
| `buy_exact_quote_in` | (refresh IDL from upstream) | V2 — fixed quote input (replaces `buy_exact_sol_in` for V2 callers). |

### PumpSwap AMM

| Instruction | V1/V2 | Notes |
|-------------|-------|-------|
| `amm_buy` | V1 | Existing AMM buy path. |
| `amm_buy_exact_quote_in` | V1 | Existing fixed-quote-in path (the AMM has had `quote_mint` plumbing for longer — it's the bonding curve catching up at V2). |
| `amm_sell` | V1 | Existing AMM sell path. |
| `amm_buy_v2` | V2 | New in 2026-05-21; takes `quote_mint`. |
| `amm_sell_v2` | V2 | New in 2026-05-21; takes `quote_mint`. |

The PumpSwap AMM already had a `quote_mint` field on its pool state account from earlier work (used for generic AMM pools, not specifically pump-launched ones). The 2026-05-21 V2 rollout extends this to the user-facing AMM trade entry points and the fee-claim ix.

## Anchor event discriminators

These do **not** change between V1 and V2. Only the trailing record layout differs.

| Event | Disc | Emitted by |
|-------|------|-----------|
| `CollectCreatorFeeEvent` | `7a027f010ebf0caf` | `collect_creator_fee`, `collect_creator_fee_v2` |
| `DistributeCreatorFeesEvent` | `a537817004b3ca28` | `distribute_creator_fees`, `distribute_creator_fees_v2` |
| `ClaimCashbackEvent` | `e2d6f62107f293e5` | `claim_cashback` (no V2 sibling at rollout) |
| `CollectCoinCreatorFeeEvent` | `e8f5c2eeeada3a59` | `collect_coin_creator_fee` |
| `SocialFeePdaClaimed` | `3212c141edd2eaec` | `claim_social_fee_pda`, `claim_social_fee_pda_v2` |
| `CompleteEvent` | `5f72619cd42e9808` | Bonding curve completion (graduation trigger). |
| `CompleteAmmMigrationEvent` | `bde95db95c94ea94` | AMM pool migration. |
| `TradeEvent` | `bddb7fd34ee661ee` | Every buy/sell on the bonding curve. |

## How to verify a discriminator

If you suspect a disc value has drifted (or you're trying to onboard a new event):

```ts
import { createHash } from 'node:crypto';

function anchorDiscriminator(kind: 'event' | 'instruction' | 'account', name: string): string {
    const namespace = { instruction: 'global', event: 'event', account: 'account' }[kind];
    const preimage = `${namespace}:${name}`;
    return createHash('sha256').update(preimage).digest().subarray(0, 8).toString('hex');
}

// Examples:
anchorDiscriminator('instruction', 'collect_creator_fee_v2'); // 'cf118af204221338'
anchorDiscriminator('event', 'CollectCreatorFeeEvent');       // '7a027f010ebf0caf'
```

The Anchor convention: instructions use the `global:<snake_case>` namespace, events use `event:<PascalCase>`, accounts use `account:<PascalCase>`. The first 8 bytes of `sha256(preimage)` give the disc.
