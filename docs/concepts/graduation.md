# Graduation

A pump.fun coin "graduates" when its bonding curve completes and its liquidity migrates to a real AMM pool on the **PumpSwap AMM program**. This is a one-way transition. After graduation, the coin trades on the AMM; the bonding curve is permanently closed.

## The trigger

The bonding curve has a real-SOL target (defaults to ~85 SOL across all pre-V2 launches; configurable in the `Global` account). When the curve's `realSolReserves` reaches this target, the next trade (or the next admin operation) sets `BondingCurve.complete = true`.

In pump.fun's UI this is rendered as "graduating at $69K market cap" — the dollar value is approximate, derived from the SOL target × the live SOL/USD rate.

## The migration sequence

When graduation is triggered:

1. The Pump program emits **`CompleteEvent`** (disc `5f72619cd42e9808`). This is the signal an external indexer (the channel bot, the launch monitor) uses to detect graduation in flight.
2. The pump.fun **migration authority** (`39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg`) executes `complete_amm_migration` on the PumpSwap AMM program. This:
   - Creates the AMM pool account for the coin.
   - Seeds the pool with the curve's reserves.
   - Emits **`CompleteAmmMigrationEvent`** (disc `bde95db95c94ea94`).
3. The coin is now tradable on PumpSwap AMM. The bonding curve account persists (for historical lookups), but `complete: true` and no further trades route through it.

The whole migration is a single transaction by the migration authority. Buyers attempting to trade *exactly* at the graduation moment may see their tx fail with a `BondingCurveComplete` error if they try to route through the curve after `complete` is set — they need to retry against the AMM.

## What changes post-graduation

| Aspect | Pre-graduation (bonding curve) | Post-graduation (AMM) |
|--------|--------------------------------|-----------------------|
| Trading venue | Pump program | PumpSwap AMM program |
| Pricing function | Constant-product on virtual reserves | Constant-product on real reserves |
| Creator fee claim | `collect_creator_fee` (Pump program) | `collect_coin_creator_fee` (PumpSwap program) — different ix |
| Cashback | Yes | Yes |
| Slippage | Bonding-curve internal | AMM liquidity-pool internal |
| Trade event disc | `bddb7fd34ee661ee` (TradeEvent) | AMM-specific events |

The **creator-fee claim instruction differs** post-graduation. The atomic toolkit's `src/collect-jito.js` handles both paths and picks the right one based on whether the curve is complete.

## Detecting graduation off-chain

If you're monitoring for graduation events:

```ts
// Subscribe to the Pump program's logs and filter for CompleteEvent disc.
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const COMPLETE_EVENT_DISC = '5f72619cd42e9808';

connection.onLogs(new PublicKey(PUMP_PROGRAM_ID), (logInfo) => {
  if (logInfo.logs.some(l => l.includes(COMPLETE_EVENT_DISC))) {
    console.log('Graduation in flight:', logInfo.signature);
  }
});
```

The atomic toolkit doesn't ship a graduation monitor, but `@nirholas/pumpkit` (the framework) has one: see [`packages/channel/src/event-monitor.ts`](https://github.com/nirholas/pumpkit/blob/main/packages/channel/src/event-monitor.ts).

## V2 USDC rollout interaction

USDC-paired coins graduate the same way SOL-paired coins do — the curve completes when real reserves reach the SOL target equivalent. The migration authority creates a PumpSwap AMM pool with `quote_mint = USDC` and the same constant-product math.

**The `CompleteEvent` discriminator is unchanged in V2.** As of writing, no trailing `quote_mint` has been documented for graduation events — if your monitor needs to know whether the graduated pool is SOL or USDC, fetch the resulting pool account post-graduation. See [`../v2-usdc-rollout/02-event-layouts.md`](../v2-usdc-rollout/02-event-layouts.md) for the formal layout reference.

## Operational implications

- **`collect-jito.js` works at any graduation state.** It detects `BondingCurve.complete` and routes to the right instruction (`collect_creator_fee` pre-graduation, `collect_coin_creator_fee` post-graduation).
- **`buy-jito.js` routes via Jupiter**, which transparently handles graduation. You don't need to special-case it.
- **Distribution timing.** Don't run `distribute.js` mid-graduation. Wait until the `CompleteAmmMigrationEvent` is confirmed, or your distribution may fail mid-batch.
- **Creator-fee accumulation.** Pre-graduation fees accumulate in the Pump program's vault PDA; post-graduation fees accumulate in the PumpSwap program's vault PDA. They are **different accounts**. `collect-jito.js` resolves the right one; `consolidate.js` follows it.

## Pitfalls

- **Don't assume the coin still trades on the curve after graduation.** Buy/sell ixs against the Pump program will fail with `BondingCurveComplete` after the curve closes. Use Jupiter or PumpSwap-direct calls.
- **Don't drain the bonding curve account.** The account persists post-graduation for historical lookups; the SOL on it is the curve's rent reserve and isn't yours to take.
- **Listen for both events.** `CompleteEvent` fires when the curve completes; `CompleteAmmMigrationEvent` fires when the AMM pool is created. They're a few seconds apart. For "is the coin tradable on the AMM yet?" use the second event.

## Related concepts

- [bonding-curve.md](./bonding-curve.md) — what graduates *from*
- [creator-fees.md](./creator-fees.md) — fee mechanics change across graduation
- [`../v2-usdc-rollout/02-event-layouts.md`](../v2-usdc-rollout/02-event-layouts.md) — event-layout reference
