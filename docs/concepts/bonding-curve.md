# Bonding curve

A "bonding curve" on pump.fun is the **pre-graduation pricing mechanism** for a freshly-launched coin. It's a deterministic price function backed by a virtual liquidity pool — buyers pay SOL (or USDC, post-V2), the curve mints tokens at the function-defined price, and the price rises with every buy.

This file covers the mechanics, the math, and the operational implications. For the V2 USDC-pair version, see also [`../v2-usdc-rollout/`](../v2-usdc-rollout/).

## High level

When a coin is created via pump.fun's `create` or `createV2` instruction, the Pump program initializes a **`BondingCurve` account** on-chain. This account holds:

- The virtual reserves of SOL and the coin's token.
- The bonding-curve parameters (initial virtual SOL, initial virtual token supply, target SOL for graduation).
- A `complete` flag set when the curve completes.

Every buy and sell goes through this curve. The price is computed deterministically from the current reserves — no orderbook, no external LP, no slippage from third-party providers (slippage comes from the curve itself).

## Pricing function

pump.fun uses a constant-product invariant adapted for the virtual-pool setup:

```
virtual_sol_reserves × virtual_token_reserves = k  (constant)
```

When a buyer sends `Δsol`, the new SOL reserve is `sol_reserves + Δsol`, and the new token reserve is `k / (sol_reserves + Δsol)`. The buyer receives `token_reserves - new_token_reserves` tokens. Each buy raises the SOL reserve and lowers the token reserve, so the marginal price (`sol/token`) rises monotonically.

Symmetrically, sells lower the SOL reserve and raise the token reserve. The curve's price recovers as sells happen.

Pump.fun adds:

- **Creator fee** (a percentage of every buy/sell) routed to the coin's `coinCreatorVault` PDA.
- **Platform fee** (a percentage routed to pump.fun's fee recipients).
- **Cashback** (volume-based rebate for repeat traders; see [cashback.md](./cashback.md)).

These fees are skimmed *before* the swap math, so the effective price for the user is slightly worse than the pure-curve quote.

## "Graduation" — when the curve completes

The curve has a target SOL amount (defaults to ~85 SOL in virtual reserves, configurable in the `Global` account). When the curve's real SOL deposits reach this threshold:

1. The `BondingCurve.complete` flag is set to `true`.
2. The Pump program emits a `CompleteEvent` (disc `5f72619cd42e9808`).
3. The migration authority migrates the coin's liquidity to a real **PumpSwap AMM pool** (via `complete_amm_migration`, emitting `CompleteAmmMigrationEvent` disc `bde95db95c94ea94`).
4. The coin is now traded on the AMM, not the curve. The curve is permanently closed.

See [graduation.md](./graduation.md) for the full sequence.

The "$69K market cap" figure you'll see in pump.fun's UI is roughly the dollar value of 85 SOL at typical SOL prices. Actual graduation triggers off the SOL amount, not the dollar value.

## What changes at the V2 USDC rollout

The bonding-curve mechanics are **unchanged in shape**. What changes is the quote asset:

- Pre-V2 coins: paired against SOL. Reserves measured in lamports.
- V2 SOL-paired coins: same as pre-V2 (still using lamports), but the V2 instructions take a `quote_mint = wSOL` argument.
- V2 USDC-paired coins: paired against USDC. Reserves measured in micro-USDC (10⁶ per USDC).

The curve's math is identical — only the units of the SOL-axis reserves change. Trading and graduation work the same way, just denominated in the new currency. See [`../v2-usdc-rollout/`](../v2-usdc-rollout/) for layouts.

## Operational implications for the atomic toolkit

- **`fire-jito.js` creates the bonding curve.** The dev-buy (if `DEV_BUY_SOL > 0`) is the first trade on the curve.
- **`buy-jito.js` trades on the curve until graduation.** After graduation, the same script still works (via Jupiter, which routes through the AMM pool), but the underlying mechanism is different.
- **`collect-jito.js` works at all curve states**, including pre- and post-graduation. The vault PDA persists.
- **Pricing is more sensitive to large trades pre-graduation.** With ~30-50 SOL in virtual reserves early on, a 1-SOL buy can move the price several percent. Set `SLIPPAGE_BPS` accordingly.

## Reading the curve from a script

```ts
import { PUMP_SDK } from '@nirholas/pump-sdk';

const bc = await PUMP_SDK.fetchBondingCurve(mint);
console.log({
  complete: bc.complete,
  virtualSolReserves: bc.virtualSolReserves.toString(),
  virtualTokenReserves: bc.virtualTokenReserves.toString(),
  realSolReserves: bc.realSolReserves.toString(),
  realTokenReserves: bc.realTokenReserves.toString(),
});
```

The "virtual" reserves are the curve's internal accounting; the "real" reserves are the actual on-chain SOL/tokens. The curve uses virtual for pricing to make the function smooth without requiring a huge initial deposit.

## Pitfalls

- **Don't compute price from real reserves alone.** Always use virtual reserves. Real reserves can be 0 for a brand-new curve while pricing is well-defined.
- **`complete: true` is irreversible.** Don't write code that handles "complete then un-complete". Graduation is a one-way migration.
- **The curve's accounts are distinct from the AMM pool's accounts.** After graduation, fetching `BondingCurve` for a graduated mint still works (the account persists), but pricing comes from the AMM pool.
- **Front-running risk on early trades.** A naive launch's first dev-buy can be sniped. `fire-jito.js`'s atomic bundle prevents this by including the dev-buy in the same bundle as the create.

## Related concepts

- [graduation.md](./graduation.md)
- [creator-fees.md](./creator-fees.md) — what % of each curve trade you earn
- [`../v2-usdc-rollout/`](../v2-usdc-rollout/) — the V2 quote-mint upgrade
