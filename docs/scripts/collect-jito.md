# collect-jito.js

Atomically drain the creator-fee vault for a pump.fun coin into a safe destination wallet, in **one** Jito-bundled transaction. The headline property: the creator wallet never holds the collected SOL even for one slot, so a sweeper bot watching the creator key has no opportunity to race the collect with its own drain tx.

- **Source:** [`src/collect-jito.js`](../../src/collect-jito.js)
- **npm alias:** `npm run collect`
- **Pattern:** single tx in a Jito bundle, with two signers (funder + creator)

For continuous auto-collect, wrap this in [`watch-collect`](watch-collect.md). For a one-time end-of-life sweep that also drains the funder and creator wallets, use [`consolidate`](consolidate.md).

## When to use this

- You launched a coin with a **shared or leaked** creator key and want to claim creator fees without a sweeper-bot race.
- You want all collected SOL to end up in a different wallet (`DESTINATION`) immediately, not pile up in the creator wallet.
- You're OK paying ~0.005 SOL per collect as a Jito tip.

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `FUNDER_SECRET` | **yes** | — | Base58 secret. Pays the tx fee, the Jito tip, and any internal ATA rent the collect ix needs. |
| `CREATOR_SECRET` | **yes** | — | Base58 secret of the coin's creator. Signs `collectCoinCreatorFee` and the drain transfer. |
| `DESTINATION` | **yes** | — | Pubkey (not secret) where the collected SOL lands. |
| `JITO_TIP` | no | `0.005` | SOL paid to a Jito tip account. |
| `PRIORITY` | no | `3000000` | Compute-unit price (micro-lamports). |
| `BUFFER_LAMPORTS` | no | `890880` | Lamports to leave in the creator wallet. Default is the rent-exempt minimum for a system account, so the creator wallet stays open. |
| `RPC_URL` | no | mainnet-beta | Used for blockhash + vault balance read + status polling. |

## What it does

1. Connects to the RPC, builds an `OnlinePumpSdk` against it.
2. Reads the creator-vault balance via `sdk.getCreatorVaultBalance(creator.publicKey)`. Exits if vault < 0.001 SOL.
3. Reads the creator wallet's current SOL balance.
4. Computes `transferAmount = creatorPreBal + vaultLamports - BUFFER_LAMPORTS` — how much SOL the drain transfer will move out of the creator wallet *after* the vault is collected into it.
5. Verifies funder balance ≥ `JITO_TIP + 0.002` SOL.
6. Picks a Jito tip account at random.
7. Builds the tx (single signer = funder pays fee, plus creator as co-signer):
   - `setComputeUnitPrice` / `setComputeUnitLimit(100000)`
   - `SystemProgram.transfer(funder → tipAccount, JITO_TIP)`
   - `...sdk.collectCoinCreatorFeeInstructions(creator.publicKey, funder.publicKey)` — drains vault to creator, with funder paying any ATA rents
   - `SystemProgram.transfer(creator → DESTINATION, transferAmount)`
8. Runs `simulateTransaction`; on failure, prints logs and exits.
9. Submits as a one-tx Jito bundle.
10. Polls `getSignatureStatuses` every 2 s for up to 60 s. On confirmation, prints destination balance and Solscan URL.

## Example

```bash
DESTINATION=<base58 pubkey> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
npm run collect
```

Output:

```
Funder (fee payer + tip): 7d9V…3rUf
Leaked (collector):       9aPq…Yz1k
Destination:              7yYx…Mq8P
Vault balance: 0.142 SOL
Will transfer out: 0.13911 SOL (leaving 0.00089 SOL buffer)
Collect ixs: 3
Blockhash: HtY…
Tx size: 612 bytes (limit 1232)
Simulating...
Sim OK. CU: 84211
Submitting Jito bundle...
Bundle ID: a4f2…
Tx sig: 7Pk…
  poll 2: confirmed
CONFIRMED.
Destination balance: 0.31 SOL
Solscan: https://solscan.io/tx/7Pk…
```

## Why "atomic" matters here

A naive collect would look like:

1. Send a tx that calls `collectCoinCreatorFee`. SOL lands in the creator wallet.
2. Send a second tx transferring SOL from creator to destination.

Between (1) and (2), the creator wallet briefly holds the SOL. If its private key is public, a sweeper bot will see the balance increase and submit its own drain tx in parallel — racing yours, and typically winning because it pays an aggressive priority fee + Jito tip.

`collect-jito` collapses both steps into one tx. Either every instruction executes in order and lands in the same slot, or none of them do. There is no point in time on-chain where the creator holds the SOL and the destination doesn't.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Vault too small to bother. Aborting.` | Vault < 0.001 SOL — collect tip would cost more than you'd recover. | Wait for fees to accumulate, or override the 0.001 threshold by editing the script. |
| `Funder needs ≥ X SOL` | Funder under-funded for tip + fee. | Top up. ~0.01 SOL is plenty per collect. |
| `Sim failed: …` | Usually a pump-sdk drift (program added a required account). | Upgrade `@nirholas/pump-sdk`. |
| `Bundle submit failed.` | Jito-side rejection (bad tip account, malformed bundle). | See [Setup → Jito tip-account refresh](../setup.md#tip-account-refresh). |
| `Timeout` after 60 s | Bundle accepted but didn't land. | Tip too low. Bump `JITO_TIP` and re-run. |

## Notes

- The drain transfer pulls from the creator wallet **after** the vault collect has already executed in the same tx. The lamport math (`creatorPreBal + vaultLamports - BUFFER_LAMPORTS`) accounts for both: any existing balance on the creator wallet plus the freshly collected vault.
- `BUFFER_LAMPORTS` defaults to 890,880 — the rent-exempt minimum for a system account. If you leave less, the wallet would close and you'd lose the ATA addresses. Leave the default unless you have a specific reason.
- The funder is *not* drained by this script. To drain the funder too, use [`consolidate`](consolidate.md).
- Inside the bundle, only the funder's tip transfer and the collect/drain are present — the bundle is a single tx. The "Jito bundle" aspect here is purely about submission path + tip auction, not about multi-tx atomicity.
