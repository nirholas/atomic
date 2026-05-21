# Creator fee sharing

A pump.fun creator can opt into **fee sharing** — a config that splits the coin's creator fee across multiple wallets at instruction time. Each shareholder gets a share in basis points (BPS, 10,000 = 100%). The sum must equal 10,000.

This file covers the on-chain mechanism and how the atomic toolkit interacts with it.

## When you'd want it

- **Multi-founder coins.** Two or three people launched together; split fees automatically.
- **Brand + dev split.** Marketing wallet gets 60%, dev wallet gets 40%.
- **Investor revenue share.** Investors who funded the launch get a share of ongoing trading fees.
- **Treasury splits.** Some BPS goes to a public treasury wallet for community-funded operations.

If you don't need any of these, **don't configure fee sharing**. The default (100% to the creator) is simpler. You can always add sharing later via a config update (though pre-V2 the update mechanism is constrained — see below).

## The on-chain account

A `FeeSharingConfig` account is keyed against the coin's mint. It contains:

- An array of shareholders. Each entry is `{ address: Pubkey, shareBps: u16 }`.
- A `total_bps` field equal to the sum of shareholder bps (must be 10,000).
- An admin pubkey that can rotate the config (for V2).

The account is created via the `create_fee_sharing_config` instruction. Without this account existing for a coin, the standard `collect_creator_fee` flow routes 100% to the creator wallet.

## The distribution instructions

- **`distribute_creator_fees`** (V1, disc `a572670079cef751`, Pump program): walks the shareholder array, routes the vault's accumulated fees to each shareholder by their BPS. Emits `DistributeCreatorFeesEvent`.
- **`distribute_creator_fees_v2`** (V2, disc `ffcb134ff444089f`): same but takes a `quote_mint` arg for USDC pairs.
- **`update_fee_shares_v2`** (V2, disc `6ffb31064e4e6a12`, Pump fees program): admin op that updates a fee-sharing config. CPIs into `distribute_creator_fees_v2` internally — fee monitors should match both.
- **`transfer_creator_fees_to_pump`** / **`transfer_creator_fees_to_pump_v2`**: post-graduation AMM-side ix to move accumulated AMM-side fees back into the bonding-curve-style flow (admin-driven, used by pump.fun infra).

## Event byte layouts

`DistributeCreatorFeesEvent` has a **variable-length shareholder vec** in the middle, so the trailing `quote_mint` (V2) sits after the vec, not at a fixed offset. The full byte layout is in [`../v2-usdc-rollout/02-event-layouts.md`](../v2-usdc-rollout/02-event-layouts.md).

Pattern (cribbed from the reference implementation):

```ts
const SHARE_VEC_OFFSET = 8 + 8 + 32 + 32 + 32 + 32; // 144
const shareCount = bytes.readUInt32LE(SHARE_VEC_OFFSET);
const distributedOffset = SHARE_VEC_OFFSET + 4 + shareCount * 34;
const distributed = view.getBigUint64(distributedOffset, true);
// V2 only:
const quoteMint = bytes.length >= distributedOffset + 8 + 32
  ? new PublicKey(bytes.subarray(distributedOffset + 8, distributedOffset + 8 + 32)).toBase58()
  : undefined;
```

The vec walk is **mandatory**. Reading `distributed` from the end of the buffer breaks on V2 because of the appended `quote_mint`.

## Atomic-toolkit interaction

The atomic toolkit doesn't ship a fee-sharing configurator script (see [ROADMAP.md](../../ROADMAP.md) for one planned). For now:

- **Configure via pump.fun's UI** or by hand-calling `create_fee_sharing_config` from your own script.
- **Collect via `collect-jito.js`** — works whether or not fee sharing is configured. If a sharing config exists, the underlying ix routes through `distribute_creator_fees` automatically.
- **Don't `consolidate.js` a fee-shared coin.** That script assumes the creator wallet is the sole fee recipient. Use the per-shareholder claim instead.

## Pitfalls

- **BPS must sum to 10,000.** Off-by-one errors are common. A config with 9,999 or 10,001 BPS reverts at distribution time.
- **All shareholder accounts must exist.** Distribution to a non-existent (rent-exempt) account fails. Pre-create the wallets.
- **Order matters in the vec.** Distribution iterates in the stored order; if you change the order via an update, downstream watchers may misattribute payouts. Treat the order as stable.
- **V2 `update_fee_shares_v2` CPIs into `distribute_creator_fees_v2`.** Fee monitors watching only the outer ix miss admin-driven distributions. Match both discriminators.
- **No BPS > 10,000.** Some libraries silently truncate u16 overflow; verify each share fits.

## Worked example — three-way split

```ts
// Pseudo: not a runnable atomic-toolkit script, just the shape
const shareholders = [
  { address: founderA, shareBps: 5000 },  // 50%
  { address: founderB, shareBps: 3000 },  // 30%
  { address: treasury, shareBps: 2000 },  // 20%
];
// sum = 10000 ✓

const cfgIx = await PUMP_SDK.createFeeSharingConfig({
  mint, shareholders, user: creator.publicKey,
});
```

Then any `collect_creator_fee` / `distribute_creator_fees` call routes per-share automatically.

## When to use fee sharing vs. just sending SOL post-claim

- **Fee sharing** is on-chain, transparent, atomic. Shareholders see their cut hit their wallet in the distribution tx. Use for public, verifiable arrangements.
- **Just sending SOL post-claim** is opaque, requires trust, and is a separate tx. Use when the split is private or expected to change frequently (each change costs gas).

For most public-facing arrangements, fee sharing is the right answer.

## Related concepts

- [creator-fees.md](./creator-fees.md) — the underlying fee mechanism
- [`../v2-usdc-rollout/02-event-layouts.md`](../v2-usdc-rollout/02-event-layouts.md) — `DistributeCreatorFeesEvent` byte layout
- [Official `CREATOR_FEE_SHARING` doc](https://github.com/pump-fun/pump-public-docs/blob/main/docs/instructions/CREATOR_FEE_SHARING.md)
