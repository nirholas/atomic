# Glossary

Quick reference for terms used throughout this doc set.

## Pump.fun-specific

**Bonding curve** — The pre-graduation pricing mechanism for pump.fun coins. A pre-funded virtual pool whose price rises with each buy. Lives on the **Pump program**.

**Graduation** — When a coin's bonding curve completes (~$69K market cap at SOL prices), it migrates to a real AMM pool on the **PumpSwap AMM program**. Triggered by the `CompleteEvent` / `CompleteAmmMigrationEvent` events.

**Pump program** — On-chain program at `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`. Hosts `create`, `create_v2`, `buy`, `sell`, `buy_v2`, `sell_v2`, `collect_creator_fee`, `distribute_creator_fees`, and the V2 variants.

**PumpSwap AMM program** — On-chain program at `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`. Hosts the AMM-side `amm_buy`, `amm_sell`, `collect_coin_creator_fee`, `transfer_creator_fees_to_pump` (+ V2 variants).

**Pump fees program** — On-chain program at `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`. Hosts `claim_social_fee_pda` (and V2 + `update_fee_shares_v2`) used by GitHub-tagged social fee claims.

**Mayhem mode** — A pump.fun launch mode introduced before May-21 that changes the bonding-curve mechanics. Set via the `create_v2` instruction's `mayhemMode` arg. Unrelated to V2 USDC support.

**Cashback** — Volume-based rebate paid back to traders via `claim_cashback`. SOL-only; no V2 variant at the May-21 rollout.

**Creator fee** — Fee accrued by a coin's creator wallet from every buy/sell on its bonding curve. Claimed via `collect_creator_fee` (V1) or `collect_creator_fee_v2`.

**Creator fee sharing** — Mechanism letting a creator split their fees among multiple wallets via shareholder basis-points (BPS, 10,000 = 100%). Lives in the `distribute_creator_fees` ix and its V2 sibling.

**Social fee PDA** — A PDA tied to a creator's social account (GitHub today) that accumulates fees. Claimable via `claim_social_fee_pda` (V1) or `claim_social_fee_pda_v2`.

## On-chain mechanics

**Anchor discriminator** — The first 8 bytes of an instruction's data payload or an event's record. Computed as `sha256("<namespace>:<name>")[0..8]` where namespace is `global` for instructions, `event` for events, `account` for accounts. See [01-discriminators.md](./01-discriminators.md).

**Program data log line** — A log line of the form `Program data: <base64>` emitted by Anchor's `emit!` macro. Contains the discriminator + borsh-encoded record. This is how off-chain parsers read events.

**CPI** — Cross-program invocation. When one program calls another. `update_fee_shares_v2` CPIs into `distribute_creator_fees_v2`, which is why fee monitors need to match both discriminators.

**Borsh** — The serialization format Anchor uses. Variable-length types: strings = `u32 LE len + utf8 bytes`, vecs = `u32 LE len + T * len`. Fixed types are little-endian by convention.

**SPL Token / Token-2022** — The two Solana token program standards. pump.fun coins are SPL Token by default; some V2 paths support Token-2022 via the `tokenProgram` parameter.

**ATA (Associated Token Account)** — A deterministic SPL token account derived from `(owner, mint)`. Required for any wallet to hold an SPL token. V2 builders derive ATAs against the chosen `quote_mint` — wSOL ATA for SOL pairs, USDC ATA for USDC pairs.

## Quote-mint specific

**Quote mint** — The SPL mint a pump.fun coin is paired against. Pre-V2: implicitly wrapped SOL. V2: either wrapped SOL or USDC.

**wSOL (wrapped SOL)** — Mint `So11111111111111111111111111111111111111112`. Required for SPL token-account semantics on native SOL. Even SOL-paired V2 instructions need the wSOL mint passed as `quote_mint` (the program auto-wraps native SOL behind the scenes).

**USDC mint** — `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` — the official Circle USDC mint on Solana mainnet-beta. 6 decimals (so 1 USDC = 1,000,000 micro-USDC).

**Base units** — The smallest integer denomination of a token. For SOL: lamports (10⁹ per SOL). For USDC: micro-USDC (10⁶ per USDC). All on-chain amounts are encoded as `u64` in base units; convert at display time.

**`isStable`** — Display hint on a quote mint. USDC and other stablecoins get 2-decimal-place rendering; SOL and other volatile assets get 4 decimals under 1 unit.

**`amountSol` vs `amountQuote`** — In quote-aware event records:
- `amountSol`: legacy field. Set to `baseUnits / 1e9` only when the quote is actually SOL. **Explicitly zeroed for USDC claims** to prevent legacy code from rendering wildly incorrect numbers.
- `amountQuote`: V2 field. `baseUnits / 10^decimals` for whatever the actual quote currency is. Always populated when the quote mint is resolved.

## Tooling / convention

**Anchor IDL** — JSON file describing a program's instructions, accounts, events, and types. Used by SDKs to generate type-safe builders. Refreshing the IDL is the canonical way to pick up new V2 instructions in a TypeScript SDK.

**Per-command git config** — `git -c user.name="..." -c user.email="..." commit -m "..."`. Used in the executor prompts so the git config is set per-commit rather than mutating global state. Avoids leaking nirholas identity into other repos worked on the same machine.

**`@users.noreply.github.com`** — GitHub's standard noreply email pattern. For an account named `nirholas`, the noreply address is `nirholas@users.noreply.github.com`. Newer accounts also have an ID-prefixed form (`<id>+<username>@users.noreply.github.com`); both are valid.

**Sweeper bot** — A bot watching public/leaked private keys, draining any SOL or tokens that rest in those wallets. Atomic Jito bundles in the [atomic](https://github.com/nirholas/atomic) repo prevent funds from settling on leaked keys.

**Jito bundle** — A set of transactions submitted to Jito's Block Engine as a single unit, guaranteeing atomic landing. Used in the atomic repo to make multi-step launches (fund-then-create, claim-then-drain) un-front-runnable.

## Audit/status terms used in this doc set

**READY** — Repo already handles V2 USDC correctly. No action needed.

**NEEDS UPDATE** — Repo touches pump.fun on-chain data but doesn't yet handle V2 records. Will silently mis-parse USDC activity after May 21.

**LOW PRIORITY** — Touches pump.fun but only via a higher-level abstraction (REST API, WebSocket feed). Surface fix only.

**N/A** — Read-only proxy / unrelated logic / unaffected by the on-chain change.

**Blocker** — Repo whose update gates downstream work. Currently: `pump-fun-sdk` (gates pumpkit peer-dep bump and all TypeScript V2 trading callers).
