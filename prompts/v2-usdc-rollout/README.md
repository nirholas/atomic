# V2 USDC Rollout — Standalone Executor Prompts

Five self-contained engineering tickets. Each one:

1. Clones its target nirholas-owned repo.
2. Makes the V2 USDC changes (refresh IDL, add discriminators, parse `quote_mint`, render USDC, etc.).
3. Runs the acceptance-criteria checklist.
4. Commits as `nirholas <nirholas@users.noreply.github.com>` using per-command `git -c` flags (no global config mutation, no `Co-Authored-By` trailer).
5. Pushes to the default branch.
6. Deletes its own prompt file.

A passing run on a prompt removes it from this directory. Whatever remains here is outstanding.

## Reference docs

Full context for these prompts lives in [`../../docs/v2-usdc-rollout/`](../../docs/v2-usdc-rollout/):

- [README.md](../../docs/v2-usdc-rollout/README.md) — index + TL;DR
- [00-context.md](../../docs/v2-usdc-rollout/00-context.md) — what changed on-chain
- [01-discriminators.md](../../docs/v2-usdc-rollout/01-discriminators.md) — every V1/V2 instruction & event disc
- [02-event-layouts.md](../../docs/v2-usdc-rollout/02-event-layouts.md) — byte layouts for every event
- [03-quote-mint-handling.md](../../docs/v2-usdc-rollout/03-quote-mint-handling.md) — parser + display reference impl
- [04-pumpkit-changes.md](../../docs/v2-usdc-rollout/04-pumpkit-changes.md) — what was already shipped to pumpkit
- [05-cross-repo-audit.md](../../docs/v2-usdc-rollout/05-cross-repo-audit.md) — status of every nirholas pump repo
- [06-prompts-summary.md](../../docs/v2-usdc-rollout/06-prompts-summary.md) — index of these prompts
- [07-migration-guide.md](../../docs/v2-usdc-rollout/07-migration-guide.md) — V1→V2 migration recipes
- [08-testing-strategy.md](../../docs/v2-usdc-rollout/08-testing-strategy.md) — what to test and how
- [09-glossary.md](../../docs/v2-usdc-rollout/09-glossary.md) — key terms

## The prompts

| # | File | Target repo |
|---|------|-------------|
| 01 | [01-pump-fun-sdk.md](./01-pump-fun-sdk.md) | [`nirholas/pump-fun-sdk`](https://github.com/nirholas/pump-fun-sdk) — the TypeScript SDK pumpkit pins. Add V2 buy/sell/claim builders + IDL refresh. **The biggest piece.** |
| 02 | [02-pump-swap-sdk.md](./02-pump-swap-sdk.md) | [`nirholas/pump-swap-sdk`](https://github.com/nirholas/pump-swap-sdk) — sync to upstream `@pump-fun/pump-swap-sdk@1.15.0`. |
| 03 | [03-pumpfun-claims-bot.md](./03-pumpfun-claims-bot.md) | [`nirholas/pumpfun-claims-bot`](https://github.com/nirholas/pumpfun-claims-bot) — standalone Telegram fee-claim bot; mirror pumpkit's `@pumpkit/claim` V2 work. |
| 04 | [04-pumpfun-creator-rewards.md](./04-pumpfun-creator-rewards.md) | [`nirholas/pumpfun-creator-rewards`](https://github.com/nirholas/pumpfun-creator-rewards) — earnings web app; add USDC display. |
| 05 | [05-three-ws-sync.md](./05-three-ws-sync.md) | [`nirholas/three.ws`](https://github.com/nirholas/three.ws) — re-sync vendored pump-integration files from `agent-payments-sdk`. |

## Recommended execution order

- **01 first** (longest pole; gates pumpkit peer-dep bump).
- **02 in parallel with 01** (different on-chain program).
- **03, 04, 05 in any order, in parallel.**

After 01 ships and `@nirholas/pump-sdk@1.33.0` is *published to npm*, manually bump pumpkit's peer dep (one-liner in `packages/core/package.json`) and update the [CreateCoin docs bubble](https://github.com/nirholas/pumpkit/blob/main/packages/web/src/pages/CreateCoin.tsx) to remove the "pending in the next release" caveat.

## How to run one

```bash
# Pick a prompt
cat 01-pump-fun-sdk.md

# Feed it to your executor of choice (Claude Code, etc.) as the user prompt.
# The prompt is self-contained — it tells the executor where to clone,
# what to change, what to verify, how to commit, and to delete itself when done.
```

## Authoring conventions

If you write more prompts for this series, keep them consistent:

- **Per-command git config** for commits — never mutate global git config.
- **No `Co-Authored-By` trailer.**
- **Acceptance-criteria checklist** at the bottom with concrete `grep`-able assertions.
- **"If you get blocked" section** instructing the executor to stop + report rather than fabricate on-chain details.
- **Self-deletion as the final step.**

See [`../../docs/v2-usdc-rollout/06-prompts-summary.md`](../../docs/v2-usdc-rollout/06-prompts-summary.md) for the full convention.
