# Claude Code instructions for the `atomic` repo

This repo ships Node scripts that **sign and broadcast real Solana transactions** with real wallet keys. Default to careful, additive changes. Don't refactor anything you weren't asked to. Don't bump dependencies you weren't asked to. Read this whole file before your first edit.

## What the repo does

- **Atomic Jito-bundle scripts** under `src/` for pump.fun coin creation, creator-fee collection, buying, SPL/Token-2022 rescue, and USDC reward distribution. The "atomic" part is the design point: every multi-step flow lives in a single Jito bundle so no MEV/sweeper bot can insert between txs.
- **Shared library helpers** under `src/lib/` (e.g. `funding-source.ts`, `programs.ts`) consumed by both the scripts and the standalone tools under `tools/`.
- **A documentation set** under `docs/` that explains every script, every concept, and every operational gotcha.

## Where things live

```
.
├── README.md, SECURITY.md, CONTRIBUTING.md, ...    repo-level docs
├── AGENTS.md, CLAUDE.md, SKILL.md                  AI-assistant instructions
├── .env.example                                    every env var the scripts read
├── src/                                            runnable scripts (ESM, run via `npm run <name>`)
│   ├── fire-jito.js, collect-jito.js, ...
│   └── lib/                                        shared TS helpers (funding-source, programs)
├── tools/                                          standalone CLIs (tsx)
│   ├── check-pump-funding.ts
│   ├── check-tip-accounts.ts
│   ├── check-balances.ts
│   └── sanity-check.ts
├── docs/
│   ├── README.md                                   docs index
│   ├── setup.md, architecture.md, recipes.md       top-level guides
│   ├── scripts/                                    per-script reference
│   ├── runbooks/                                   incident response
│   ├── v2-usdc-rollout/                            2026-05-21 V2 engineering reference
│   ├── concepts/                                   deep dives on bonding curve, graduation, fees, etc.
│   ├── security/                                   threat model, key management
│   └── operations/                                 RPC providers, Jito tips, costs
├── prompts/v2-usdc-rollout/                        standalone executor prompts (one per repo)
├── skills/                                         Claude Code skills
├── tutorials/                                      numbered hands-on guides
├── examples/                                       short runnable JS snippets
└── .github/                                        CI workflows, issue/PR templates
```

## Hard rules

1. **Never edit a file under `src/` without manual on-chain verification.** Those are the production scripts. If you must change one, document the change in the PR description with a Solscan link from a throwaway-wallet test run.
2. **Never commit secrets.** `.env`, base58 secrets, keypair JSONs outside the `*.json` ignore. Run `git status` before every commit. If you see anything that looks like a secret in the diff, bail.
3. **Never bypass pre-flight assertions.** Scripts have explicit balance checks, account-count checks, slippage caps. They exist because the alternative was losing funds. If a check trips, fix the root cause; don't `try/catch` it away.
4. **Never bump `@nirholas/pump-sdk` or `@pump-fun/*` without reading their changelogs.** pump.fun on-chain upgrades regularly add required accounts to buy/sell instructions and silently invalidate old SDK output.
5. **Never disable signing hooks or skip CI.** No `--no-verify`, no `--no-gpg-sign`. If a hook fails, fix the issue.

## Soft preferences

- **One concern per commit.** A bug fix and a refactor go in two commits.
- **Conventional commits**: `<type>(<scope>): <subject>`. Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `security`. Scopes: script name or package name (e.g. `collect-jito`, `lib`, `docs`, `skills`).
- **No `Co-Authored-By` trailers** when committing on behalf of the maintainer.
- **Per-command git config** when authoring as someone else: `git -c user.name="..." -c user.email="..." commit -m "..."`. Don't mutate global config.
- **Reference real file paths and Solscan signatures** in PR descriptions and commit bodies. "Tested on mainnet, sig <link>, no regressions on existing flows" is the bar.

## Testing rituals

```bash
# Type-check the lib/ TS files + tools/ CLIs
npm run typecheck

# Unit tests (vitest)
npm test
```

For script work in `src/`:

```bash
# Test against a throwaway wallet on mainnet. NOT a wallet with real funds.
npm run <script-name>           # e.g. npm run launch
# or
node src/<script>.js
```

For docs: render the .md file in a Markdown viewer and follow internal links.

## Common pitfalls Claude has hit in this repo

- **Mis-reading the V2 event layout.** The 2026-05-21 rollout appends a trailing `quote_mint` pubkey to event records but keeps the discriminator the same. Branch on `bytes.length`, not just on disc. See [`docs/v2-usdc-rollout/02-event-layouts.md`](./docs/v2-usdc-rollout/02-event-layouts.md).
- **Hardcoding lamports/1e9 in display code.** USDC pairs are in micro-USDC (10⁶). Use the quote-mint-aware formatter pattern from [`docs/v2-usdc-rollout/03-quote-mint-handling.md`](./docs/v2-usdc-rollout/03-quote-mint-handling.md).
- **Putting a tip ix in the wrong tx of a bundle.** The Jito tip must be in one of the txs that lands in the bundle, not in a separate broadcast.
- **Sending to `DESTINATION` without verifying it's not the funder.** A typo can send fees back to the wallet you were trying to drain. See `src/consolidate.js` for the assertion pattern.

## When in doubt

- Re-read the relevant `docs/scripts/<script>.md`.
- Check the corresponding skill under `skills/<name>/SKILL.md` for trigger phrasing and acceptance criteria.
- Ask. Open an issue describing what you're trying to do before you change a `src/` script. Doc and tutorial PRs don't need an issue first.

## V2 USDC rollout (2026-05-21)

If you're touching buy/sell flows, **read [`docs/v2-usdc-rollout/README.md`](./docs/v2-usdc-rollout/README.md) first.** The on-chain protocol now supports USDC as a quote mint, and every parser/formatter needs to handle that. The reference set has byte layouts, migration recipes, per-repo audit, and 5 standalone executor prompts under [`prompts/v2-usdc-rollout/`](./prompts/v2-usdc-rollout/).

## Skill triggers you can rely on

These match the frontmatter `description` field in each `skills/<name>/SKILL.md`. Phrase intent matching the trigger to invoke:

| Intent | Skill |
|--------|-------|
| "Launch a pump.fun coin with separate funder/creator" | `skills/launch/` |
| "Collect creator fees atomically" | `skills/collect/` |
| "Buy a token via Jupiter inside a Jito bundle" | `skills/buy/` |
| "Rescue tokens from a leaked wallet" | `skills/rescue/` |
| "Distribute USDC rewards to holders" | `skills/distribute/` |
| "Audit a wallet's funding source" | `skills/audit/` |
| "Consolidate funder + creator + vault into a safe wallet" | `skills/consolidate/` |
| "Watch and auto-collect creator fees" | `skills/watch/` |
| "Upload pump.fun token metadata to IPFS" | `skills/metadata/` |
| "Grind a vanity Solana address" | `skills/grind/` |
| "Was this wallet seeded by pump.fun?" | `skills/funding-source/` |
