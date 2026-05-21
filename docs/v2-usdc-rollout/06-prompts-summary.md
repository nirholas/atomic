# Standalone Executor Prompts

Five standalone executor prompts live at [`../../prompts/v2-usdc-rollout/`](../../prompts/v2-usdc-rollout/). Each is a self-contained engineering ticket — clone the target repo, make the V2 changes, run verification, commit + push as `nirholas <nirholas@users.noreply.github.com>`, then self-delete.

These were authored after the pumpkit pass and the cross-repo audit (see [04-pumpkit-changes.md](./04-pumpkit-changes.md) and [05-cross-repo-audit.md](./05-cross-repo-audit.md)) so they encode the lessons learned and reference the canonical implementations directly.

## Prompt index

| # | File | Repo | Scope |
|---|------|------|-------|
| 01 | [01-pump-fun-sdk.md](../../prompts/v2-usdc-rollout/01-pump-fun-sdk.md) | `nirholas/pump-fun-sdk` | Add `buyV2Instructions`, `sellV2Instructions`, `buyV2ExactSolInInstruction`, V2 claim builders, USDC_MINT constant. Refresh IDL. Add tests. Bump to `1.33.0`. Add MIGRATION.md + V2_USDC_QUOTE.md + CHANGELOG entry. **The single biggest piece** — pumpkit, three.ws downstream, and the whole TypeScript ecosystem depend on this. |
| 02 | [02-pump-swap-sdk.md](../../prompts/v2-usdc-rollout/02-pump-swap-sdk.md) | `nirholas/pump-swap-sdk` | Sync to upstream `@pump-fun/pump-swap-sdk@1.15.0`. Refresh IDL to include `transfer_creator_fees_to_pump_v2` (disc `01214eb921432c5c`). Preserve fork-specific additions. Bump to `1.15.0`. |
| 03 | [03-pumpfun-claims-bot.md](../../prompts/v2-usdc-rollout/03-pumpfun-claims-bot.md) | `nirholas/pumpfun-claims-bot` | Mirror pumpkit's `packages/claim/` V2 work into the standalone repo: 5 V2 disc entries, `quote_mint` event parsing, formatter updates, fixture-driven tests. |
| 04 | [04-pumpfun-creator-rewards.md](../../prompts/v2-usdc-rollout/04-pumpfun-creator-rewards.md) | `nirholas/pumpfun-creator-rewards` | Add pass-through quote-mint handling for the `swap-api.pump.fun` REST response. Render USDC ticker + 2dp precision. Add `ticker`/`quoteMint` to the JSON API response. |
| 05 | [05-three-ws-sync.md](../../prompts/v2-usdc-rollout/05-three-ws-sync.md) | `nirholas/three.ws` | Re-sync vendored `PumpAgentOffline.ts`, `pump-events.ts`, `idl/pump.json`, pump-event fixtures from `agent-payments-sdk`. Add `VENDORED.md`. |

## Common conventions every prompt enforces

These are baked into every file under `prompts/v2-usdc-rollout/`. If you ever author a new prompt for this series, keep them consistent.

### Git author + commit hygiene

Each commit uses **per-command** git config (not global mutation):

```bash
git -c user.name="nirholas" -c user.email="nirholas@users.noreply.github.com" \
    commit -m "..."
```

No `Co-Authored-By` trailer. No interactive `--amend` of previous commits. Pushes go to the default branch directly (no PR step).

### "If you get blocked"

Every prompt has an explicit blocker-handling section instructing the executor to:

- Stop rather than fabricate V2 layouts.
- Push WIP to a named feature branch if the SDK/IDL isn't yet available.
- Add a note to `CHANGELOG.md` describing what's missing.
- Never push a half-finished V2 implementation to the default branch.

This is deliberate: it's tempting for an aggressive executor to "fill in" missing on-chain details by guessing, and those guesses propagate as subtle correctness bugs.

### Acceptance criteria checklist

Every prompt ends with a concrete checkbox list including `grep -c` assertions the executor must verify before pushing. Example from prompt 01:

```
- [ ] `npm run build` succeeds with no TS errors.
- [ ] `npm test` passes — both existing suites and the new V2 tests.
- [ ] `grep -c "buy_v2" src/idl/pump.json` returns > 0.
- [ ] `grep -c "buyV2Instructions" src/index.ts` returns > 0.
- [ ] `grep -c "USDC_MINT" src/index.ts` returns > 0.
- [ ] `package.json` version is `1.33.0`.
- [ ] Two commits land on the default branch, both authored by `nirholas <nirholas@users.noreply.github.com>`.
- [ ] `git log -2 --format='%an <%ae>'` shows the right author on both commits.
- [ ] This prompt file no longer exists.
```

### Self-deletion

Final step of every prompt:

```bash
rm /workspaces/v2-usdc-prompts/<filename>.md
```

(Adjust the path to wherever the prompts are staged on the executor's machine.) The combination of "delete on completion" + "default branch push" means a passing run leaves no artifact in the prompts directory — the directory contents are a live to-do list.

## Recommended execution order

Each prompt is independent — no inter-prompt dependencies. But for least rework:

1. **`01-pump-fun-sdk.md`** first. It's the longest-running and gates pumpkit's peer-dep bump.
2. **`02-pump-swap-sdk.md`** in parallel with 01 (different on-chain program).
3. **`03-pumpfun-claims-bot.md`**, **`04-pumpfun-creator-rewards.md`**, **`05-three-ws-sync.md`** in any order, in parallel.
4. After 01 lands and `@nirholas/pump-sdk@1.33.0` is **published to npm**, bump pumpkit's peer dep manually:

   ```bash
   cd packages/core && \
     jq '.peerDependencies["@nirholas/pump-sdk"] = "^1.33.0"' package.json > package.json.tmp && \
     mv package.json.tmp package.json
   ```

   Then update the [`CreateCoin.tsx`](https://github.com/nirholas/pumpkit/blob/main/packages/web/src/pages/CreateCoin.tsx) bubble that currently says "land in the next `@nirholas/pump-sdk` release" to reference `^1.33.0` as published.

## When a prompt completes successfully

The executor should print:

- The commit hash(es) created.
- The new package version (where applicable).
- A one-line summary of what was synced/added.

Then the prompt file is removed. The atomic repo's `prompts/v2-usdc-rollout/` directory should shrink over time as work lands.

## When a prompt is blocked

The blocker handling described in every prompt's "If you get blocked" section produces a:

- WIP branch (`wip/v2-usdc-rollout` by convention) on the target repo.
- Note in that repo's `CHANGELOG.md` describing what's missing.
- The prompt **stays in this directory** until the blocker resolves.

This makes the prompts directory a faithful representation of outstanding work at any moment.

## Versioning these prompts

If you re-author a prompt (because the target repo's layout shifted, or because the on-chain spec changed), bump a short version line at the top:

```
> Prompt version: v2 — 2026-05-25 (adapted after upstream IDL renamed `quote_mint` → `quote_token_mint`).
```

Don't preserve old versions in the file — git history is the audit log.
