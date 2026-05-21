# 03 — Buy via Jupiter inside a Jito bundle

The default way to buy a pump.fun coin is the SDK's `buy` instruction. That works until pump.fun ships a program upgrade that adds required accounts (e.g. `BuybackFeeRecipient` in the V2 USDC rollout) and your local SDK lags behind. At that point, every direct buy fails with `MissingAccount` and you need a path around the drift.

`buy-jito.js` solves this by routing the buy through Jupiter (which always tracks the live program) and wrapping it in a Jito bundle so the buy + tip land atomically — useful for MEV protection on fresh launches too.

## When to use this vs the pump-sdk direct buy

| Situation | Use |
|---|---|
| pump-sdk version matches the live program | pump-sdk `buy` ix (cheaper, no Jupiter slippage) |
| pump-sdk is lagging the program | **`buy-jito.js` (Jupiter)** |
| Buying into a leaked/shared wallet | `buy-jito.js` + immediate `rescue-tokens.js` chain — see [tutorial 04](./04-rescue-tokens-leaked-key.md) |
| Sniping at launch with MEV protection | `buy-jito.js` with high `JITO_TIP` |

## Prerequisites

- The mint address of the token you want to buy (`TARGET_MINT`).
- A funder wallet with enough SOL: `BUY_SOL + JITO_TIP + tx_fee + ATA rent` (~0.003 buffer is plenty).
- An RPC endpoint. Jupiter quote uses its own endpoint internally; tx submission goes through your `RPC_URL` / Jito.

## Step 1 — Basic buy

```bash
cd tmp/leaked-launch

TARGET_MINT=<base58-mint> \
BUY_SOL=0.01 \
SLIPPAGE_BPS=500 \
FUNDER_SECRET=<base58> \
JITO_TIP=0.005 \
  node buy-jito.js
```

`SLIPPAGE_BPS=500` means 5% slippage tolerance.

Expected output:

```
Jupiter quote: 0.01 SOL → 12,345.67 TOKEN (price impact 0.4%)
Bundle submitted: <bundle-id>
Bundle landed in slot <N>
Tokens received: 12,287 TOKEN (within slippage)
ATA: <token-account-address>
```

## Step 2 — Tune for the pool

| Pool type | Recommended `SLIPPAGE_BPS` |
|---|---|
| Stable, mature pool (>$100k MC) | 100–200 (1–2%) |
| Active pump.fun pool | 300–500 (3–5%) |
| Fresh launch (<2 min old) | 1000+ (10%+) |

For fresh launches: also bump `JITO_TIP` to 0.02+ — competition for early slots is fierce.

## Step 3 — Verify on chain

Click the bundle's Solscan link from the output. You should see:

- Tx1 (or Tx0): Jito tip transfer.
- Tx2: Jupiter route swap landing tokens in your ATA.

If your wallet didn't previously hold this token, the ATA is created in the same tx — small rent fee (~0.002 SOL) is included automatically.

## Env var reference

| Var | Required | Default | Notes |
|---|---|---|---|
| `RPC_URL` | yes | — | Helius/Triton preferred |
| `TARGET_MINT` | yes | — | base58 mint address |
| `BUY_SOL` | yes | — | SOL to spend |
| `SLIPPAGE_BPS` | yes | — | Jupiter slippage. 500 = 5% |
| `FUNDER_SECRET` | yes | — | base58 secret. **This wallet receives the tokens** despite the name |
| `JITO_TIP` | no | 0.005 | SOL. Bump for hot launches |

## Gotchas

- **`FUNDER_SECRET` is the buyer here.** Despite the name carried over from the launch scripts, the funder wallet in this script is both the payer *and* the recipient of the tokens. If that wallet is leaked or shared, the tokens will be drained by sweepers within ~3 s. Either buy to a wallet you control alone, or chain with [tutorial 04](./04-rescue-tokens-leaked-key.md) for atomic buy-and-transfer.
- **Quote staleness.** Jupiter quote → tx build → bundle submit takes 1–2 s end to end. On fresh-launch pools the price can move past your slippage in that window. Either raise `SLIPPAGE_BPS` or accept that some bundles will revert with `SlippageExceeded`.
- **Jito tip floor.** 0.001 SOL is the documented floor but rarely lands during active hours. Start at 0.005; bump to 0.02+ for hot launches. If bundles return `Invalid`, tip is almost always the issue.
- **V2 USDC pools.** Buy routing changed for V2-USDC quote-mint coins. Jupiter handles the routing transparently, but if you're modifying this script directly, read `docs/v2-usdc-rollout/` first.
- **Rate limits on Jupiter quote API.** Public Jupiter quote endpoint rate-limits aggressively under burst loads (sniper bots hammering at launch). Use the paid tier or a self-hosted Jupiter API for any production sniping setup.

## Security

The buyer secret (`FUNDER_SECRET` here) holds the tokens after the buy. **If that wallet is leaked, the tokens are gone within seconds of confirmation.** Always buy to a wallet you control alone, or chain the buy with an atomic transfer ([tutorial 04](./04-rescue-tokens-leaked-key.md)).

## Next steps

- **Need to also defend a leaked buyer wallet?** Chain this with [tutorial 04 — Rescue tokens](./04-rescue-tokens-leaked-key.md). The pattern is: `buy-jito.js` to land tokens, then `rescue-tokens.js` immediately. For true atomicity (no window between buy and rescue), you'd need a custom variant that combines both into one bundle — open issue, not yet built.
