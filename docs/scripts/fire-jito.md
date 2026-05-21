# fire-jito.js

Launch a pump.fun coin via a **two-tx Jito bundle**. The headline property: Solscan's "from" on the create tx shows the *creator* wallet, because the creator is the fee payer of the actual `createV2` instruction. The funder pays for the bundle's first tx (which seeds the creator and the Jito tip) and is invisible on the create tx itself.

- **Source:** [`src/fire-jito.js`](../../src/fire-jito.js)
- **npm alias:** `npm run launch`
- **Pattern:** two atomic txs in a Jito bundle (see [Architecture → bundle layouts](../architecture.md#bundle-layouts-in-this-repo))

For a simpler single-tx version (no Jito tip, no separate fee-payer dance), see [`fire-atomic-create`](fire-atomic-create.md).

## When to use this

- You want the on-chain creator (the wallet appearing on pump.fun's coin page and on the create tx in Solscan) to be a **different wallet from the one that holds the SOL**.
- You're OK paying a Jito tip (~0.005 SOL) for that.
- You want guaranteed atomicity: either the rent transfer *and* the create both land, or neither does.

If you don't care about the "from" address on the create tx, prefer [`fire-atomic-create`](fire-atomic-create.md) — it's simpler and skips the Jito tip.

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `URI` | **yes** | — | Metadata URI from [`metadata.js`](metadata.md). |
| `NAME` | no | `MyCoin` | Token name. |
| `SYMBOL` | no | `MEME` | Ticker. |
| `FUNDER_SECRET` | **yes** | — | Base58 secret of wallet paying Tx 1 fee, Jito tip, and the rent transfer to the creator. |
| `CREATOR_SECRET` | **yes** | — | Base58 secret of the wallet that becomes the on-chain creator. Signs Tx 2 (`createV2`). |
| `MINT_SECRET` | no | random | Base58 secret of the mint keypair. Set this if you ground a vanity mint with [`grind`](grind.md) or `solana-keygen grind`. |
| `RENT_SOL` | no | `0.035` | SOL the funder transfers to the creator in Tx 1 to cover Tx 2 fees + any rent the create ix needs. |
| `JITO_TIP` | no | `0.005` | SOL paid to a Jito tip account in Tx 1. Bump in busy windows. |
| `PRIORITY` | no | `2000000` | Compute-unit price (micro-lamports) on both txs. |
| `RPC_URL` | no | mainnet-beta | Used only for blockhash + status polling — bundle goes to Jito's endpoint. |

## What it does

1. Loads funder + creator + mint keypairs from env.
2. Checks funder balance ≥ `RENT_SOL + JITO_TIP + 0.002` SOL. Exits if not.
3. Picks a Jito tip account at random from the hardcoded list.
4. Fetches a fresh blockhash. Both txs share this blockhash (required for bundle atomicity).
5. **Builds Tx 1** (funder signs, funder pays): set CU price/limit, transfer `RENT_SOL` to creator, transfer `JITO_TIP` to the tip account.
6. **Builds Tx 2** (creator + mint sign, creator pays): set CU price/limit, run `PUMP_SDK.createV2Instruction({ mint, name, symbol, uri, creator, user: creator, mayhemMode: false, cashback: false })`.
7. Base58-encodes both serialized txs and POSTs `{ method: "sendBundle", params: [[tx1, tx2]] }` to `https://mainnet.block-engine.jito.wtf/api/v1/bundles`.
8. Polls `getSignatureStatuses([sig1, sig2])` every 2 s for up to 60 s.
9. On confirmation, prints the mint address, pump.fun URL, and Solscan URL for the create tx. Exits 0.
10. On timeout, prints the Jito explorer URL for the bundle and exits 1.

## Example

```bash
URI=https://ipfs.io/ipfs/Qm… \
NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
JITO_TIP=0.005 \
npm run launch
```

Output (truncated):

```
Funder (pays Tx1 + tip): 7d9V…3rUf
Creator (pays Tx2):      9aPq…Yz1k
Mint:                    HxYr…vLkN
Jito tip: 0.005 SOL  |  Rent funding: 0.035 SOL
Funder balance: 0.3 SOL
Tx1 size: 235 | Tx2 size: 678
Submitting bundle to Jito Block Engine...
Bundle ID: c1a2…
Tx1 sig: 4Sv…
Tx2 sig: 9Lk…
  poll 3: tx1=confirmed tx2=confirmed
LAUNCHED.
Mint:    HxYr…vLkN
Pump URL: https://pump.fun/coin/HxYr…vLkN
Create tx: https://solscan.io/tx/9Lk…
```

## Verifying the result

After the bundle lands:

- Pump.fun shows the coin page at `https://pump.fun/coin/<mint>`.
- Solscan's create-tx page lists the **creator wallet** as "Fee Payer" / "Signer" — confirming the bundle ordering worked.
- The funder wallet is *not* a signer on the create tx; it only appears on Tx 1.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Missing URI` | Forgot `metadata.js`. | Run [`metadata.js`](metadata.md) first; pass its stdout as `URI`. |
| `Funder needs >= X SOL` | Funder under-funded. | Top up to ≥ `RENT_SOL + JITO_TIP + 0.002`. |
| `Bundle submit failed: …` (with `error` field) | Jito rejected the bundle synchronously — usually a tip-account problem. | See [Setup → Jito tip-account refresh](../setup.md#tip-account-refresh). |
| `Bundle not confirmed in 60s` | Bundle accepted but didn't land. | Tip too low (most common) or blockhash expired. Re-run with a higher `JITO_TIP`. Inspect at `explorer.jito.wtf/bundle/<id>`. |
| Tx 2 errors `Custom program error: 0x…` | pump-sdk version drift; the live program added a required account the SDK doesn't pass. | Upgrade `@nirholas/pump-sdk` in `package.json`. As a workaround: use [`fire-atomic-create`](fire-atomic-create.md), which has the same risk but without the Jito tip cost while you debug. |

## Notes

- The mint keypair is single-use. Once a mint is created, that keypair is no longer needed for anything (pump.fun handles ownership via PDAs). The script doesn't write `MINT_SECRET` anywhere on disk; if you supplied one, *you* are responsible for keeping it.
- The script generates a fresh mint if `MINT_SECRET` is unset. This is fine for almost every use case. Use vanity mints sparingly — they're a "look cool" feature that costs you compute.
- `mayhemMode: false, cashback: false` are pump.fun feature flags hardcoded off. If pump.fun adds new launch modes, update [`src/fire-jito.js`](../../src/fire-jito.js).
- Compute budget: 1,000 CU on Tx 1 (just transfers) and 300,000 CU on Tx 2 (`createV2` is heavy). Increase Tx 2's limit if the program upgrade ever pushes it over.
