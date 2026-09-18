# Holder rewards

Holder rewards are a pump.fun launch mode introduced with the Pump program 2.0 upgrade. A holder-reward coin has no creator wallet collecting its fees: the creator recorded on the bonding curve is a program-derived address, `holderRewardsPda(mint)`, and pump.fun pays the accumulated creator fees out to the coin's token holders.

It is also the replacement for cashback on new coins. `create_v2` rejects new cashback coins with error 6082, and `@nirholas/pump-sdk` 2 throws `CashbackDeprecatedError` before it builds such an instruction. See [cashback.md](./cashback.md) for what still works on existing cashback coins.

## On-chain shape

| Piece | Value |
|---|---|
| Launch flag | `create_v2` argument `is_holder_reward` (the IDL's `OptionBool`, one trailing byte) |
| Creator recorded on the curve | `holderRewardsPda(mint)`, seeds `["holder-rewards", mint]` under the Pump program |
| Creator vault | `creatorVaultPda(holderRewardsPda(mint))` |
| Payout instruction | `distribute_fee_to_holders`, signed by `Global.holderRewardClaimAuthority` |
| Program switch | `Global.isHolderRewardEnabled`; `create_v2` fails with 6084 while it is `false` |
| Curve flag | `BondingCurve.isHolderReward` |

Because the payout is signed by pump.fun's claim authority, the launcher's creator wallet cannot collect or redirect these fees. That is the point of the mode, and it is why [`collect-jito.js`](../scripts/collect-jito.md) has nothing to claim for such a coin.

## Launching one with this toolkit

Both launchers take `HOLDER_REWARD`:

```bash
URI=https://ipfs.io/ipfs/<CID> NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=<base58> CREATOR_SECRET=<base58> \
HOLDER_REWARD=true \
npm run launch
```

What the script does differently:

1. [`src/lib/launch-options.js`](../../src/lib/launch-options.js) parses `HOLDER_REWARD` strictly (a typo such as `ture` stops the script instead of launching the wrong kind of coin) and rejects `CASHBACK=true`.
2. Before any transaction is built, it reads the Pump `Global` account and stops if `isHolderRewardEnabled` is `false`, so no Jito tip or fee is spent on a create that would fail with 6084.
3. It logs where creator fees will accrue: the holder rewards PDA rather than the creator wallet.
4. `PUMP_SDK.createV2Instruction` is called with `holderReward: true`.

For a launch with a dev buy in the same transaction, `OnlinePumpSdk.createV2AndBuyInstructions({ ..., holderReward: true })` does the Global check itself (throwing `HolderRewardDisabledError`) and routes the buy's creator vault to the holder rewards PDA. [`examples/02-launch-with-dev-buy.js`](../../examples/02-launch-with-dev-buy.js) uses it.

## Checking a coin

Read-only; needs only an RPC URL:

```js
const { Connection, PublicKey } = require('@solana/web3.js');
const { OnlinePumpSdk, holderRewardsPda } = require('@nirholas/pump-sdk');

(async () => {
  const sdk = new OnlinePumpSdk(new Connection(process.env.RPC_URL, 'confirmed'));
  const mint = new PublicKey(process.env.MINT);
  const [global, curve] = await Promise.all([sdk.fetchGlobal(), sdk.fetchBondingCurve(mint)]);
  console.log({
    holderRewardsEnabled: global.isHolderRewardEnabled,
    isHolderReward: curve.isHolderReward,
    creator: curve.creator.toBase58(),
    holderRewardsPda: holderRewardsPda(mint).toBase58(),
  });
})();
```

For a holder-reward coin, `creator` equals `holderRewardsPda`.

## Related

- [creator-fees.md](./creator-fees.md): where fees accrue for standard coins.
- [cashback.md](./cashback.md): the retired trader-rebate launch mode.
- [`docs/scripts/fire-jito.md`](../scripts/fire-jito.md) and [`docs/scripts/fire-atomic-create.md`](../scripts/fire-atomic-create.md): the launchers.
