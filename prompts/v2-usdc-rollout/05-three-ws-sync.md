# Task: Re-sync vendored `PumpAgentOffline` files in `nirholas/three.ws` from `nirholas/agent-payments-sdk`

## Context

`nirholas/three.ws` (a 3D AI agent web platform) has a vendored copy of pump.fun integration code originally lifted from `nirholas/agent-payments-sdk`. Specifically:

- `src/solana/PumpAgentOffline.ts` (vendored from `agent-payments-sdk`)
- Pump event fixtures: `src/solana/fixtures/pump-events/create.json`, `trade-buy.json`, `trade-sell.json`
- `src/solana/idl/pump.json`
- `src/solana/pump-events.ts`

`agent-payments-sdk` has been updated for the **2026-05-21 V2 USDC quote-mint rollout** and now parses the trailing `quote_mint` pubkey on V2 pump events. The three.ws vendored copies are pre-V2 and will silently mis-parse V2 events once the rollout ships.

USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
wSOL mint: `So11111111111111111111111111111111111111112`

## What to deliver

A clean re-sync of the vendored files from the canonical source (`agent-payments-sdk`) so that three.ws can decode V2 pump events.

### Mandatory scope

1. **Identify all vendored files.** Run a recursive comparison between the two repos to find every file in `three.ws/src/solana/` (or wherever the vendoring lives) that has a counterpart in `agent-payments-sdk`. Don't assume the list above is exhaustive — find the actual set.

2. **Re-sync vendored files** to match `agent-payments-sdk`'s default branch HEAD. Specifically:
   - `PumpAgentOffline.ts` — replace with the canonical version.
   - `pump-events.ts` — replace with the canonical version. **This is where the V2 `quote_mint` parsing lives.** After sync, the file must reference `quote_mint` (search for it as a sanity check).
   - `idl/pump.json` — replace with the canonical IDL (which includes V2 instruction discriminators).
   - `fixtures/pump-events/*.json` — re-export from `agent-payments-sdk` fixtures.
   - Any other files that show as drifted in the diff.

3. **Preserve three.ws-specific glue code.** If three.ws has wrapped or extended the vendored modules (e.g. an adapter layer between PumpAgentOffline and the 3D scene), do not stomp on that glue. Only the pure vendored files get replaced. When in doubt, diff and confirm whether the divergence is "stale vendor copy" vs "three.ws customization" before overwriting.

4. **Add a `VENDORED.md`** (or update an existing one) in the vendored directory listing:
   - Source repo: `https://github.com/nirholas/agent-payments-sdk`
   - Source commit hash (use the agent-payments-sdk default branch HEAD as of this sync).
   - Sync date.
   - One-line summary of why this is vendored rather than imported as a dependency.
   This makes future re-syncs cheap.

5. **Update three.ws's own type / call sites** if `pump-events.ts` exposes new V2 fields (`quoteMint`, `quoteTicker`, etc.) that three.ws consumers can take advantage of. At minimum, type definitions in consuming modules must continue to compile.

6. **Build verification.** Run whatever build the repo uses (`npm run build`, `pnpm build`, `vite build`, etc.) and confirm it succeeds.

### Non-goals

- Do not promote the vendoring to a proper npm dependency. That's a larger architectural change.
- Do not add V2-specific UI in the 3D scene — this is a code-correctness sync, not a feature.
- Do not modify `agent-payments-sdk`. It is the source of truth here.

## Execution

1. Clone both repos:
   ```bash
   gh repo clone nirholas/three.ws /tmp/three-ws
   gh repo clone nirholas/agent-payments-sdk /tmp/agent-payments-sdk
   cd /tmp/three-ws
   ```
   Record the source commit hash:
   ```bash
   (cd /tmp/agent-payments-sdk && git rev-parse HEAD)
   ```

2. Install deps for three.ws:
   ```bash
   npm install || pnpm install || yarn install
   ```

3. Find vendored files:
   ```bash
   # Adjust path if the vendoring lives elsewhere
   diff -r /tmp/three-ws/src/solana /tmp/agent-payments-sdk/src/solana | head -100
   ```
   Identify the drift, confirm it's vendor staleness not customization, then copy the canonical files over.

4. After each significant file replacement, run build/typecheck. Don't accumulate breakage.

5. Add or update `VENDORED.md` with source repo + commit hash + date.

6. Commit as **one commit**:
   ```bash
   git -c user.name="nirholas" -c user.email="nirholas@users.noreply.github.com" \
     commit -m "chore(solana): re-sync vendored pump-fun integration from agent-payments-sdk for V2 USDC support"
   ```

   No `Co-Authored-By` trailer. The body should reference the source commit hash from agent-payments-sdk.

7. Push:
   ```bash
   git push origin HEAD
   ```

8. Delete this prompt file:
   ```bash
   rm /workspaces/v2-usdc-prompts/05-three-ws-sync.md
   ```

9. Print the commit hash, the agent-payments-sdk source commit hash, and the list of files synced.

## Acceptance criteria

- [ ] Build / typecheck passes for three.ws after sync.
- [ ] `grep -ic "quote_mint\|quoteMint" src/solana/pump-events.ts` returns > 0 (V2 parsing is present).
- [ ] `VENDORED.md` exists in the vendored directory with source repo + commit + date.
- [ ] One commit lands on the default branch, authored by `nirholas <nirholas@users.noreply.github.com>`.
- [ ] This prompt file no longer exists.

## If you get blocked

If three.ws has heavily customized the vendored files (so a straight copy would clobber real work), stop and report. The right answer might be a partial sync targeting only the V2 parsing logic in `pump-events.ts`, leaving the rest alone. Don't force a full sync that loses three.ws's customizations.
