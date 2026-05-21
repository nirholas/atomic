# Mayhem mode

"Mayhem mode" is an alternative bonding-curve mechanic for pump.fun coins, enabled via the `mayhemMode` argument of the `createV2` instruction. It's an opt-in launch parameter — once set at create time, it can't be flipped later.

## What it changes

The standard bonding curve is conservative: smooth price impact, gradual graduation, designed for steady-trading meme coins. Mayhem mode tunes the same constant-product math toward more volatility:

- **Steeper early price impact.** Smaller virtual reserves at launch mean each buy moves the price more.
- **Faster graduation potential.** The real-SOL target to graduate is generally lower or hit faster because of how the curve interacts with the dev buy.
- **More volatility in both directions.** Sells also move the price more.

The exact numerical differences are encoded in the `Global` account's mayhem parameters and may evolve. The atomic toolkit doesn't introspect them; it just passes the boolean flag through to `createV2`.

## How to enable

Two ways:

### Via pump.fun's UI

Toggle "Mayhem mode" in the create-coin form. Click launch.

### Via the atomic toolkit

Set `MAYHEM_MODE=1` in `.env` (or as an inline env var):

```bash
MAYHEM_MODE=1 \
URI=... NAME=... SYMBOL=... \
FUNDER_SECRET=<base58> CREATOR_SECRET=<base58> \
JITO_TIP=0.01 \
  npm run launch
```

The `src/fire-jito.js` script reads `MAYHEM_MODE` and passes it as the `mayhemMode` arg to `PUMP_SDK.createV2Instruction`.

## When to use it

- **Memecoins where volatility is the feature, not the bug.** Faster price discovery, more excitement during launch hours.
- **Short-lived campaigns.** If the coin is meant to graduate quickly and then live or die on the AMM, mayhem accelerates that arc.
- **Already-hot launches.** A coin with strong pre-existing interest doesn't need a gentle curve — mayhem lets it skip the slow climb.

When **not** to use it:

- **First-time launches.** The added volatility makes pre-flight testing harder. Start with the default curve and graduate to mayhem on later launches.
- **Brand coins.** Steady-state trading is more valuable than spectacle for tokens with non-speculative use cases.
- **Coins with planned external liquidity.** Mayhem curves graduate fast; if you're not ready with AMM ops, you'll be caught flat-footed.

## Operational implications

- **The flag is set once at create time.** No mid-flight toggle. Plan before launching.
- **Cashback and creator-fee mechanics are unchanged.** Mayhem only affects pricing, not the fee flow.
- **Buyers see a higher slippage spike.** Set `SLIPPAGE_BPS` higher (1000-1500 BPS, i.e. 10-15%) for mayhem-coin buys.
- **V2 USDC compatibility.** Mayhem is independent of the quote-mint choice. A USDC-paired coin can be in mayhem mode.

## Detecting mayhem mode on a launched coin

After a coin is created, the `BondingCurve` account has a field indicating mayhem state (refresh your IDL to confirm exact field name — historically `mayhem_mode: bool`). To check:

```ts
const bc = await PUMP_SDK.fetchBondingCurve(mint);
console.log({ mayhem: bc.mayhemMode });
```

`@nirholas/pumpkit`'s monitor packages surface this in launch-event metadata.

## Pitfalls

- **Don't assume "mayhem = better launch outcomes".** It's a different shape of risk, not a guaranteed pump.
- **Don't run the standard `npm run buy` against a fresh mayhem coin with default slippage.** You'll get rejected. Bump `SLIPPAGE_BPS`.
- **Don't try to "un-mayhem" a coin.** It's not a thing. Launch a fresh one if you need standard mechanics.
- **Don't bundle mayhem-mode launches with normal-mode launches in your operational reporting.** They have different volatility profiles; averaging them is misleading.

## Related concepts

- [bonding-curve.md](./bonding-curve.md) — the underlying mechanic that mayhem tunes
- [graduation.md](./graduation.md) — mayhem can accelerate this
- `src/fire-jito.js` — passes the `mayhemMode` arg through
