# Concept deep-dives

Each file in this directory explains one pump.fun protocol concept in depth — what it is, how it works on-chain, and how it interacts with the atomic toolkit's scripts.

These are conceptual references, not tutorials. For step-by-step walkthroughs see [`../../tutorials/`](../../tutorials/). For per-script behavior see [`../scripts/`](../scripts/).

## Index

- [**bonding-curve.md**](./bonding-curve.md) — pre-graduation pricing. The virtual-pool mechanic, price impact, why the curve "completes" at ~$69K.
- [**graduation.md**](./graduation.md) — when and how a coin migrates from the bonding curve to the PumpSwap AMM. The events emitted, the irreversibility.
- [**creator-fees.md**](./creator-fees.md) — what creators earn, where it accumulates, how it's claimed (V1 vs V2).
- [**fee-sharing.md**](./fee-sharing.md) — splitting creator fees across multiple wallets via BPS shareholder configs.
- [**cashback.md**](./cashback.md) — volume-based rebates paid back to traders. SOL-only.
- [**mayhem-mode.md**](./mayhem-mode.md) — the alternative bonding-curve mechanics enabled by the `createV2` instruction's `mayhemMode` flag.

For the 2026-05-21 V2 USDC quote-mint upgrade, see [`../v2-usdc-rollout/`](../v2-usdc-rollout/) — that's a whole reference subset rather than a single concept file.

## Related references

- [Official pump.fun docs](https://github.com/pump-fun/pump-public-docs)
- [`../architecture.md`](../architecture.md) — the funder vs. creator architectural pattern this toolkit revolves around.
- [`../setup.md`](../setup.md) — wallet + RPC setup before any of this matters.
