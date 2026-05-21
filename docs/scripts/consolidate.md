# consolidate.js

One-shot end-of-life sweep. In a single atomic Jito-bundled transaction:

1. Collects the creator-fee vault into the creator wallet.
2. Drains the creator wallet (vault + any pre-existing balance) to `DESTINATION`, leaving the rent-exempt minimum.
3. Drains the funder wallet to `DESTINATION`, leaving a small operating buffer.

Use this when you're done with a coin and want all SOL on a single safe wallet, with no possibility of a sweeper-bot insertion between the three steps.

- **Source:** [`src/consolidate.js`](../../src/consolidate.js)
- **npm alias:** `npm run consolidate`
- **Pattern:** single tx in a Jito bundle, two signers (funder + creator)

For repeated automated collects without draining the funder, use [`collect-jito`](collect-jito.md) or [`watch-collect`](watch-collect.md).

## When to use this

- You've stopped actively running fee collection and want to consolidate everything in one go.
- You want the funder wallet drained too (e.g. it's a leaked or one-off launch funder, not a permanent operational wallet).
- You want a single atomic operation so no sweeper bot can race any of the intermediate states.

## Environment

| Var | Required | Default | Notes |
|---|---|---|---|
| `FUNDER_SECRET` | **yes** | — | Signs Tx, pays fee + Jito tip, *and* is itself drained at the end. |
| `CREATOR_SECRET` | **yes** | — | Signs `collectCoinCreatorFee` and the creator-drain transfer. |
| `DESTINATION` | **yes** | — | Pubkey where everything lands. |
| `JITO_TIP` | no | `0.005` | SOL. |
| `PRIORITY` | no | `2000000` | Compute-unit price. |
| `RPC_URL` | no | mainnet-beta | |

Two hardcoded buffers inside [`src/consolidate.js`](../../src/consolidate.js) that you can edit if you need:

- `CREATOR_BUFFER = 890_880` lamports — leaves the rent-exempt minimum in the creator wallet so it stays open.
- `FUNDER_BUFFER = 5_000_000` lamports (0.005 SOL) — extra room for any unexpected ATA rents the collect ix consumes.

## What it does

1. Reads vault balance, funder balance, creator balance.
2. Computes drain amounts:
   - `funderDrain = funderBal - tip - txFee - FUNDER_BUFFER`
   - `creatorDrain = creatorBal + vaultBal - CREATOR_BUFFER`
3. Exits if `funderDrain <= 0` (funder can't even cover tip+fees).
4. Picks a Jito tip account at random.
5. Builds one tx with these ixs:
   - `setComputeUnitPrice` / `setComputeUnitLimit(100000)`
   - `SystemProgram.transfer(funder → tipAccount, JITO_TIP)`
   - `...sdk.collectCoinCreatorFeeInstructions(creator, funder)`
   - `SystemProgram.transfer(creator → DESTINATION, creatorDrain)`
   - `SystemProgram.transfer(funder → DESTINATION, funderDrain)`
6. Tx is signed by funder + creator; funder pays fee.
7. Simulates first; on failure prints logs and exits.
8. Submits as a one-tx Jito bundle and polls for confirmation up to 60 s.

## Example

```bash
DESTINATION=<base58 pubkey> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
JITO_TIP=0.01 \
npm run consolidate
```

Output:

```
Funder: 7d9V…3rUf
Leaked: 9aPq…Yz1k
Destination: 7yYx…Mq8P

Vault:   0.42 SOL
Funder:  0.31 SOL
Leaked:  0.00089 SOL  (rent-exempt floor)

Funder drain to dest: 0.295 SOL
Leaked drain to dest: 0.4200111 SOL
Total moved to dest: ~ 0.7150111 SOL

Tx size: 689 bytes
Simulating...
Sim OK. CU: 81023

Submitting Jito bundle...
Bundle ID: bbc5…
  poll 4: confirmed
CONFIRMED.
Dest balance: 1.214 SOL
Solscan: https://solscan.io/tx/9Pd…
```

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Funder doesn't have enough for tip + fees.` | Funder balance below `JITO_TIP + 0.005 + tx_fee + FUNDER_BUFFER`. | Top up the funder, then re-run. |
| `Sim failed: …` with `InsufficientFunds` log | One of the drains is too aggressive (probably because the actual ATA rent during collect exceeded `FUNDER_BUFFER`). | Bump `FUNDER_BUFFER` in [`src/consolidate.js`](../../src/consolidate.js). |
| `Bundle submit failed` / `Timeout` | Same as other Jito scripts. | See [Setup → Jito](../setup.md#jito-tip-sizing-and-tip-account-refresh). |

## Notes

- The creator wallet ends with exactly the rent-exempt minimum (~0.00089 SOL) — *not* zero. This is deliberate: a closed wallet means its ATAs (if any) need to be rebuilt. Costs you a fraction of a cent in retained rent vs. surprise rebuilds.
- The funder wallet ends with ~0.005 SOL. If you want it fully empty, run a second `SystemProgram.transfer` from another wallet you control later (the ~0.005 doesn't earn anyone anything, but it's a deliberate buffer against the collect ix consuming slightly more than expected).
- Use this *once* per coin session. For continuous collection, use [`watch-collect`](watch-collect.md) — it only drains the creator vault, not the funder.
- All the same Jito caveats apply: tip too low → bundle doesn't land; tip-account rotation → bundle rejected.
