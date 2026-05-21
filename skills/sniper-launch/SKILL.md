---
name: atomic-sniper-launch
description: Use when the user wants to launch a pump.fun coin AND buy a meaningful position in the same atomic Jito bundle, so that no third-party sniper can land between the create tx and the dev-buy. Triggers on "launch with dev buy", "sniper launch", "atomic launch and buy", "MEV-protect my launch", "self-snipe my own coin", "DEV_BUY_SOL", "launch + buy in one bundle", or any request that combines coin creation with an immediate buy. Different from atomic-launch (which is launch-only) and atomic-buy (which is buy-only on an existing coin).
---

# atomic-sniper-launch — atomic launch + dev-buy

The standard `fire-jito.js` flow already supports a same-bundle dev buy via `DEV_BUY_SOL`. This skill is the *strategic* layer: when to use it, what tip values land against sniper bots, how to size the dev buy, and how to detect that you got sniped anyway.

The core insight: pump.fun launches are watched by snipers that wake on the `create` instruction and race to be first into the bonding curve. The only way to guarantee you're first is to be in the same atomic execution as `create` itself. A separate buy tx after `create` — even microseconds later — is racing the sniper at the leader level, not the block engine level, and you will lose more often than not.

## When to use this pattern

| Scenario | Use sniper-launch? |
|---|---|
| Launching a coin you want a position in | **Yes**, almost always |
| Launching a "pure" coin where you don't want a creator pre-buy | No — use [atomic-launch](../launch/SKILL.md) with `DEV_BUY_SOL=0` |
| You expect zero sniper competition (a private launch, no announcement) | Optional — saves a sub-cent of slippage but adds complexity |
| You expect heavy sniper competition (public announcement, "fair launch" theatre) | **Yes, with high tip.** Snipers will land 0.05+ SOL tips |
| You want creator wallet to NOT also be a holder | No — dev-buy goes to creator. Use launch + separate buy from a different wallet via [atomic-buy](../buy/SKILL.md) |
| You want plausible deniability that the creator dev-bought | No — same-bundle dev buy is on-chain forever as the creator's first action |

## The trade-offs

Choosing to dev-buy at launch has costs beyond the SOL spent on the buy itself:

1. **You're visible.** Solscan and pump.fun's UI both surface dev buys prominently. Some markets penalize coins where the creator dev-bought; others reward it as commitment.
2. **You lock liquidity briefly.** The dev-buy SOL goes into the curve immediately; selling it back triggers a price drop visible to others.
3. **Slippage on the dev-buy is real.** At launch, you're buying into a curve with essentially zero depth. Even a small dev-buy moves the price meaningfully.
4. **The tip cost stacks.** A sniper-launch with `JITO_TIP=0.02` and `DEV_BUY_SOL=1` costs 0.02 SOL extra vs a no-tip launch, on top of the 1 SOL buy.

## Sizing the dev buy

Pump.fun bonding curve makes dev-buy size meaningful for both your position and the post-launch price. As a rough guide:

| Dev-buy size | What it signals + market effect |
|---|---|
| `DEV_BUY_SOL=0.1` | Test/cheap. Negligible position, no price effect. Sometimes used to mark a wallet as "creator who at least tried" |
| `DEV_BUY_SOL=0.5` | Small commitment. ~0.5–1% of typical pump.fun graduation supply |
| `DEV_BUY_SOL=1` | Standard creator dev-buy. Visible but not aggressive. Most launches |
| `DEV_BUY_SOL=2–5` | Confident dev-buy. Signals commitment to the coin |
| `DEV_BUY_SOL=5–10` | Aggressive. Often viewed as the creator "rugging up" the price for an immediate sell |
| `DEV_BUY_SOL>10` | Almost always interpreted as a pump-and-dump precursor |

These are not absolute rules — your community's reaction depends on context. But anything over 5 SOL warrants a conscious decision, not autopilot.

## Tip strategy against snipers

The tip you pay determines whether your bundle is selected over a competing sniper's. Snipers run automated tip-escalation; you should expect at least 0.01 SOL of competition at any minimally-publicized launch.

Recommended starting points:

| Launch visibility | Recommended `JITO_TIP` |
|---|---|
| Stealth launch, no public announcement | 0.005 SOL |
| Small community announcement (Discord, Telegram <500) | 0.01 SOL |
| Public Twitter/X announcement >5k followers | 0.02 SOL |
| Pre-announced fair launch with countdown | 0.05 SOL |
| Reposted by major influencer accounts | 0.1 SOL+ — and accept you may still lose |

If your bundle lands but you discover a sniper bought in the *next* slot anyway, that's fine — atomicity only covers your bundle, not the next leader's. The snipe risk you mitigate is the same-block insertion between create and dev-buy. You cannot prevent fast follow-on buys.

## Flow

```bash
URI="https://ipfs.io/ipfs/<CID>" \
NAME="MyCoin" SYMBOL="MEME" \
FUNDER_SECRET=<base58> CREATOR_SECRET=<base58> \
JITO_TIP=0.02 \
DEV_BUY_SOL=1 \
SLIPPAGE_BPS=2000 \
  npm run launch
```

Notes on the env vars beyond the standard launch set:

- `DEV_BUY_SOL` — the position size in SOL.
- `SLIPPAGE_BPS` — pump.fun bonding curve has near-infinite slippage at launch (you're the first buyer). Set high (1000–3000 = 10–30%). The curve will execute close to the floor; high slippage just means you tolerate the unavoidable initial slippage.

## Verifying you weren't sniped

After the bundle lands, immediately check:

```bash
# Did your bundle land first in the slot? Inspect the create tx + buy tx
npx tsx tools/check-bundle-status.ts <bundle-uuid>

# Compare your holdings to the curve's first 1–3 buys
# (use Solscan: pump.fun mint page → "Trades" tab → sort by time ASC)
```

If you see a non-creator buy in the same slot as your `create`, that's a sniper that paid a higher tip than you. Their bundle landed first. Your dev-buy still went through but at a worse price than the floor. Next launch: bump `JITO_TIP` 2–3x.

If you see no non-creator buys in the same slot but heavy buys in slots +1 through +3, that's normal — those are post-launch followers, not snipers you could have prevented.

## Combining with creator-fee strategy

A sniper-launch typically pairs with active creator-fee collection. Plan ahead:

1. Launch with `DEV_BUY_SOL` to establish a position.
2. Start [atomic-watch](../watch/SKILL.md) immediately to harvest creator fees as the coin trades.
3. If the launch was from a shared / leaked key, the watcher race against same-key sweepers begins instantly — see [atomic-leaked-key-response](../leaked-key-response/SKILL.md).
4. When you want out of the position, sell the dev-buy. There is no `sell-jito.js` in this repo as of writing — you can use Jupiter directly or `pump-sdk`'s sell ix. Selling in a Jito bundle protects against MEV on the way out, but the same-bundle insertion risk is lower for sells than for launches.

## Anti-patterns

- **Launching with `DEV_BUY_SOL` from a shared / known wallet.** The dev-buy will be the only tx in the bundle that touches a wallet you care about. Snipers see this and may front-run *follow-on* buys (not the dev-buy itself, but anything you do immediately after) by tagging the creator wallet.
- **Setting `DEV_BUY_SOL` higher than the funder's SOL balance minus tip and rent.** Bundle simulation will pass but the inner tx fails. Always over-provision funder by 0.05 SOL.
- **Tipping below 0.005 on a publicly-announced launch.** Bundle gets outbid; the create tx may still land but the dev-buy may not, leaving the creator buying at a worse price than intended.
- **Re-using a Jito tip account that's been removed upstream.** Check first: `npx tsx tools/check-tip-accounts.ts`.

## Related

- [atomic-launch](../launch/SKILL.md) — launch without dev-buy
- [atomic-buy](../buy/SKILL.md) — buy an existing coin (post-launch)
- [atomic-watch](../watch/SKILL.md) — auto-collect creator fees after a successful launch
- [atomic-bundle-debug](../bundle-debug/SKILL.md) — when the snipe bundle misbehaves
- [atomic-mev-protection](../mev-protection/SKILL.md) — broader MEV threat model
- [tools/check-tip-accounts.ts](../../tools/check-tip-accounts.ts) — verify tip-account list is current
- [tools/check-bundle-status.ts](../../tools/check-bundle-status.ts) — diagnose snipe outcomes
