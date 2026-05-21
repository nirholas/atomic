# Task: Add USDC display support to `nirholas/pumpfun-creator-rewards`

## Context

pump.fun is enabling **USDC as a quote mint** on 2026-05-21. From that day forward, creator-fee earnings on USDC-paired coins will arrive in USDC (6 decimals) rather than SOL (9 decimals).

`nirholas/pumpfun-creator-rewards` is a single-page web app + JSON API that looks up creator-reward earnings by coin mint, wallet address, or username. It queries `swap-api.pump.fun` (specifically the `coins-v2/{mint}` endpoint) and renders the result. Today it assumes all amounts are denominated in SOL.

The app does **not** decode on-chain events directly — it consumes pump.fun's REST API. So the main change is:

1. Read the quote-mint field from the upstream API response (the upstream `coins-v2` endpoint already exposes it; if it does not yet, your job is to handle both shapes gracefully).
2. Render the correct ticker (`SOL` or `USDC`) and the correct decimal precision in both the web UI and the JSON API response.

USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
wSOL mint: `So11111111111111111111111111111111111111112`

## What to deliver

1. **API layer (e.g. `api/fees.js`, `lib/pump.js`, or wherever the upstream call lives)**:
   - Pass through whatever quote-mint / ticker fields the upstream response contains, normalized into a stable shape: `{ amount: number, ticker: 'SOL'|'USDC', quoteMint: string }`.
   - When the upstream response omits the quote-mint info (current behavior for SOL-only coins), default to `ticker: 'SOL'`, `quoteMint: <wSOL>`.
   - Do not hardcode `'SOL'` anywhere downstream of the API call.

2. **Web UI**:
   - Earnings totals must render with the correct ticker. SOL: 4 decimal places for amounts < 1, 2 decimals otherwise. USDC: always 2 decimal places (it's a dollar value).
   - Any "lifetime SOL claimed"–style labels must become "lifetime claimed" with the ticker shown next to the number, or labels that adapt to the quote currency.
   - If the page shows multiple coins for a wallet/username, each row must render its own ticker — do not assume a single quote currency per wallet.

3. **JSON API response shape**:
   - Add a `ticker` and `quoteMint` field to each earning record returned by the API.
   - Keep existing `amountSol` (or equivalent) field for backward compatibility, but only populate it when the actual quote currency is SOL. For USDC earnings, set it to `0` or `null` (whichever matches the existing convention for "not applicable") and put the real amount in a new `amount` field. Document this in the README.

4. **README**:
   - Add a short section under "API response" documenting the new fields and the SOL/USDC dual quote support.
   - Add a screenshot or example showing a USDC earnings row if the README has visual docs.

5. **Tests** (if a test setup exists in the repo):
   - One unit test asserting that a USDC fixture produces `ticker: 'USDC'` and renders with 2dp precision.
   - One test asserting that the SOL fallback still works when the upstream response omits the quote-mint field.
   - If no test infrastructure exists, add a single Node-runnable smoke script under `scripts/test-quote-mint.mjs` that exercises both fixtures. Do not stand up a full test framework just for this.

### Non-goals

- Do not call any new pump.fun endpoints beyond what the app already calls.
- Do not add SOL-to-USD or USDC-to-USD conversion.
- Do not change the deployment config (Vercel) or the routing.
- Do not rename existing fields in the JSON response — only add new ones. Breaking the public API shape is out of scope.

## Execution

1. Clone the repo:
   ```bash
   gh repo clone nirholas/pumpfun-creator-rewards /tmp/pumpfun-creator-rewards
   cd /tmp/pumpfun-creator-rewards
   ```

2. Install deps:
   ```bash
   npm install || pnpm install || yarn install
   ```
   (Use whichever the lockfile dictates.)

3. **Verify the upstream response shape first.** Hit the API live for a known coin (the README probably lists one):
   ```bash
   curl -s "https://swap-api.pump.fun/coins-v2/<MINT>" | head -c 2000
   ```
   Note whether the response already exposes `quote_mint` or `quoteMint`. Adapt your code to the actual shape. **Do not guess.** If the upstream response doesn't include the field yet, your code must default to SOL but be structured so that flipping to USDC is a one-line change once upstream ships the field.

4. Implement the scope. Run the dev server (`npm run dev` or equivalent) and test the UI against the live API. Confirm SOL coins still render correctly.

5. Commit as **one commit**:
   ```bash
   git -c user.name="nirholas" -c user.email="nirholas@users.noreply.github.com" \
     commit -m "feat: render USDC earnings for V2 quote-mint pump.fun coins (2026-05-21 rollout)"
   ```

   No `Co-Authored-By` trailer.

6. Push:
   ```bash
   git push origin HEAD
   ```

7. Delete this prompt file:
   ```bash
   rm /workspaces/v2-usdc-prompts/04-pumpfun-creator-rewards.md
   ```

8. Print the commit hash and a one-line summary describing whether upstream already exposes `quote_mint` or whether you defaulted to SOL pending the upstream API update.

## Acceptance criteria

- [ ] Web UI renders a SOL coin correctly (no regression).
- [ ] Web UI renders a USDC coin with `USDC` ticker and 2dp precision (or, if no live USDC coin exists yet, the unit/smoke test for the USDC code path passes).
- [ ] JSON API response includes `ticker` and `quoteMint` fields.
- [ ] README documents the new fields.
- [ ] One commit lands on the default branch, authored by `nirholas <nirholas@users.noreply.github.com>`.
- [ ] This prompt file no longer exists.

## If you get blocked

If the upstream `swap-api.pump.fun` endpoint structure has changed in a way that breaks the existing app, stop and report — fixing that is out of scope for this task. Only make additive changes for V2 quote-mint support.
