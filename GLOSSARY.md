# Glossary

Terminology used across the `atomic` repo. Cross-references to deeper explanations.

## A

**Anchor discriminator** — The first 8 bytes of an instruction's data payload or an event's record. Computed as `sha256("<namespace>:<name>")[0..8]` where namespace is `global` for instructions, `event` for events, `account` for accounts. See [`docs/v2-usdc-rollout/01-discriminators.md`](./docs/v2-usdc-rollout/01-discriminators.md).

**ATA (Associated Token Account)** — A deterministic SPL token account derived from `(owner, mint)`. Required for any wallet to hold an SPL token. V2 builders derive ATAs against the chosen `quote_mint` — wSOL ATA for SOL pairs, USDC ATA for USDC pairs.

**Atomic** — In this repo: a multi-step operation either all happens or none of it does. Achieved via Jito bundles on Solana. A non-atomic flow is one where intermediate state (e.g. SOL rent on the creator wallet) is observable on-chain and therefore race-able by sweeper bots.

## B

**Base units** — The smallest integer denomination of a token. For SOL: lamports (10⁹ per SOL). For USDC: micro-USDC (10⁶ per USDC). All on-chain amounts are encoded as `u64` in base units; convert at display time.

**Block Engine (Jito)** — Jito's transaction-bundle submission endpoint. Mainnet only. Accepts bundles via gRPC or JSON-RPC; returns a bundle ID for status polling.

**Blockhash** — A recent block's hash used to expire transactions. Valid for ~150 slots (~60 seconds). Bundles whose blockhash expires before inclusion are dropped.

**Bonding curve** — The pre-graduation pricing mechanism for pump.fun coins. A pre-funded virtual pool whose price rises with each buy. Lives on the **Pump program**. See [`docs/concepts/bonding-curve.md`](./docs/concepts/bonding-curve.md).

**Borsh** — The serialization format Anchor uses. Variable-length types: strings = `u32 LE len + utf8 bytes`, vecs = `u32 LE len + T * len`. Fixed types are little-endian by convention.

**Bundle** — In Jito context: a set of 1-5 transactions sharing a blockhash that the Block Engine lands all-or-nothing. The first transaction in a bundle pays a **tip** to a Jito tip account.

## C

**Cashback** — Volume-based rebate paid back to traders via the `claim_cashback` instruction. SOL-only; no V2 USDC variant at the May-21 rollout. See [`docs/concepts/cashback.md`](./docs/concepts/cashback.md).

**Compute budget** — Solana's per-tx CU (compute-unit) limit. Default 200K, raisable to ~1.4M via `setComputeUnitLimit`. Paired with a price-per-CU set via `setComputeUnitPrice` (the priority fee).

**Consolidate** — In this repo: a Jito bundle that drains the creator vault + creator wallet + funder wallet, all to a single safe `DESTINATION`, atomically. See `src/consolidate.js`.

**CPI** — Cross-program invocation. When one program calls another. `update_fee_shares_v2` CPIs into `distribute_creator_fees_v2`, which is why fee monitors need to match both discriminators.

**Creator (pump.fun)** — The wallet that signs the `createV2` instruction and is recorded as the coin's `creator` field on-chain. Distinct from the **funder** (the wallet paying SOL for rent + tip). See [`docs/architecture.md`](./docs/architecture.md).

**Creator fee** — Fee accrued by a coin's creator wallet from every buy/sell on its bonding curve. Claimed via `collect_creator_fee` (V1) or `collect_creator_fee_v2`. See [`docs/concepts/creator-fees.md`](./docs/concepts/creator-fees.md).

**Creator fee sharing** — Mechanism letting a creator split fees among multiple wallets via shareholder basis-points (BPS, 10,000 = 100%). Lives in `distribute_creator_fees` and its V2 sibling. See [`docs/concepts/fee-sharing.md`](./docs/concepts/fee-sharing.md).

## D

**Destination** — In this repo: the safe wallet that drained SOL or tokens settle into. Specified via `DESTINATION` env var. Scripts refuse to run if `DESTINATION == funder` (a typo-protection assertion).

**Discriminator** — See **Anchor discriminator**.

## F

**Fee payer** — The Solana account that pays the network fee for a transaction. Distinct from the signers. In `fire-jito.js`'s Tx2 (createV2), the fee payer is the creator wallet — that's what determines Solscan's "from" display.

**Funder** — In this repo: the wallet supplying SOL for rent, priority fees, and Jito tip. Should be your hot wallet — keep its balance small. See [`docs/architecture.md`](./docs/architecture.md).

## G

**Graduation** — When a coin's bonding curve completes (~$69K market cap at SOL prices), it migrates to a real AMM pool on the **PumpSwap AMM program**. Triggered by the `CompleteEvent` / `CompleteAmmMigrationEvent` events. See [`docs/concepts/graduation.md`](./docs/concepts/graduation.md).

**Grind (vanity grind)** — CPU-bound search for a keypair whose pubkey starts with a desired prefix. `solana-keygen grind` (Rust) is the fast tool; `npm run grind` is a slow JS fallback.

## I

**IDL (Interface Description Language)** — Anchor's JSON file describing a program's instructions, accounts, events, and types. Used by SDKs to generate type-safe builders. Refreshing the IDL is the canonical way to pick up new V2 instructions in a TypeScript SDK.

**`isStable`** — Display hint on a quote mint. USDC and other stablecoins get 2-decimal-place rendering; SOL and other volatile assets get 4 decimals under 1 unit.

## J

**Jito** — A validator client + Block Engine that adds bundle support to Solana. Validators running Jito-Solana coordinate via the Block Engine to land MEV/searcher bundles atomically. See [`docs/operations/jito-tips.md`](./docs/operations/jito-tips.md).

**Jito tip** — A SOL transfer from one of the bundle's transactions to a Jito tip account. The tip is the bid in an auction; higher tips get bundles landed during contested slots.

**Jupiter** — A Solana DEX aggregator. The atomic toolkit uses Jupiter's REST API (`https://quote-api.jup.ag`) in `src/buy-jito.js` to route buys around pump-sdk drift.

## L

**Lamport** — The smallest unit of SOL. 1 SOL = 10⁹ lamports. All on-chain SOL amounts are u64 lamports.

**Leaked key** — A wallet whose private key has become non-confidential — typically because of multi-sig schemes, shared dev environments, or accidental disclosure. Sweepers attack leaked keys; the atomic patterns defend by never letting funds rest on one.

**LUT (Address Lookup Table)** — A Solana account that holds a list of pubkeys, referenced by index in a transaction. Reduces tx size by replacing 32-byte pubkeys with 1-byte indices. Some pump-sdk versions require LUTs for buy/sell.

## M

**Mayhem mode** — A pump.fun launch mode that changes the bonding-curve mechanics. Set via the `createV2` instruction's `mayhemMode` arg. See [`docs/concepts/mayhem-mode.md`](./docs/concepts/mayhem-mode.md). Unrelated to V2 USDC support.

**MEV (Maximal Extractable Value)** — Value that can be extracted by reordering / inserting / censoring transactions. On Solana, the MEV market is mediated through Jito bundles. The atomic toolkit's design point is *defending against MEV* — specifically, sweeper bots.

## P

**Per-command git config** — `git -c user.name="..." -c user.email="..." commit -m "..."`. Used in the executor prompts and AI-agent instructions so the git config is set per-commit rather than mutating global state. Avoids leaking your identity into other repos worked on the same machine.

**Priority fee** — Per-compute-unit price in micro-lamports. Raises the odds a leader includes your tx in the next block. Distinct from a Jito tip; both can be set on the same tx.

**Provenance (wallet)** — Where a wallet's first inbound SOL came from. The `tools/check-pump-funding.ts` CLI answers "was this wallet seeded by pump.fun?" by walking signatures back to the first inbound transfer.

**Pump program** — On-chain program at `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`. Hosts `create`, `create_v2`, `buy`, `sell`, `buy_v2`, `sell_v2`, `collect_creator_fee`, `distribute_creator_fees`, and the V2 variants.

**Pump fees program** — On-chain program at `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`. Hosts `claim_social_fee_pda` (and V2 + `update_fee_shares_v2`) used by GitHub-tagged social fee claims.

**PumpSwap AMM program** — On-chain program at `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`. Hosts the AMM-side `amm_buy`, `amm_sell`, `collect_coin_creator_fee`, `transfer_creator_fees_to_pump` (+ V2 variants).

## Q

**Quote mint** — The SPL mint a pump.fun coin is paired against. Pre-V2: implicitly wrapped SOL. V2: either wrapped SOL or USDC. See [`docs/v2-usdc-rollout/03-quote-mint-handling.md`](./docs/v2-usdc-rollout/03-quote-mint-handling.md).

## R

**Rent (Solana)** — SOL deposited on an account to keep it exempt from garbage collection. ~0.002 SOL per account. The pump.fun create tx deposits ~0.022 SOL across the coin's accounts.

**Rescue** — In this repo: an atomic SPL/Token-2022 transfer from a (typically leaked) source wallet to a safe destination. Specifically defends against sweeper races. See `src/rescue-tokens.js`.

## S

**Slippage** — The price impact tolerance for a swap. Expressed in basis points (BPS, 10,000 = 100%). `SLIPPAGE_BPS=500` allows 5% impact.

**SPL Token / Token-2022** — The two Solana token program standards. pump.fun coins are SPL Token by default; some V2 paths support Token-2022 via the `tokenProgram` parameter.

**Sweeper bot** — A bot watching public/leaked private keys and draining any SOL or tokens that *rest* in those wallets within seconds. The atomic patterns in this toolkit prevent funds from settling on leaked keys.

## T

**Tip account (Jito)** — One of the 8 Jito-controlled accounts that bundle tips must transfer to. Rotates periodically; check via `npm run check-tip-accounts` if you get `Invalid` bundles.

**Token-2022** — The "Token Extensions" SPL standard. Adds features like transfer fees, confidential transfers, hooks. The atomic toolkit's rescue script handles both standard SPL and Token-2022 mints.

## U

**USDC mint** — `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` — the official Circle USDC mint on Solana mainnet-beta. 6 decimals (so 1 USDC = 1,000,000 micro-USDC).

## V

**Vanity address** — A pubkey whose base58 representation starts (or ends) with a chosen string. Generated by brute-force CPU search.

**Vault (creator)** — The `coinCreatorVault` PDA where a coin's creator fees accumulate. Drained via `collect_creator_fee` / `collect_creator_fee_v2`. Bundle the drain atomically with the collect to prevent races on shared keys.

## W

**wSOL (wrapped SOL)** — Mint `So11111111111111111111111111111111111111112`. Required for SPL token-account semantics on native SOL. Even SOL-paired V2 instructions need the wSOL mint passed as `quote_mint` (the program auto-wraps native SOL behind the scenes).
