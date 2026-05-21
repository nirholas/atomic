# AGENTS.md

Instructions for AI coding agents (OpenAI Codex, Cursor, Aider, Cline, Continue, generic OpenAI/Anthropic tool-use agents) working in this repo.

> For Claude Code specifically, see also [`CLAUDE.md`](./CLAUDE.md). The two files overlap intentionally — duplicate where it makes the file self-contained.

## What this repo is

`atomic` is a collection of Node scripts wrapping pump.fun flows (coin creation, creator-fee collection, buying, rescue, distribution) in **Jito bundles** so multi-step operations land atomically on Solana mainnet. The scripts handle real wallet keys and real money. Treat every change as production-bound.

## Files you should read before editing anything

1. [`README.md`](./README.md) — what each script does, how to run it.
2. [`SECURITY.md`](./SECURITY.md) — threat model, what's in scope and out of scope.
3. [`docs/setup.md`](./docs/setup.md) — wallet setup, funding, RPC choice.
4. [`docs/architecture.md`](./docs/architecture.md) — funder vs. creator, the 1232-byte tx-size constraint, bundle layouts.
5. [`docs/v2-usdc-rollout/`](./docs/v2-usdc-rollout/) — the 2026-05-21 V2 USDC engineering reference.
6. [`.env.example`](./.env.example) — every env var the scripts read.
7. The specific script(s) you're touching, in `src/`.
8. The corresponding [`docs/scripts/<name>.md`](./docs/scripts/) for the script(s).

## What you may do without further confirmation

- Add documentation under `docs/`, `tutorials/`, or as top-level `.md` files.
- Add examples under `examples/`.
- Add skills under `skills/<name>/SKILL.md` following the existing format.
- Add tests under `src/lib/*.test.ts`.
- Fix typos, broken internal links, broken code blocks in Markdown.
- Update `CHANGELOG.md` to reflect your changes.

## What requires human confirmation first

- Any edit to a `*.js` file under `src/`.
- Any edit to `src/lib/*.ts` that changes the public surface.
- Any change to dependencies (`package.json`, `package-lock.json`).
- Adding a new top-level directory.
- Renaming or deleting any file under `src/` or `tools/`.

## Hard rules

| Rule | Why |
|------|-----|
| No real secrets in code, comments, commit messages, or test fixtures. | A leaked Solana secret is drained in seconds. |
| No bumping `@nirholas/pump-sdk` / `@pump-fun/*` without reading the changelog and the V2 USDC doc set. | pump.fun upgrades silently add required accounts; outdated SDKs produce invalid txs. |
| No bypassing pre-flight assertions in scripts. | They exist because the alternative was losing funds. |
| No `--no-verify`, `--no-gpg-sign`, or other hook bypasses. | Hooks exist for correctness, not friction. |
| No reformatting unrelated lines. | Makes diffs unreviewable. |
| No "fixing" things you weren't asked to fix. | Adds review surface area and risk. Open a separate issue. |

## Commit conventions

- **Conventional commits**: `<type>(<scope>): <subject>`. Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `security`, `perf`.
- Body wraps at 72 chars. Include a "Tested on:" line for any script change with a Solscan link from your test run.
- **No `Co-Authored-By` trailer.** Sign as yourself or as the maintainer per their instruction — not jointly.
- **Per-command git config** when authoring as the maintainer: `git -c user.name="nirholas" -c user.email="nirholas@users.noreply.github.com" commit -m "..."`. Don't mutate global config.

## Testing

```bash
npm run typecheck         # TypeScript typecheck
npm test                  # vitest unit tests
```

For tx-signing changes, manual testing against a throwaway wallet on mainnet is required. Paste the resulting tx signature into the PR.

## Working with the V2 USDC rollout

If your task touches event parsing, claim monitoring, buy/sell transaction building, or amount display:

1. Read [`docs/v2-usdc-rollout/02-event-layouts.md`](./docs/v2-usdc-rollout/02-event-layouts.md) for the byte layouts.
2. Read [`docs/v2-usdc-rollout/03-quote-mint-handling.md`](./docs/v2-usdc-rollout/03-quote-mint-handling.md) for the parser/formatter reference impl.
3. Branch on **record length**, not just instruction discriminator. V1 and V2 emit the same event disc; the trailing `quote_mint` is the actual differentiator.
4. Default to wSOL when `quote_mint` is absent (preserves V1 behavior).
5. Resolve ticker + decimals from a `QUOTE_MINT_INFO` table. Never hardcode `'SOL'` or `1e9` in display code.

## Skills

Each `skills/<name>/SKILL.md` is a Claude-Code-compatible skill descriptor with a frontmatter `name` and `description` matching the trigger phrasing. They double as quick-reference cheat sheets for the underlying script. When you add or modify a skill, update both the frontmatter and the body — they have to stay consistent.

## Style

- Markdown: sentence-case headings, GitHub-flavored fenced code blocks with language tags, tables for any list of 3+ items with attributes.
- TypeScript: strict mode, no `any`, async/await throughout, JSDoc on public exports.
- JavaScript scripts (`src/`): ESM, top-level `await` allowed, `dotenv` for env vars, mask secrets in logs.

## When you're stuck

Don't fabricate on-chain account layouts, discriminator hashes, or instruction argument orderings. If the source of truth isn't in this repo, in [pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs), or in the upstream SDK packages — stop and ask.
