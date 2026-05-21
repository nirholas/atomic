---
name: atomic-grind
description: Use when the user wants to generate a vanity Solana keypair whose pubkey starts with a chosen prefix — for a recognizable creator address, a brand-themed wallet, or matching a project's ticker. Triggers on "grind a vanity address", "vanity keypair", "grind.js", "solana-keygen grind", "creator address starts with", or any CPU-bound keypair-search task. Strongly prefers `solana-keygen grind` (Rust, multithreaded) over the JS fallback.
---

# atomic-grind — vanity Solana keypair generator

`src/grind.js` is a slow JS-based vanity-grinder included only as a fallback for environments without the Solana CLI installed. **In nearly every case, the right tool is `solana-keygen grind` from the Rust-based Solana CLI** — it's parallelized across CPU cores and orders of magnitude faster.

## When to invoke

Pick this skill when the user wants to:

- **Generate a vanity creator address** for a launch (e.g. ticker prefix: `MEME...`).
- **Match a brand-themed prefix** for a public wallet.
- **Search for a specific suffix** (the Solana CLI supports `--ends-with`).

The skill should **default to recommending `solana-keygen grind`** and only fall back to `src/grind.js` if the user explicitly can't or won't install the Solana CLI.

## Decision tree

| Available | Use |
|-----------|-----|
| Solana CLI installed | `solana-keygen grind --starts-with <prefix>:1` |
| Solana CLI not installed, on Linux/macOS | `sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"` then above |
| Cannot install Solana CLI | `npm run grind` (slow) |

## Estimated grind times (single-core, ASCII case-sensitive prefix)

| Prefix length | `solana-keygen grind` (8-core M-series) | `src/grind.js` (single-core Node) |
|---------------|------------------------------------------|------------------------------------|
| 3 chars | seconds | minutes |
| 4 chars | ~1 minute | ~30 minutes |
| 5 chars | ~5-10 minutes | hours |
| 6 chars | ~1-2 hours | days |
| 7 chars | ~1-2 days | weeks |
| 8 chars | weeks | not practical |

Base58 has 58 characters in its alphabet; each prefix character multiplies the search space by ~58×.

## Solana CLI usage

```bash
# Single match, starts with "MEME"
solana-keygen grind --starts-with MEME:1

# Multiple matches
solana-keygen grind --starts-with MEME:5

# Suffix match
solana-keygen grind --ends-with sol:1

# Case-insensitive (faster — bigger match space)
solana-keygen grind --starts-with meme:1 --ignore-case
```

Output: a `<pubkey>.json` file in the current directory containing the keypair. Move it somewhere safe and reference via `FUNDER_KEYPAIR` / `CREATOR_KEYPAIR`.

## JS fallback usage

```bash
PREFIX=MEME npm run grind
# or
PREFIX=MEME node src/grind.js
```

The JS version:

- Runs single-threaded (no worker pool by default — keeps the script simple).
- Logs progress every 100,000 attempts.
- Writes the matched keypair to `<pubkey>.json` and prints the pubkey.

For longer prefixes, run multiple processes in parallel via your shell:

```bash
PREFIX=MEME node src/grind.js & PREFIX=MEME node src/grind.js & wait
```

But seriously, just install the Solana CLI.

## Security considerations

A vanity address is just a regular keypair. There is **no cryptographic weakness** introduced by picking the prefix — the private key remains as random as any other. The only cost is CPU time.

**Don't share grinded keypairs.** They're as sensitive as any other Solana secret. Sweeper bots actively scan for keypair-JSONs accidentally committed to public repos.

The repo's `.gitignore` excludes `*.json` outside the allowlist; a grinded `<pubkey>.json` will not accidentally commit. Verify with `git status` anyway.

## Failure modes and fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `npm run grind` is slow | Single-threaded JS | Use `solana-keygen grind` instead. |
| Solana CLI not found | Not installed | Install: `sh -c "$(curl -sSfL https://release.solana.com/v1.18.0/install)"` |
| `"prefix contains invalid base58 character"` | Prefix has `0`, `O`, `I`, or `l` | Base58 excludes those; choose a different prefix. |
| Grind running for hours with no result | Prefix too long or unlucky run | Shorten by 1 char (58× faster), or accept the wait. |

## Worked example

Launching a coin themed around a ticker:

```bash
# 1. Grind a creator address starting with "MEME" (the chosen ticker)
solana-keygen grind --starts-with MEME:1
# Output: Found matching key MEMExxxxx... in N attempts.
# Wrote keypair to MEMExxxxx.json

# 2. Use it as the creator
CREATOR_KEYPAIR=./MEMExxxxx.json \
FUNDER_SECRET=<base58> \
NAME=MEMEcoin SYMBOL=MEME URI=<from skills/metadata/> \
JITO_TIP=0.01 \
  npm run launch
```

The on-chain creator now starts with the ticker, which is the kind of detail that makes a launch look more intentional than rushed.

## Reference

- Script: [`src/grind.js`](../../src/grind.js)
- Per-script docs: [`docs/scripts/grind.md`](../../docs/scripts/grind.md)
- Preferred tool: `solana-keygen grind` from the Solana CLI.
