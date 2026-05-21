# Context: The 2026-05-21 V2 USDC Rollout

## What pump.fun announced

> On Thursday, May 21, 2026, we will be enabling USDC mint as a quote mint for creating and trading pump coins.
>
> - USDC-paired coins can only be traded using the new V2 instructions announced earlier.
> - SOL paired coins will continue to be traded in native SOL even though the quote mint needs to be passed as the wrapped SOL mint.
> - All legacy instructions will continue to work for SOL paired coins.

Source: official pump.fun announcement, mirrored at <https://github.com/pump-fun/pump-public-docs>.

## What "quote mint" means here

A pump.fun coin lives on a bonding curve until it graduates to an AMM pool. Both phases pair the launched coin against a **quote currency** — the asset users actually pay in. Before this rollout, the quote was implicitly always SOL (specifically wrapped SOL when an SPL-token account was required).

The V2 upgrade makes the quote currency **explicit and pluggable**. Every V2 instruction takes a `quote_mint: Pubkey` argument, and every V2 event record carries a trailing `quote_mint` pubkey so downstream consumers can resolve the actual currency.

Two quote mints are supported at rollout:

| Currency | Mint address | Decimals | Display |
|----------|--------------|----------|---------|
| wrapped SOL (wSOL) | `So11111111111111111111111111111111111111112` | 9 | "SOL" — 4dp under 1, 2dp at/above |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | 6 | "USDC" — 2dp |

The on-chain accounting is in **base units of the quote mint**: lamports for SOL (10⁹ per SOL), micro-USDC for USDC (10⁶ per USDC).

## What V2 instructions exist

The rollout adds a V2 sibling to every fee-claim instruction across the three programs, plus V2 trade entry points on the bonding-curve and AMM programs:

| Program | V1 instruction | V2 sibling |
|---------|----------------|-----------|
| Pump (bonding curve) | `buy` | `buy_v2` |
| Pump (bonding curve) | `sell` | `sell_v2` |
| Pump (bonding curve) | `buy_exact_sol_in` | `buy_exact_quote_in` (V2) |
| Pump (bonding curve) | `create` / `create_v2` | unchanged (`create_v2` already pre-existed for the cashback/mayhem rollout) |
| Pump (bonding curve) | `collect_creator_fee` | `collect_creator_fee_v2` |
| Pump (bonding curve) | `distribute_creator_fees` | `distribute_creator_fees_v2` |
| PumpSwap AMM | `amm_buy` | `amm_buy_v2` |
| PumpSwap AMM | `amm_sell` | `amm_sell_v2` |
| PumpSwap AMM | `transfer_creator_fees_to_pump` | `transfer_creator_fees_to_pump_v2` |
| Pump fees | `claim_social_fee_pda` | `claim_social_fee_pda_v2` |
| Pump fees | (new in V2) | `update_fee_shares_v2` |

See [01-discriminators.md](./01-discriminators.md) for the hex disc values.

## What the V2 events emit

V2 instructions emit the **same Anchor event discriminators** as their V1 siblings — `CollectCreatorFeeEvent`, `DistributeCreatorFeesEvent`, `SocialFeePdaClaimed`, etc. — but with a **trailing `quote_mint(32)` pubkey** appended to the record. Some events also carry an additional `lifetime_stable_claimed(u64)` field.

This is why V2 silently breaks naive V1 parsers: the discriminator hash matches, so the parser happily reads the front of the record, but never reaches the trailing field. A USDC claim ends up rendered as ~0 SOL because the `amount_claimed(u64)` field — which is now in micro-USDC, not lamports — gets divided by 10⁹ instead of 10⁶.

See [02-event-layouts.md](./02-event-layouts.md) for byte-by-byte layouts.

## What stays the same

- **All V1 instructions keep working for SOL-paired coins.** No deprecation. You can keep using the old call path indefinitely if you don't need USDC support.
- **Event discriminator hex values are unchanged** for existing events. Only the record layout grew at the end.
- **Program IDs are unchanged.** Same three programs (Pump, PumpSwap AMM, Pump fees) at the same addresses.
- **The 8 fee recipients added in the 2026-04-28 upgrade** still apply. V2 instruction builders must still append them as trailing accounts — V2 is additive to that prior upgrade, not a replacement.

## Downstream impact map

| Component type | Impact | What to change |
|----------------|--------|----------------|
| Event/log monitor (e.g. claim trackers) | **High.** Will silently mis-parse V2 records. | Add the 5 new V2 instruction discriminators; parse trailing `quote_mint`; resolve ticker + decimals; recompute amounts. |
| Trade builder (TypeScript SDK callers) | **High** for USDC pairs, none for SOL pairs. | Use V2 builders with `quoteMint` argument; default to wSOL to preserve SOL-pair behavior. |
| UI / formatter | **High** for any UI that displays claim/trade amounts. | Stop hardcoding `SOL` ticker and 1e9 divisor; resolve dynamically via `QUOTE_MINT_INFO`. |
| Indexer / DB layer | **Medium.** Records need a quote_mint column or the amounts become ambiguous. | Add `quote_mint` (text) and `amount_quote` (numeric) columns; backfill V1 rows to `wSOL`. |
| REST API consumers (e.g. swap-api.pump.fun callers) | **Low / Medium.** Upstream API may or may not surface the field. | Pass-through whatever upstream exposes; default to SOL if absent. |
| Read-only MCP servers / public-API mirrors | **None** if they don't decode on-chain logs themselves. | Verify upstream API surfaces the field; otherwise no action needed. |

For per-repo specifics see [05-cross-repo-audit.md](./05-cross-repo-audit.md).

## Why this rollout is the right shape

USDC-paired coins unlock a category that was previously awkward on pump.fun: tokens whose creators want stable-denominated price discovery (so the coin doesn't track SOL movements during launch) and whose buyers want to spend stablecoins without a SOL roundtrip. The choice to **leave V1 working for SOL pairs** keeps every existing integration alive while making the new currency opt-in. The cost is a bookkeeping burden on every parser that touches pump.fun events — which is what this documentation set exists to make tractable.
