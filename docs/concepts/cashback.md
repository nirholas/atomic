# Cashback

Cashback is a **volume-based rebate** paid back to traders on pump.fun. Trade enough on a coin and you accumulate a claimable cashback balance, redeemable via the `claim_cashback` instruction.

It's distinct from the creator fee (which goes to the coin's creator, not the trader) and from fee sharing (which splits the creator fee across shareholders).

## How it accrues

Trading activity is tracked in a per-user PDA called `UserVolumeAccumulator`. Each buy and sell on a pump.fun coin (pre- or post-graduation) updates the accumulator with:

- The user's lifetime volume on the coin.
- A computed cashback share based on the volume.
- A timestamp.

The exact formula is documented in pump.fun's public docs and may evolve. The atomic toolkit doesn't compute cashback itself — it just integrates with the claim instruction.

## The claim instruction

**`claim_cashback`** (disc `253a237ebe35e4c5`) exists on both the Pump program and the PumpSwap AMM program (same disc, different programs). The instruction:

1. Reads the user's `UserVolumeAccumulator` PDA.
2. Computes the claimable cashback amount.
3. Transfers SOL from a Pump-program fee account to the user.
4. Emits **`ClaimCashbackEvent`** (disc `e2d6f62107f293e5`).

Event layout (V1, also current — no V2 variant at the May-21 rollout):

```
disc(8) + user(32) + amount(u64) + timestamp(u64)
       + total_claimed(u64) + total_cashback_earned(u64)
```

The lack of a V2 variant means cashback is **SOL-only** for now. There's no `quote_mint` field; amounts are always in lamports.

## What changes with V2 USDC

Cashback **does not change** with the May-21 V2 rollout. The on-chain semantics:

- USDC-paired coin: trading still accrues volume to the same `UserVolumeAccumulator` PDA.
- Cashback is still paid in **SOL**, not USDC.
- The claim instruction discriminator and event layout are unchanged.

If pump.fun later adds a USDC-denominated cashback variant, expect a V2 `claim_cashback_v2` instruction with a `quote_mint` field. As of writing, it doesn't exist.

## Atomic-toolkit interaction

The atomic toolkit doesn't ship a cashback-claim script — cashback claims are typically one-off and don't have the "racing a sweeper" property that motivates the atomic Jito-bundle patterns.

You can claim cashback via:

- **pump.fun's UI**: easiest. Connect wallet, see claimable balance, click claim.
- **Direct SDK call**: `PUMP_SDK.claimCashbackInstruction({ ... })`. Sign and send normally.

If you want to claim atomically as part of a larger flow (e.g. claim cashback + immediately transfer SOL to a safe wallet, in one bundle), follow the pattern in `src/collect-jito.js` — same idea, different ix.

## Pitfalls

- **Don't expect cashback on USDC trades to be denominated in USDC.** It's SOL. The accrual happens regardless of the trade's quote currency.
- **`UserVolumeAccumulator` is per-user, not per-coin.** Lifetime volume across all pump.fun trading by that wallet, not per-coin volume.
- **Claiming clears the claimable balance, not the lifetime accumulator.** You can claim multiple times as more cashback accrues.
- **Token-2022 trades don't currently accrue cashback** (as of writing). pump.fun coins are SPL Token by default, so this rarely bites — but custom Token-2022 mints traded on PumpSwap pools may behave differently.

## Reading the accumulator

```ts
import { PublicKey } from '@solana/web3.js';
import { PUMP_SDK } from '@nirholas/pump-sdk';

const accumulator = await PUMP_SDK.fetchUserVolumeAccumulator(userPubkey);
console.log({
  totalVolume: accumulator.totalVolume.toString(),
  claimableCashback: accumulator.claimableCashback.toString(),
  totalCashbackEarned: accumulator.totalCashbackEarned.toString(),
});
```

Check `claimableCashback > 0` before issuing a claim. The on-chain ix will succeed with 0 claimable but waste a tx.

## Related concepts

- [creator-fees.md](./creator-fees.md) — the *other* fee on every trade (creator's, not trader's)
- [`../v2-usdc-rollout/02-event-layouts.md`](../v2-usdc-rollout/02-event-layouts.md) — `ClaimCashbackEvent` byte layout
- [Official pump.fun docs](https://github.com/pump-fun/pump-public-docs) — authoritative on the volume formula
