# pump.fun protocol reference

A protocol-level reference for the pump.fun program: program IDs, the PDAs every script derives, the instructions this toolkit calls, the event layouts, and the on-chain accounts you'll touch.

The [`@nirholas/pump-sdk`](https://github.com/anthropics/pump-sdk) handles most of these details for you — this page documents what the SDK is doing under the hood so you can reason about failure modes and debug without diving into the SDK source.

For the V2 USDC quote-mint upgrade specifically, see [`docs/v2-usdc-rollout/`](v2-usdc-rollout/).

---

## Program IDs

| Program | Pubkey | Purpose |
|---|---|---|
| pump.fun | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | Bonding curve, fee collection, creator-fee vault |
| pump-swap (Pump.fun AMM) | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | Post-migration AMM for graduated coins |
| Token program (SPL) | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Standard SPL tokens |
| Token-2022 program | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Extended SPL (transfer hooks, etc.) |
| Metaplex Token Metadata | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` | Coin name/symbol/URI metadata |
| Associated Token Program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | ATA derivation |

The canonical list in code lives at [`src/lib/programs.ts`](../src/lib/programs.ts). The SDK re-exports it via `PUMP_PROGRAM_ID`.

---

## Fee recipients

pump.fun has multiple fee-recipient accounts that protocol fees are routed to. They are part of detecting "wallet seeded by pump.fun" — if a wallet's first inbound SOL came from one of these, the wallet's funding source is pump.

```
CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM  — primary fee recipient
FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz  — secondary
G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP  — tertiary
7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ  — quaternary
7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX  — quinary
9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz  — senary
AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY  — septenary
JCRGumoE9Qi5BBgULTgdgTLjSgkCMSbF62ZZfGs84JeU  — octonary
```

(The fee recipient set is what [`src/lib/programs.ts`](../src/lib/programs.ts) exports as `PUMP_FEE_RECIPIENTS`. The [`tools/check-pump-funding.ts`](../tools/check-pump-funding.ts) tool uses these to detect pump-seeded wallets.)

The **migration authority** is a distinct account that signs the migration to pump-swap AMM:

```
PUMPFUN_MIGRATION_AUTHORITY = 39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg
```

Funds appearing from this account indicate the wallet received a migration payout, not a fee.

---

## PDAs (Program-Derived Addresses)

Most pump.fun accounts are PDAs derived from a small set of seeds. The SDK exposes derivation helpers; the underlying seeds are:

### Bonding curve PDA

```
seeds = ["bonding-curve", mint.toBytes()]
program = PUMP_PROGRAM_ID
```

Holds the bonding curve state (virtual reserves, real reserves, complete flag). One per coin.

### Associated bonding curve (ABC) PDA

```
ATA owner = bondingCurve
ATA mint  = mint
```

Standard ATA derivation. This is where the bonding curve's token reserves live.

### Creator vault PDA

```
seeds = ["creator-vault", creator.toBytes()]
program = PUMP_PROGRAM_ID
```

**Where pump.fun accumulates creator fees.** Every buy/sell on a coin you created deposits creator fees into this PDA. `collectCoinCreatorFee` drains it back to the creator wallet.

⚠️ **One vault per creator, not per coin.** If you launch 10 coins from the same `CREATOR_SECRET`, all 10 coins' creator fees pool into a single vault PDA. This is why [`collect-jito.js`](scripts/collect-jito.md) does not take a mint parameter.

### Metadata PDA (Metaplex)

```
seeds = ["metadata", METAPLEX_PROGRAM_ID.toBytes(), mint.toBytes()]
program = METAPLEX_PROGRAM_ID
```

Holds the name, symbol, URI for the coin.

### Global config PDA

```
seeds = ["global"]
program = PUMP_PROGRAM_ID
```

Singleton account holding protocol-wide config (fee rates, migration thresholds, etc.). Read by every instruction.

### Event authority PDA

```
seeds = ["__event_authority"]
program = PUMP_PROGRAM_ID
```

Anchor-style event-emitter authority. Every instruction logs an event signed by this PDA via CPI.

---

## Instructions this toolkit calls

### `createV2` — launch a new coin

Creates a new bonding-curve coin. The newest version of the create ix; replaces the original `create`.

**Required signers:** `mint` (fresh keypair, signs to authorize the mint creation), `user` (creator wallet, fee payer for this ix).

**Accounts:** see [`docs/transaction-size-budget.md`](transaction-size-budget.md#a-worked-example-createv2) for the full 14-account list.

**Data:**
```
discriminator    8 bytes (sighash of "global:create_v2")
name             borsh-encoded string  (up to 32 chars)
symbol           borsh-encoded string  (up to 10 chars)
uri              borsh-encoded string  (up to 200 chars typical)
creator          32 bytes pubkey       (on-chain creator attribution)
```

The `creator` parameter is *who appears as creator on the coin*. It can differ from `user` (the signer/fee-payer). In this toolkit, when [`fire-jito.js`](scripts/fire-jito.md) bundles createV2, `user` = `creator` = `CREATOR_SECRET`'s pubkey, so the on-chain creator field matches the signer.

**Failure modes:**
- `name`/`symbol`/`uri` exceeds maximum borsh length → ix rejects pre-execution
- Metadata URI returns 404 or non-JSON when fetched by indexers → coin exists on-chain but won't display correctly in pump.fun UI
- `mint` already exists → ix reverts with `Account already in use`

### `buy` — buy tokens via bonding curve

Spends SOL, receives tokens. Used by [`buy-jito.js`](scripts/buy-jito.md) only when the SDK's account list is current; if pump.fun has added a new required account (e.g. buyback fee recipient), the SDK becomes stale and this ix reverts.

**Required signers:** `user` (the buyer wallet, pays SOL + tx fee).

**Accounts:** 12+ accounts (mint, bondingCurve, ABC, user ATA, fee recipient, global, eventAuthority, programs…). The exact list drifts with each pump.fun program upgrade.

**Data:**
```
discriminator    8 bytes
amount           u64    (lamports of SOL to spend, OR tokens to receive — context-dependent)
maxSolCost       u64    (slippage protection)
```

When the SDK's account list is wrong, [`buy-jito.js`](scripts/buy-jito.md) routes via Jupiter aggregator instead, which keeps its own pump.fun adapter updated.

### `sell` — sell tokens via bonding curve

Symmetric to `buy`. Not used directly by this toolkit (sells are usually routed via Jupiter for better pricing).

### `collectCoinCreatorFee` — drain creator vault

Drains the creator-vault PDA back to the creator wallet.

**Required signers:** `creator` (the creator wallet — also the recipient).

**Accounts:**

| # | Account | Role |
|---|---|---|
| 1 | creator | writable, signer (recipient of drained SOL) |
| 2 | creatorVault | writable (the PDA being drained) |
| 3 | global | readonly |
| 4 | eventAuthority | readonly |
| 5 | program | readonly |
| 6 | systemProgram | readonly |

**Data:**
```
discriminator    8 bytes (sighash of "global:collect_coin_creator_fee")
```

No additional parameters — the vault's full balance is drained.

**Failure modes:**
- Creator vault has zero balance → reverts with `InsufficientFunds`. [`collect-jito.js`](scripts/collect-jito.md) checks vault balance before bundling.
- Creator signature doesn't match the vault's seed → reverts with `ConstraintSeeds`. This happens if you try to collect for the wrong creator.

### `migrate` — graduate to pump-swap AMM

Migrates a coin from the bonding curve to the pump-swap AMM once it hits the migration threshold (~85 SOL of bonding curve liquidity). Signed by `PUMPFUN_MIGRATION_AUTHORITY`, not by the user.

The toolkit does not call this directly — pump.fun migrates coins automatically when the threshold is hit. The migration *event* is observable in [`src/lib/funding-source.ts`](../src/lib/funding-source.ts) as a SOL inflow from the migration authority.

---

## Events

pump.fun uses Anchor-style event CPI: every state-changing instruction emits an event via a CPI to the event authority PDA. Events are observable in the inner-instruction logs.

The V2 event layouts are documented in detail in [`docs/v2-usdc-rollout/02-event-layouts.md`](v2-usdc-rollout/02-event-layouts.md). At a high level:

| Event | When emitted |
|---|---|
| `CreateEvent` | New coin launched (createV2 succeeded) |
| `TradeEvent` | Buy or sell on bonding curve completed |
| `CompleteEvent` | Coin hit migration threshold |
| `MigrationEvent` | Coin migrated to pump-swap AMM |

Events include the mint, signer, sol/token amounts, and timestamp. They are the canonical way to monitor pump.fun activity off-chain (better than parsing raw txs).

---

## State accounts: what each one holds

### Bonding curve account

```rust
struct BondingCurve {
    virtual_token_reserves: u64,
    virtual_sol_reserves: u64,
    real_token_reserves: u64,
    real_sol_reserves: u64,
    token_total_supply: u64,
    complete: bool,
}
```

- `virtual_*_reserves`: the virtual reserves used for the bonding curve constant product (`x * y = k`).
- `real_*_reserves`: actual tokens/SOL held by the curve.
- `complete`: set to `true` when the coin migrates. Buys/sells against a complete bonding curve revert.

### Global config account

Holds fee rates (basis points), admin pubkey, and protocol-wide flags. Read-only from a user perspective.

### Creator vault account

```rust
struct CreatorVault {
    creator: Pubkey,
    // balance is the lamports held by the PDA itself
}
```

The "balance" is just the SOL the PDA holds. There's no internal accounting — the lamport balance *is* the vault balance.

---

## How to verify an account on chain

```bash
# Bonding curve for a specific mint
solana account <bondingCurvePDA> --output json

# Creator vault balance
solana balance <creatorVaultPDA>

# Coin metadata (Metaplex)
solana account <metadataPDA> --output json
```

Use the SDK derivation helpers rather than hand-rolling seeds — getting a seed wrong by one byte gives you a different PDA that doesn't exist on chain, which produces confusing "account not found" errors.

---

## Versions and upgrades

pump.fun has shipped several program versions. As of 2026-05-21:

- **V1** (deprecated): original `create`, `buy`, `sell`. Account lists are stable but missing the buyback fee recipient.
- **V2** (current): adds buyback fee recipient, USDC quote-mint support. `createV2` replaces `create`. See [`docs/v2-usdc-rollout/`](v2-usdc-rollout/).
- **V3** (future): unconfirmed; community speculation suggests programmable creator splits.

When pump.fun ships a new program upgrade:

1. Account lists for instructions may grow.
2. Discriminators (sighashes) for new ixs are different — old SDK versions get rejected with `InvalidInstructionData`.
3. The SDK needs to bump to match.

Watch [`@nirholas/pump-sdk` releases](https://github.com/anthropics/pump-sdk/releases) for version bumps. This toolkit pins the SDK to a `^1.33.0` peer dep range; bump that range when the SDK ships a major change.

---

## Related

- [`docs/transaction-size-budget.md`](transaction-size-budget.md) — full account list / byte math for createV2
- [`docs/v2-usdc-rollout/`](v2-usdc-rollout/) — V2 USDC quote-mint upgrade reference
- [`src/lib/programs.ts`](../src/lib/programs.ts) — canonical constants in code
- [`src/lib/funding-source.ts`](../src/lib/funding-source.ts) — uses the fee recipient list to detect pump-seeded wallets
