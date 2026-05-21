# Glossary

Short definitions for the terms used across this toolkit. Limited to
things you'll hit reading [`src/`](../src/), [`docs/`](.), and the
[tutorials](../tutorials/). Assumes basic Solana literacy (keypairs,
RPCs, ATAs).

## Pump.fun terms

**Bonding curve.** The pricing function for a pump.fun coin during
its "pre-graduation" phase. Buying SOL into the curve mints tokens at
an increasing price; selling burns at a decreasing price. Implemented
on-chain by the pump program — `@nirholas/pump-sdk` exposes the math
via `newBondingCurve` and `getBuyTokenAmountFromSolAmount`.

**Cashback.** Optional buyer-side flag on `createV2`/buy
instructions. The toolkit's launchers set `cashback: false` —
enabling it changes the fee math and is not exercised here.

**Creator.** The on-chain "creator" account recorded on a pump.fun
coin at create time. Determines who can call `collectCoinCreatorFee`.
Independent of who **paid** for the create tx (the fee payer).

**Creator vault.** The pump.fun-managed PDA that accumulates creator
fees for a coin. Drained to the creator wallet by
`collectCoinCreatorFee` — see [`src/collect-jito.js`](../src/collect-jito.js).

**`createV2`.** The current create-coin instruction in the pump
program. Replaces the older `create` ix. All launchers in this repo
target V2.

**Dev buy.** An initial buy bundled with the create instruction, so
the creator gets the first allocation atomically. Controlled by
`DEV_BUY_SOL` on some launchers. Optional — `fire-atomic-create.js`
skips it to stay under the 1232-byte tx size limit.

**Fee config / fee recipient.** Pump.fun maintains a set of fee
recipients that receive a slice of every buy/sell. The recognized set
is in [`src/lib/programs.ts`](../src/lib/programs.ts) as
`PUMP_FEE_RECIPIENT_SET`.

**Mayhem mode.** Optional flag on `createV2` that opts the coin into
the higher-volatility tier. The toolkit sets it to `false`
everywhere.

**Migration authority.** The pubkey allowed to migrate a graduated
pump.fun coin to the next venue. Recognized as a pump-origin sender
by `detectSeededByPump` — see
[`src/lib/funding-source.ts`](../src/lib/funding-source.ts).

**Seeded by pump.fun.** A wallet whose **first inbound SOL transfer**
came from a known pump.fun source. Strict — later pump.fun activity
does not count. Detected by `detectSeededByPump`; CLI'd by
[`tools/check-pump-funding.ts`](../tools/check-pump-funding.ts).

## Jito / MEV terms

**Block Engine.** Jito's relay endpoint at
`mainnet.block-engine.jito.wtf`. Accepts JSON-RPC `sendBundle` calls
and forwards bundles to validators running Jito-modified clients.

**Bundle.** An ordered list of up to 5 transactions that execute
atomically — either all txs land in the same slot, or none do. No
adversary can insert another tx between them. This is the
foundational primitive every `*-jito.js` script depends on.

**Bundle ID.** Returned by `sendBundle`. Look it up at
`https://explorer.jito.wtf/bundle/<id>` to see why a bundle didn't
land.

**MEV (Maximal Extractable Value).** Profit that searchers extract by
reordering or inserting transactions. In this toolkit's context, the
relevant MEV strategy is *sandwiching* — front-running a buy and
selling immediately after.

**Sweeper bot.** A bot that watches public/leaked private keys and
drains any SOL or token balance the moment it lands. The reason every
"buy + transfer" or "collect + drain" flow here is bundled into a
single Jito tx: the bot can't insert between the steps.

**Tip / tip account.** A small SOL payment to one of Jito's tip
accounts (a rotating set of 8 pubkeys). Required for a bundle to be
considered for inclusion. The hardcoded list can drift — refresh via
`getTipAccounts` if you hit `"Bundles must write lock at least one
tip account"` errors. See [`docs/setup.md`](setup.md) for the
refresh procedure.

**Tip auction.** Validators with multiple competing bundles pick the
highest-tipping one. 0.001 SOL is the floor, 0.005 is the toolkit
default, 0.01–0.02 lands more reliably in contested blocks.

## Solana / SPL terms

**ATA (Associated Token Account).** The canonical PDA where a
specific wallet holds a specific SPL token. Created via
`createAssociatedTokenAccountIdempotentInstruction` (used in
[`src/rescue-tokens.js`](../src/rescue-tokens.js)) so the tx is safe
to retry.

**Compute units (CU).** Solana's gas equivalent. A tx is capped at
1,400,000 CU. Scripts use
`ComputeBudgetProgram.setComputeUnitLimit` + `setComputeUnitPrice`
to declare their budget and bid for inclusion priority.

**Lamport.** Smallest SOL denomination. 1 SOL = 10^9 lamports.

**Priority fee.** Per-CU price in microlamports, used by validators
to rank pending txs. Toolkit defaults range from 2,000,000 to
3,000,000 µlamports/CU depending on the script.

**Rent-exempt minimum.** Lamport balance a system account must hold
to avoid being purged. ~890,880 lamports — the
`BUFFER_LAMPORTS` default in `collect-jito.js`.

**Tx size limit.** 1232 bytes serialized. The reason `fire-jito.js`
splits launch into two txs (rent transfer + create), and the reason
`fire-atomic-create.js` skips the dev buy.

**Token-2022 (`t22`).** The newer SPL token program with hooks,
transfer fees, and other extensions. Distinct from legacy SPL Token
(`spl`). `rescue-tokens.js` defaults to `t22` — flip
`TOKEN_PROGRAM=spl` for legacy mints.

## RPC / endpoint terms

**Helius, Triton.** Solana RPC providers. Their endpoints embed an
`api-key=` query string — **treat this URL as a secret**.

**`getSignaturesForAddress`.** RPC method that pages signatures for
a pubkey newest → oldest. Capped at 1000 per call. Used by
`detectSeededByPump` to walk wallet history.

**`getParsedTransaction`.** RPC method returning a decoded tx
including pre/post balances. The expensive RPC call in
`detectSeededByPump` — budget it carefully on rate-limited endpoints.

**`simulateTransaction`.** Dry-run a versioned tx against current
state. Returns logs and CU usage. Scripts use it before
`sendTransaction` / `sendBundle` to fail fast on obvious errors.
