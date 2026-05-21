# Transaction size budget

Why a pump.fun create transaction barely fits, why this forces the funder/creator split into a Jito bundle, and how to count bytes when you add an instruction.

If you have ever read "tx too large" and wondered which account to drop, this page is for you.

---

## The 1232-byte hard limit

Solana enforces a **1232-byte maximum** on the serialized form of any transaction. The limit comes from the underlying packet MTU (1280 bytes IPv6 minus protocol overhead); it is not a configuration value, it is a wire-format constraint of the cluster.

A tx that exceeds 1232 bytes does not split, does not fragment, and cannot be sent. The RPC will reject it before broadcast with `Transaction too large`. You cannot raise this limit, ever.

Implications:

- **Number of accounts you can reference is bounded.** Each account in the message takes 32 bytes; ~30 accounts is the practical max.
- **Number of signatures you can include is bounded.** Each signature is 64 bytes plus a public key reference.
- **Instruction data sums.** The more bytes of input each program needs, the fewer instructions and accounts you can pack.

---

## Byte accounting

A transaction's serialized form looks like:

```
[signatures]          1 + 64 × N_sigs bytes
[message header]      3 bytes (numRequiredSigs, numReadonlySigned, numReadonlyUnsigned)
[account list]        1 + 32 × N_accounts bytes
[recent blockhash]    32 bytes
[instructions]        1 + sum(per-instruction bytes)
```

Per instruction:

```
[program ID index]    1 byte
[account index count] 1 byte
[account indices]     1 byte per referenced account
[data length]         1–3 bytes (compact-u16)
[data]                N bytes (instruction-specific)
```

Fixed overhead (1 signer, no instructions): about 100 bytes.

### A worked example: `createV2`

The pump.fun `createV2` instruction (mint a new bonding-curve coin) takes the following accounts:

| # | Account | Role | Bytes |
|---|---|---|---|
| 1 | mint | writable, signer | 32 |
| 2 | mintAuthority | readonly | 32 |
| 3 | bondingCurve | writable | 32 |
| 4 | associatedBondingCurve | writable | 32 |
| 5 | global | readonly | 32 |
| 6 | mplTokenMetadata | readonly | 32 |
| 7 | metadata | writable | 32 |
| 8 | user (creator) | writable, signer | 32 |
| 9 | systemProgram | readonly | 32 |
| 10 | tokenProgram | readonly | 32 |
| 11 | associatedTokenProgram | readonly | 32 |
| 12 | rent | readonly | 32 |
| 13 | eventAuthority | readonly | 32 |
| 14 | program | readonly | 32 |

14 accounts × 32 = **448 bytes** just for the account list. Add the instruction data (name + symbol + uri + creator = roughly 8 + name_len + 8 + symbol_len + 8 + uri_len + 32 = 80–150 bytes depending on URI length), the signatures (creator = signer, mint = signer = 2 × 64 = 128 bytes), the blockhash (32 bytes), and the rest of the message overhead, and you are at **~750–820 bytes** for a *bare* createV2 with no extras.

That leaves ~400 bytes of headroom for additional instructions.

### What eats the headroom

If you want the createV2 tx to *also*:

- Set a compute unit price (`SetComputeUnitPrice`, ~9 bytes + 1 account)
- Set a compute unit limit (`SetComputeUnitLimit`, ~9 bytes + 1 account)
- Pre-transfer rent SOL to the creator wallet (`SystemProgram.transfer`, ~12 bytes + 2 accounts × 32 = 76 bytes net)
- Pay a Jito tip (`SystemProgram.transfer`, another ~76 bytes)
- Do an initial dev-buy (`buy` instruction, ~12 more accounts × 32 = 384 bytes)

You will run out of room. The dev-buy alone almost certainly pushes you past 1232.

**This is the root reason for the funder/creator split.** Putting "give the creator rent SOL" in a separate tx from the createV2 itself buys you back the 76 bytes of the transfer instruction plus the account-list overhead, and lets each tx focus on one concern.

---

## How the toolkit budgets each tx

### `fire-jito.js` — two-tx bundle

**Tx 1 (funder-paid, funder signs):**
```
SetComputeUnitPrice          ~10 bytes
SetComputeUnitLimit          ~10 bytes
SystemProgram.transfer       FUNDER → CREATOR  rent SOL (~76 bytes)
SystemProgram.transfer       FUNDER → tipAccount  JITO_TIP (~76 bytes)
```
Total: ~250 bytes. Headroom: ~980 bytes. Why so light? So you can add more here (e.g. extra pre-funding, multiple tip accounts) without overflowing.

**Tx 2 (creator-paid, creator + mint sign):**
```
SetComputeUnitPrice          ~10 bytes
SetComputeUnitLimit          ~10 bytes
pump.fun createV2            ~450 bytes account list + ~120 bytes data
[optional] pump.fun buy      ~400 bytes (initial dev-buy, see below)
```
With both createV2 + buy: ~990 bytes. **Without** the dev-buy: ~600 bytes. The dev-buy is what makes the tx tight. If you raise `DEV_BUY_SOL`, the *value* changes but the byte count does not — what matters is the buy instruction's account list, which is fixed.

### `fire-atomic-create.js` — single-tx launch

Everything in one tx, funder is fee payer:

```
SetComputeUnitPrice + Limit  ~20 bytes
pump.fun createV2            ~570 bytes (incl. data)
SystemProgram.transfer       funder → creator (rent, ~76 bytes)
```

Total: ~700 bytes. Fits easily because there's no dev-buy. If you want a dev-buy in a single-tx launch, you have to use [`buy-jito.js`](scripts/buy-jito.md) separately or accept the Jito-bundle launch.

### `collect-jito.js` — single-tx collect bundle

```
SetComputeUnitPrice + Limit  ~20 bytes
pump.fun collectCoinCreatorFee  ~350 bytes (10 accounts + small data)
SystemProgram.transfer       creator → destination  (~76 bytes)
SystemProgram.transfer       funder → tipAccount  (JITO_TIP, ~76 bytes)
```

Total: ~550 bytes. Comfortable.

---

## Address Lookup Tables (ALTs)

ALTs (`AddressLookupTable` program) let you reference accounts via a 1-byte index into an on-chain table instead of inlining the 32-byte pubkey. They are how most production Solana programs scale beyond ~20 accounts per tx.

**The toolkit does not currently use ALTs.** Why:

1. **The pump.fun program does not publish a canonical ALT.** You would have to maintain your own ALT keyed on the recipients/fees, and refresh it when those change.
2. **The biggest single tx (createV2 with dev-buy) is ~990 bytes — it fits without ALTs.** ALTs would shave 200–300 bytes but no instruction currently needs that headroom.
3. **ALTs require an extra confirmation step.** Creating an ALT, waiting one slot for activation, then using it adds complexity for marginal benefit.

If pump.fun's account list grows (e.g. V3 adds quote-mint accounts), revisit ALTs first — they buy you the most headroom for the least disruption to script structure.

To use an ALT later:

```javascript
import { TransactionMessage, VersionedTransaction, AddressLookupTableProgram } from "@solana/web3.js";

const lookupTableAccount = (await connection.getAddressLookupTable(LUT_ADDRESS)).value;
const message = new TransactionMessage({
  payerKey: funder.publicKey,
  recentBlockhash: blockhash,
  instructions: [...],
}).compileToV0Message([lookupTableAccount]);

const versionedTx = new VersionedTransaction(message);
versionedTx.sign([funder]);
```

Versioned txs (v0) are required to use ALTs. Legacy txs cannot reference ALTs.

---

## Counting bytes for yourself

When you add a new instruction to an existing script, the quick estimate:

```
new_bytes = 1 + N_new_accounts_in_msg + 1 + 1 + N_account_indices + 1-3 + data_len
where:
  N_new_accounts_in_msg = number of accounts that aren't already in the message
                          (each new one adds 32 bytes too — for the account list)
  N_account_indices = total accounts the instruction references (not just new)
  data_len = your instruction's data byte count
```

Use `tx.serialize().length` after building the tx to get the actual count:

```javascript
const serialized = tx.serialize({ verifySignatures: false });
console.log("tx bytes:", serialized.length, "/ 1232");
```

If you are near the limit, drop:
1. **A `SetComputeUnitPrice` you don't need.** Some scripts set it on every tx; only the fee-paying tx needs it.
2. **Accounts you reference but don't read or write.** Verify with `getProgramAccounts` what the program actually touches.
3. **One signature.** Each signer = 64 bytes of signature + 32 of pubkey if not already there.

If those don't get you under, you must split into two txs and bundle. There is no in-tx workaround.

---

## Pitfalls

- **Versioned (v0) txs serialize differently from legacy.** The legacy estimate above is wrong for v0; v0 adds a few bytes for the lookup-table indices. Use `serialize().length` on the actual object.
- **`signatures.length` is implied from the message header.** You can't add a "no-op signer." Every signer must sign and every signature must verify.
- **Compute budget instructions count.** They are real instructions with byte cost. A tx that fits *without* `SetComputeUnitPrice` may not fit *with* it.
- **Account ordering matters for size.** Solana de-duplicates accounts in the message (an account that appears in two instructions is listed once). Adding a new instruction that uses an account *already in the tx* costs only ~3 bytes; adding one that uses *new* accounts costs ~35 bytes each.

---

## Related

- [`docs/architecture.md`](architecture.md) — why the toolkit splits into bundles in the first place
- [`docs/jito-bundle-mechanics.md`](jito-bundle-mechanics.md) — the mechanics of submitting a bundle
- [`docs/pump-fun-protocol.md`](pump-fun-protocol.md) — full account list per pump.fun instruction
