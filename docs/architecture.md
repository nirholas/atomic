# Architecture

The pump-launch-toolkit is built around three ideas that the rest of the code rests on:

1. **A funder wallet and a creator wallet are separate things.** The funder pays for everything. The creator is the on-chain attribution.
2. **Some operations don't fit in a single Solana tx**, so they're split into two and submitted as a Jito bundle — an atomic, ordered tx group.
3. **Sweeper bots watch known/leaked private keys.** Any pattern that lets SOL or tokens *rest* in such a wallet between operations will lose those funds. The atomic patterns here ensure funds never settle there.

This page explains each idea, why it matters, and how the scripts encode it.

---

## The funder/creator split

Most of the scripts take two keypairs:

- `FUNDER_SECRET` — a private wallet holding the bulk of your SOL. Pays fees, Jito tips, ATA rent. Should be a fresh, non-public key.
- `CREATOR_SECRET` — the wallet that pump.fun records as the *creator* of the coin. Often shared, multi-party, or even leaked on purpose (the toolkit assumes this is possible).

There's a third role:

- `DESTINATION` — a pubkey (you don't need its private key) where collected SOL is sent at the end of every atomic operation.

The shape of the model:

```
   ┌──────────┐  pays fees + tips + rent   ┌──────────────┐
   │  FUNDER  │ ─────────────────────────▶ │  on-chain    │
   │ (secret) │                            │  transaction │
   └──────────┘                            └──────────────┘
                                                  │
   ┌──────────┐  signs createV2 / collect /        │
   │ CREATOR  │  drain                             │
   │ (secret) │ ──────────────────────────────────▶│
   └──────────┘                                    │
                                                   │
                                                   ▼
                                          ┌──────────────────┐
                                          │   DESTINATION    │
                                          │  (safe wallet)   │
                                          └──────────────────┘
```

Why split them?

- **The creator can have a shared/leaked key.** If you launched a coin from a wallet whose key is in a community Discord or held by multiple parties, you can't safely hold SOL in it. The atomic-collect pattern works around this — see [collect-jito](scripts/collect-jito.md).
- **The launch tx fits even when the creator wallet has zero SOL.** The funder transfers rent into the creator wallet inside the same bundle, so the creator's wallet doesn't need to be pre-funded. See [fire-jito](scripts/fire-jito.md).
- **You can keep the bulk of SOL off the publicly known wallet.** The funder is the only wallet that needs a meaningful SOL balance.

---

## Why Jito bundles

A Solana tx has a hard 1232-byte size limit. The pump.fun `createV2` instruction is *expensive* in account terms — it references the mint, bonding curve, metadata accounts, fee recipients, the token program, the associated-token program, the migration authority, and more. A single tx that does both *"transfer rent SOL to the creator"* and *"call createV2"* would either fit only barely (and break on any program account-list change) or simply not fit at all once you want the creator to also be the fee payer.

**Jito bundles solve this.** A bundle is an ordered group of 1–5 txs, submitted via the Jito Block Engine, that execute **atomically** — either every tx lands in the same block in order, or none do — and that no MEV searcher can interleave between.

The Jito Block Engine is a competing block builder; landing requires paying a *tip* (SOL transferred to one of a small set of well-known accounts in any tx of the bundle). The tip is the auction bid. The floor is 0.001 SOL; in busy windows you need 0.005–0.02 to land.

Inside this toolkit, three guarantees flow from "use a Jito bundle":

| Guarantee | Used by |
|---|---|
| **Tx-pair atomicity.** Two txs land together or not at all. Lets us split rent-transfer + create across txs. | [`fire-jito`](scripts/fire-jito.md), [`buy-jito`](scripts/buy-jito.md) |
| **No MEV insertion.** No other tx can land *between* the bundle's txs. Lets us hand a coin to the creator without a sweeper bot draining it. | [`fire-jito`](scripts/fire-jito.md), [`buy-jito`](scripts/buy-jito.md) |
| **Single-tx atomicity within a bundle.** Same as a normal tx, but submitted with a tip and via the Jito path (which is sometimes faster + more reliable than the standard RPC path). | [`collect-jito`](scripts/collect-jito.md), [`consolidate`](scripts/consolidate.md), [`rescue-tokens`](scripts/rescue-tokens.md) |

### Bundle layouts in this repo

Each bundle-using script has a different shape. Here's what's inside each one.

#### fire-jito.js — two-tx launch bundle

```
┌─ Tx 1 (signed by FUNDER, FUNDER pays fee) ─────────────┐
│ • SetComputeUnitPrice / Limit                          │
│ • SystemProgram.transfer  FUNDER → CREATOR  (RENT_SOL) │
│ • SystemProgram.transfer  FUNDER → tipAccount (JITO_TIP)│
└────────────────────────────────────────────────────────┘

┌─ Tx 2 (signed by CREATOR + MINT, CREATOR pays fee) ────┐
│ • SetComputeUnitPrice / Limit                          │
│ • PUMP_SDK.createV2Instruction({mint, name, …})        │
└────────────────────────────────────────────────────────┘
```

The Solscan "from" field on the create tx will show the *creator* wallet, because the creator is the fee payer of Tx 2. The funder is invisible on the create tx itself; it appears only on Tx 1.

#### collect-jito.js — single-tx atomic collect-and-drain

```
┌─ Tx (signed by FUNDER + CREATOR, FUNDER pays fee) ────────┐
│ • SetComputeUnitPrice / Limit                             │
│ • SystemProgram.transfer  FUNDER → tipAccount (JITO_TIP)  │
│ • ...collectCoinCreatorFeeInstructions(creator, funder)   │
│ • SystemProgram.transfer  CREATOR → DESTINATION (drained) │
└───────────────────────────────────────────────────────────┘
```

Because everything is in one tx, the creator wallet never holds the collected SOL even for one slot. A bot watching the creator key has nothing to grab.

#### consolidate.js — single-tx full sweep

```
┌─ Tx (signed by FUNDER + CREATOR, FUNDER pays fee) ────────┐
│ • SetComputeUnitPrice / Limit                             │
│ • SystemProgram.transfer  FUNDER → tipAccount (JITO_TIP)  │
│ • ...collectCoinCreatorFeeInstructions(creator, funder)   │
│ • SystemProgram.transfer  CREATOR → DESTINATION (drained) │
│ • SystemProgram.transfer  FUNDER  → DESTINATION (drained) │
└───────────────────────────────────────────────────────────┘
```

Same atomicity argument plus the funder is also drained — useful for retiring a launch session in one go.

#### buy-jito.js — two-tx Jupiter buy

```
┌─ Tx 1 (signed by FUNDER, FUNDER pays fee) ─────────────┐
│ • SetComputeUnitPrice / Limit                          │
│ • SystemProgram.transfer  FUNDER → BUYER (BUY_SOL + buffer) │
│ • SystemProgram.transfer  FUNDER → tipAccount          │
└────────────────────────────────────────────────────────┘

┌─ Tx 2 (signed by BUYER, BUYER pays fee) ───────────────┐
│ • Pre-built Jupiter swap tx (SOL → TARGET_MINT)        │
└────────────────────────────────────────────────────────┘
```

The Jupiter tx is fetched as-is from `lite-api.jup.ag/swap/v1/swap`. The funder funds the buyer in Tx 1 so the buyer doesn't need pre-existing SOL.

#### rescue-tokens.js — single-tx atomic token transfer

```
┌─ Tx (signed by FUNDER + FROM, FUNDER pays fee) ────────────┐
│ • SetComputeUnitPrice / Limit                              │
│ • SystemProgram.transfer  FUNDER → tipAccount              │
│ • createAssociatedTokenAccountIdempotent(dest ATA)         │
│ • createTransferChecked(from ATA → dest ATA, amount, dec)  │
└────────────────────────────────────────────────────────────┘
```

The "rescue" use case: the FROM wallet has a shared/leaked key holding tokens. A sweeper bot is watching it. Doing a normal `transfer` exposes a public-mempool window. Using the Jito path with a tip avoids that — once the bundle is submitted, no other tx can preempt it.

---

## The sweeper-bot threat model

The toolkit is shaped by a specific threat: **bots watching publicly known private keys.**

Examples of how a key becomes public:

- Multiple parties hold it (community wallet, multi-sig backup, contractor handover).
- It was posted (intentionally or by accident) in a Discord, screenshot, GitHub repo, transcript.
- The creator wallet of a coin is observable on-chain — anyone can derive it from a pump.fun coin URL — and the bot may have correlated it with a leaked secret elsewhere.

What sweeper bots do:

- Watch the wallet's on-chain balance every block.
- The moment SOL or fee-receivable tokens land, they submit a tx draining the wallet using the same private key.
- They typically use jitted code, aggressive priority fees, and Jito tips to win the race.

Where these bots get beaten:

- **Atomic single-tx patterns.** If the SOL is collected *and* forwarded to a destination in the same tx (e.g. [`collect-jito`](scripts/collect-jito.md)), there's no window between the two operations for the bot to insert.
- **Jito bundle ordering.** If two ops must be split across txs, putting both in a Jito bundle is just as safe as a single tx — Jito guarantees no third-party tx lands between them.

Where these bots still win:

- **Buying tokens to a leaked wallet without an atomic forward.** Even if the *buy* is via Jupiter+Jito, the tokens land in the leaked wallet. If you don't immediately transfer them out atomically, a Token-2022 sweeper picks them up. The [`rescue-tokens`](scripts/rescue-tokens.md) pattern (or a third tx in the buy bundle) is the right shape.
- **Anything that uses a normal `sendTransaction` involving a leaked key.** The public mempool gives bots a multi-slot preview.

---

## What the toolkit deliberately does *not* do

- **No private-mempool routing besides Jito.** No bloXroute, Helius staked connections, etc. Add as a follow-up if you need them.
- **No automatic Jito-tip auction sizing.** Tip is a fixed env var. If your bundle doesn't land, raise `JITO_TIP` and retry.
- **No retry loop on landing failure.** Most scripts exit 1 if the bundle doesn't confirm in ~60 s. The [`watch-collect`](scripts/watch-collect.md) wrapper is the only built-in poll-and-retry.
- **No multi-coin orchestration.** Each script operates on one coin / wallet pair at a time. Multi-coin watchers are the user's job (or future work).
- **No on-chain accounting.** The scripts do not record what they collected/distributed anywhere. If you need an audit trail, capture stdout to a log.

---

## Glossary

For quick lookups, the [root README's glossary](../README.md#glossary) lists the same terms (funder, creator, vault, destination, Jito bundle, Jito tip, "seeded by pump.fun").
