# Contributing

This repo is small and personal. Contributions are welcome but the bar is correctness, security, and not breaking running deployments. Read this page before opening a PR.

## Before you change anything

1. Skim [`docs/architecture.md`](docs/architecture.md). It explains *why* the funder/creator split and the Jito bundle layouts are the way they are. Many "obvious cleanups" in the scripts would break atomicity guarantees.
2. Skim the per-script reference page under [`docs/scripts/`](docs/scripts/) for whatever you're touching. The "Failure modes" sections capture lessons that aren't obvious from the code.
3. If you're adding a new runnable script, add it under [`src/`](src/) and register an `npm run …` alias in `package.json`. If you're adding a CLI utility, put it under [`tools/`](tools/) (TypeScript via `tsx`).

## Local development

```bash
git clone https://github.com/nirholas/atomic.git
cd atomic
npm install
cp .env.example .env       # fill in keys, see docs/setup.md
npm run typecheck          # tsc --noEmit, covers src/lib/ + tools/
npm test                   # vitest run, covers src/lib/
npm run test:watch         # vitest in watch mode
```

CI runs `typecheck` + `test` on Node 20 and 22 for every PR. Local pass != green CI; matrix matters for any code touching newer Node APIs.

## What requires special care

- **Anything touching the Jito bundle layout.** Re-read [`docs/architecture.md`](docs/architecture.md#bundle-layouts-in-this-repo). The funder/creator split, the order of instructions inside a single tx, and which signer is fee payer are all load-bearing — change one and you can introduce a race window for sweeper bots.
- **The pump.fun fee recipient list in [`src/lib/programs.ts`](src/lib/programs.ts).** This is consulted by [`detectSeededByPump`](src/lib/funding-source.ts). When pump.fun rolls out a new fee recipient (they do this on program upgrades), update the list with the new pubkey and bump the legacy/new comments.
- **The hardcoded Jito tip account list.** Lives in every `src/*-jito.js`. If it rotates, every script needs the same edit — keep them in sync. (Eventually this should be a shared constant; for now it's duplicated by design to keep each script self-contained.)
- **pump-sdk version drift.** When `@nirholas/pump-sdk` releases include new required accounts in `createV2Instruction` or `collectCoinCreatorFeeInstructions`, the scripts inherit the change automatically — but the inline comments in [`docs/scripts/`](docs/scripts/) describing tx sizes / CU usage may become stale. Update them.

## Code style

- **No new TypeScript in `src/*.js` runtime scripts** — they're CommonJS by design, runnable via `node src/<name>.js` with zero build step. New TS goes under `src/lib/` or `tools/`.
- **`tsconfig.json` is strict.** `noImplicitAny`, `strict`, `noUncheckedIndexedAccess` are all on. Don't loosen these to make a change pass.
- **Comments explain *why*, not *what*.** The code is short; don't narrate it.
- **Don't add an emoji or formatter config without discussion.** Prettier/ESLint aren't currently wired up; if you want to add them, open an issue first.

## Tests

- Pure logic (`src/lib/*.ts`) gets vitest unit tests with hand-rolled fakes. See [`src/lib/funding-source.test.ts`](src/lib/funding-source.test.ts) for the pattern (fake `Connection`, fixture transactions).
- Runtime scripts (`src/*.js`) currently have no automated tests — they touch live RPC + Jito + pump-sdk. Manual verification:
  1. Run on devnet if pump-sdk supports it (currently mainnet-only).
  2. Otherwise: use a fresh funder + creator pair with the minimum SOL needed, on a coin you control, and observe Solscan + the pump.fun page.
- A no-spend sanity tool exists at [`tools/sanity-check.ts`](tools/sanity-check.ts) — run `npm run sanity` to validate env + RPC + balances without sending any tx.

## Security

- **Never commit a `.json` keypair, a `.env` with real values, or a base58 secret in a comment.** The [`.gitignore`](.gitignore) excludes `*.json` and `.env*` by default — don't allowlist around it.
- **Never paste a private key, PAT, or secret into a PR description, commit message, or issue comment.** These get indexed publicly even on private repos.
- **For new ix patterns that touch a leaked or shared key**, ask yourself: is there a moment between two on-chain operations where SOL/tokens rest in the leaked wallet? If yes, the pattern is unsafe. See [`docs/architecture.md`](docs/architecture.md#the-sweeper-bot-threat-model).

## Pull request checklist

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] If you added/changed a runnable script, the relevant page in [`docs/scripts/`](docs/scripts/) is updated.
- [ ] If you changed env-var semantics, [`.env.example`](.env.example), the root [`README.md`](README.md), and [`docs/setup.md`](docs/setup.md) are updated.
- [ ] No new secrets, keypair files, or sample PATs are in the diff.
- [ ] Commit messages explain *why* the change is needed, not just *what*.

## Reporting issues

Open a GitHub issue. For anything security-sensitive (a vulnerability, a leaked credential you spotted in past commits, a hot-wallet draining behavior), prefer a direct message over a public issue.
