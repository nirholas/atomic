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
| `MINTS` | recommended | none | Comma- or space-separated mints this creator launched. Creator fees the new trade instructions left waiting on each coin's bonding curve or PumpSwap pool are swept into the creator vaults in the same tx before the collect. Without it, only fees already in the vaults are collected. `MINT` is accepted for a single coin. |
| `JITO_TIP` | no | `0.005` | SOL paid to a Jito tip account. |
| `PRIORITY` | no | `3000000` | Compute-unit price (micro-lamports). |
| `BUFFER_LAMPORTS` | no | `890880` | Lamports to leave in the creator wallet. Default is the rent-exempt minimum for a system account, so the creator wallet stays open. |
| `RPC_URL` | no | mainnet-beta | Used for blockhash + vault balance read + status polling. |

## What it does

1. Connects to the RPC, builds an `OnlinePumpSdk` against it.
2. Reads the creator-vault balance via `sdk.getCreatorVaultBalance(creator.publicKey)`.
3. For every coin in `MINTS`, reads the creator fee waiting on its bonding curve (`BondingCurve.creator_fee`) and on its canonical SOL pool (`Pool.creator_fees`), and prints what it found and why any coin is skipped (no curve, not SOL-paired, a different creator, or a pool whose coin creator was moved). `vaultLamports` is the vault balance plus the curve fees about to be swept. Exits if that is < 0.001 SOL.
4. Reads the creator wallet's current SOL balance.
5. Computes `transferAmount = creatorPreBal + vaultLamports - BUFFER_LAMPORTS`: how much SOL the drain transfer will move out of the creator wallet *after* the vault is collected into it.
6. Verifies funder balance ≥ `JITO_TIP + 0.002` SOL.
7. Picks a Jito tip account at random.
8. Builds the tx (single signer = funder pays fee, plus creator as co-signer):
   - `setComputeUnitPrice` / `setComputeUnitLimit(100000 + 40000 per sweep)`
   - `SystemProgram.transfer(funder → tipAccount, JITO_TIP)`
   - one `PUMP_SDK.sweepCreatorFeeInstruction` per coin with a curve fee waiting and one `PUMP_SDK.sweepPoolCreatorFeeInstruction` per coin with a pool fee waiting, all paid by the funder (see [`src/lib/creator-fee-sweep.js`](../../src/lib/creator-fee-sweep.js))
   - `...sdk.collectCoinCreatorFeeInstructions(creator.publicKey, funder.publicKey)`: drains vault to creator, with funder paying any ATA rents
   - `SystemProgram.transfer(creator → DESTINATION, transferAmount)`
9. Runs `simulateTransaction`; on failure, prints logs and exits.
10. Submits as a one-tx Jito bundle.
11. Polls `getSignatureStatuses` every 2 s for up to 60 s. On confirmation, prints destination balance and Solscan URL.

## Example

```bash
DESTINATION=<base58 pubkey> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
MINTS=<mint1>,<mint2> \
npm run collect
```

Output:

```
Funder (fee payer + tip): 7d9V…3rUf
Leaked (collector):       9aPq…Yz1k
Destination:              7yYx…Mq8P
Vault balance: 0.142 SOL
Waiting on coins:
  4rTq…pump: 0.018 SOL waiting on the curve, 0 SOL waiting in the pool
Collectable now: 0.16 SOL
Will transfer out: 0.15911 SOL (leaving 0.00089 SOL buffer)
Sweep ixs: 1 | Collect ixs: 3
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
| Destination received less than the fees shown on pump.fun | `MINTS` not set, so fees from the new trade instructions are still waiting on the curve or pool. | Set `MINTS` to the creator's coins and re-run. |
| `Vault too small to bother. Aborting.` | Vault < 0.001 SOL — collect tip would cost more than you'd recover. | Wait for fees to accumulate, or override the 0.001 threshold by editing the script. |
| `Funder needs ≥ X SOL` | Funder under-funded for tip + fee. | Top up. ~0.01 SOL is plenty per collect. |
| `Sim failed: …` | Usually a pump-sdk drift (program added a required account). | Upgrade `@pump-fun/pump-sdk`. |
| `Bundle submit failed.` | Jito-side rejection (bad tip account, malformed bundle). | See [Setup → Jito tip-account refresh](../setup.md#tip-account-refresh). |
| `Timeout` after 60 s | Bundle accepted but didn't land. | Tip too low. Bump `JITO_TIP` and re-run. |

## Notes

- **Why the sweep.** Since the October 2026 Pump upgrade, trades through the new instructions (Pump `buy_v3` / `sell_v3`, PumpSwap `buy_v2` / `sell_v2`, `multi_hop_swap`) leave the creator fee on the coin's bonding curve or pool instead of paying the vault. The permissionless `sweep_creator_fee` moves it into the vault. A collect without the sweep does not fail; it simply leaves those fees behind, which is why the sweeps run first in the same tx.
- **Pool fees arrive as wrapped SOL.** A pool sweep moves wSOL into the PumpSwap creator vault, and the collect pays it to the creator's wSOL token account (the account is only unwrapped when the creator also pays the tx). The lamport drain therefore counts only the bonding-curve vault and curve fees; pool fees stay as wSOL on the creator.
- The drain transfer pulls from the creator wallet **after** the vault collect has already executed in the same tx. The lamport math (`creatorPreBal + vaultLamports - BUFFER_LAMPORTS`) accounts for both: any existing balance on the creator wallet plus the freshly collected vault.
- `BUFFER_LAMPORTS` defaults to 890,880 — the rent-exempt minimum for a system account. If you leave less, the wallet would close and you'd lose the ATA addresses. Leave the default unless you have a specific reason.
- The funder is *not* drained by this script. To drain the funder too, use [`consolidate`](consolidate.md).
- Inside the bundle, only the funder's tip transfer and the collect/drain are present — the bundle is a single tx. The "Jito bundle" aspect here is purely about submission path + tip auction, not about multi-tx atomicity.
