# Creator fees

Pump.fun coins generate a **creator fee** on every buy and sell. The fee accumulates in a per-coin PDA (the `coinCreatorVault`) and is claimable by the coin's creator wallet (or the configured shareholders if [fee-sharing](./fee-sharing.md) is set up).

This file covers the mechanics, the claim flow, and the V1 → V2 transition for claims.

## The fee

A configurable percentage of every trade goes to the coin's creator vault. The percentage is set by pump.fun's `Global` account at coin creation. As of writing, the default is in the low single digits — check the live `Global` account for the exact value.

Pre-graduation: the fee is skimmed inside the Pump program's `buy` / `sell` ix and routed to the vault PDA owned by the Pump program.

Post-graduation: the fee is skimmed inside the PumpSwap AMM's `amm_buy` / `amm_sell` ix and routed to a different vault PDA owned by the PumpSwap AMM program. The atomic toolkit's `collect-jito.js` detects which vault to drain based on `BondingCurve.complete`.

## The vault PDA

The `coinCreatorVault` PDA is derived from `("creator_vault", mint)` against the appropriate program. It holds SOL (or USDC, post-V2 for USDC-paired coins).

You can check a coin's vault balance:

```bash
# Pre-graduation, the vault is owned by the Pump program
solana balance $(pump-cli derive-vault --mint <MINT>)
```

Or programmatically via `getBalance` on the derived PDA. The atomic toolkit handles this transparently.

## Claim flow

Three instructions matter here:

### V1 (still works for SOL-paired coins)

- **`collect_creator_fee`** (disc `1416567bc61cdb84`, Pump program): pre-graduation claim. Single ix that moves vault → creator wallet.
- **`collect_coin_creator_fee`** (disc `a039592ab58b2b42`, PumpSwap AMM program): post-graduation claim. Same shape, different program.

### V2 (required for USDC-paired coins, valid for SOL-paired coins)

- **`collect_creator_fee_v2`** (disc `cf118af204221338`, Pump program): pre-graduation. Takes a `quote_mint` arg.
- (PumpSwap AMM's post-graduation V2 claim follows the same pattern — refresh your IDL to see exact disc.)

The atomic toolkit's `collect-jito.js` wraps these into a single Jito bundle:

1. Build the appropriate `collect_*` instruction (V1 or V2 based on whether the coin is USDC-paired).
2. Append a SOL/SPL-token transfer from the creator wallet to `DESTINATION`.
3. Add the Jito tip ix.
4. Submit the bundle.

The bundle lands atomically: the fee never rests on the creator wallet long enough to be sweeper-bait.

## What V2 changes

The trailing `quote_mint` pubkey appended to V2 event records. The fee amount itself is now in **base units of the quote mint**, not always lamports:

- SOL-paired V2 claim: `creator_fee` in lamports (× 10⁹ per SOL).
- USDC-paired V2 claim: `creator_fee` in micro-USDC (× 10⁶ per USDC).

If you're parsing `CollectCreatorFeeEvent` (disc `7a027f010ebf0caf`):

- V1 records: 56 bytes. No `quote_mint`. Treat amount as lamports.
- V2 records: 88 bytes. Read `quote_mint` at offset 56. Resolve decimals from a `QUOTE_MINT_INFO` table.

See [`../v2-usdc-rollout/02-event-layouts.md`](../v2-usdc-rollout/02-event-layouts.md) for the byte-level spec and [`../v2-usdc-rollout/03-quote-mint-handling.md`](../v2-usdc-rollout/03-quote-mint-handling.md) for the parser reference.

## Operational implications

- **Always atomic-bundle the claim with a drain.** A non-atomic claim leaves SOL on the creator wallet, which sweepers can grab if the creator key is shared/leaked. `collect-jito.js` enforces this.
- **Run claims when the vault is meaningfully full.** Each claim costs ~0.001 SOL in Jito tip + network fees. Claiming a vault holding 0.005 SOL is mostly losses to fees. The `watch-collect.js` daemon enforces a `MIN_COLLECT_SOL` threshold for this reason.
- **Multiple claimers per coin.** If [fee-sharing](./fee-sharing.md) is configured, the V2 `distribute_creator_fees_v2` ix routes the fee to the shareholders rather than the single creator. Use `consolidate.js` for full-drain operations.
- **Cashback ≠ creator fee.** Cashback is a separate flow paid back to *traders* (see [cashback.md](./cashback.md)). It's not collected via `collect_creator_fee`.

## Worked example

Collecting fees on a SOL-paired coin (V1 path) atomically:

```bash
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
MINT=Memo...XX \
DESTINATION=9aHj...2wXk \
JITO_TIP=0.005 \
  npm run collect
```

Output: bundle ID and Solscan link. Verify:

1. Creator vault PDA balance is 0 post-bundle.
2. Destination wallet balance increased by `~(vault_pre_balance - small_dust)`.
3. Creator wallet balance is *unchanged* (the SOL passed through atomically; it never settled).

## Pitfalls

- **Don't claim with the Pump-program ix on a post-graduation coin.** It'll fail because the vault is now owned by PumpSwap AMM. The toolkit detects this; manual SDK callers must check `BondingCurve.complete` first.
- **Don't store `amount_sol` for a USDC claim.** The number is in micro-USDC, not lamports. Use `amount_quote` with the resolved decimals.
- **Don't reuse the vault PDA for non-claim transfers.** The PDA is owned by the program; only the protocol can move its SOL.
- **Don't drain less than gas+tip cost.** Set `MIN_COLLECT_SOL >= 0.005` or higher to be economical.

## Related concepts

- [fee-sharing.md](./fee-sharing.md) — splitting creator fees among multiple wallets
- [graduation.md](./graduation.md) — fee-claim ix changes across graduation
- [`../scripts/collect-jito.md`](../scripts/collect-jito.md) — the script's per-flag reference
- [`../v2-usdc-rollout/02-event-layouts.md`](../v2-usdc-rollout/02-event-layouts.md) — `CollectCreatorFeeEvent` byte layout
