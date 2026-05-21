# Docs

Documentation for [`pump-launch-toolkit`](../README.md) — atomic scripts for launching, collecting fees from, and trading pump.fun coins.

The root [`README.md`](../README.md) is the orientation page: it lists every script, every env var, and the one-paragraph version of why this exists. The pages here go further.

## Start here

- [**Setup**](setup.md) — what wallets you need, how to fund them, picking an RPC, refreshing Jito tip accounts, troubleshooting common errors.
- [**Architecture**](architecture.md) — the *why* behind the toolkit. Funder vs creator, the 1232-byte tx-size constraint, what's actually inside each Jito bundle, the sweeper-bot threat model.
- [**Recipes**](recipes.md) — end-to-end flows: launching with auto-collect, rescuing tokens from a compromised wallet, distributing rewards, etc.

## Deep technical reference

When you need to reason about *how* the toolkit works under the hood, or troubleshoot something the recipes don't cover:

- [**Jito bundle mechanics**](jito-bundle-mechanics.md) — bundle submission, tip auction, confirmation polling, all the failure modes and how to detect each one.
- [**Transaction size budget**](transaction-size-budget.md) — the 1232-byte limit, per-instruction byte accounting, why bundles are forced on you, ALTs.
- [**pump.fun protocol reference**](pump-fun-protocol.md) — program IDs, PDAs, every instruction the toolkit calls and its account list.
- [**Keypair hygiene**](keypair-hygiene.md) — secrets handling, things that have actually leaked keys in real ops, rotation flows.
- [**Cost model**](cost-model.md) — SOL cost per operation broken down by fee/tip/rent. Useful for sizing the funder wallet.
- [**Monitoring**](monitoring.md) — polling vs WebSocket vs Geyser vs webhooks. How to observe pump.fun activity off-chain.
- [**Glossary**](glossary.md) — quick reference for terms (funder, creator, vault, tip, etc.).

## Operational runbooks

When something goes wrong, start here. Each runbook is structured as a triage flow.

- [**Bundle not landing**](runbooks/bundle-not-landing.md) — your Jito bundle was submitted but doesn't confirm.
- [**RPC degraded**](runbooks/rpc-degraded.md) — `Blockhash not found`, slot lag, rate limits.
- [**Tip too low**](runbooks/tip-too-low.md) — tuning the Jito tip in busy markets.
- [**SDK version mismatch**](runbooks/sdk-version-mismatch.md) — `InvalidInstructionData` after a pump.fun program upgrade.
- [**Leaked key response**](runbooks/leaked-key-response.md) — what to do *during* an active key leak.
- [**Sweeper attack postmortem**](runbooks/sweeper-attack-postmortem.md) — recovery, forensics, prevention after a drain.

## V2 USDC quote-mint upgrade

The full engineering reference for the 2026-05-21 pump.fun V2 upgrade (instruction & event discriminators, byte layouts, migration recipes, per-repo audit) lives under [**docs/v2-usdc-rollout/**](v2-usdc-rollout/).

## Tutorials

Step-by-step walkthroughs for someone new to the toolkit live under [**tutorials/**](../tutorials/). The tutorials assume zero familiarity with this repo; the deep reference docs above assume you've at least used it once.

## Per-script reference

One page per runnable file. Each page documents env vars, signing flow, the tx layout, exit conditions, and failure modes.

| Script | Use it to… |
|---|---|
| [`metadata.js`](scripts/metadata.md) | Upload token metadata + image to pump.fun's IPFS endpoint. |
| [`fire-jito.js`](scripts/fire-jito.md) | Launch a coin via a two-tx Jito bundle (creator is fee payer on `createV2`). |
| [`fire-atomic-create.js`](scripts/fire-atomic-create.md) | Launch a coin in a single tx without paying a Jito tip (funder is fee payer). |
| [`collect-jito.js`](scripts/collect-jito.md) | Atomically collect creator-fee vault and route SOL to a safe destination in one bundle. |
| [`watch-collect.js`](scripts/watch-collect.md) | Long-running poller that fires `collect-jito.js` whenever the vault crosses a threshold. |
| [`consolidate.js`](scripts/consolidate.md) | One-shot sweep: vault + creator + funder → destination, all in one atomic tx. |
| [`buy-jito.js`](scripts/buy-jito.md) | Buy a token via Jupiter inside a Jito bundle (used when the pump-sdk buy ix is out of date). |
| [`rescue-tokens.js`](scripts/rescue-tokens.md) | Atomically move SPL or Token-2022 tokens from one wallet to another via a Jito bundle. |
| [`distribute.js`](scripts/distribute.md) | Convert collected creator fees to USDC and airdrop to holders, sqrt-weighted. |
| [`grind.js`](scripts/grind.md) | Multi-threaded vanity-address grinder (educational; `solana-keygen grind` is faster). |
| [`tools/check-pump-funding.ts`](scripts/check-pump-funding.md) | Verify whether a wallet was seeded by pump.fun (first inbound SOL from a fee recipient). |

## How the pieces fit together

```
metadata.js                 → returns metadata URI
       │
       ▼
fire-jito.js | fire-atomic-create.js   → creates a coin
       │
       ▼
collect-jito.js (one-shot)
   or
watch-collect.js (loop)     → drains creator-fee vault to a safe wallet
       │
       ▼
consolidate.js              → final sweep of vault + funder + creator
       │
       ▼
distribute.js               → optional: convert SOL fees to USDC, airdrop to holders


buy-jito.js                 → independent: buy any token atomically
rescue-tokens.js            → independent: move tokens atomically
grind.js                    → independent: vanity address grinder
check-pump-funding.ts       → independent: forensic check on any wallet
```

## Audience

These docs assume you've used Solana before (you know what a keypair, ATA, RPC, and pump.fun are at a basic level). They do *not* assume familiarity with Jito bundles, the `createV2` instruction, or this specific repo. The [Architecture](architecture.md) page covers the Solana-specific concepts that matter.
