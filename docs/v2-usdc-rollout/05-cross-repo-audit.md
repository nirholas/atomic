# Cross-Repo V2 USDC Readiness Audit

Captured 2026-05-19 / 2026-05-20. Status of every nirholas-owned repo that touches pump.fun on-chain code.

## Status legend

- ✅ **READY** — code already handles V2 USDC correctly. No action needed.
- 🔴 **NEEDS UPDATE** — actively broken (or will be broken at rollout). Action required.
- 🟡 **LOW PRIORITY** — touched but doesn't decode on-chain events directly; may need surface tweaks.
- ⚪ **N/A** — read-only / proxy / unaffected.

## Repo status table

| Repo | Status | Default branch HEAD as of audit | What's needed |
|------|--------|--------------------------------|---------------|
| [nirholas/pumpkit](https://github.com/nirholas/pumpkit) | ✅ READY | `3c29d0c` (then small core formatter cleanup) | Done this cycle — channel, claim, core, web all V2-aware. See [04-pumpkit-changes.md](./04-pumpkit-changes.md). |
| [nirholas/pumpfun-rust-client](https://github.com/nirholas/pumpfun-rust-client) | ✅ READY | last push 2026-05-14 | `src/sdk/pump_v2.rs` takes `quote_mint: Pubkey`, defaults to wSOL. Has `buy_v2.rs`, `sell_v2.rs` examples and `tests/v2_custom_quote_mint.rs`. Reference implementation for the TS SDK port. |
| [nirholas/agent-payments-sdk](https://github.com/nirholas/agent-payments-sdk) | ✅ READY | (private, audited via search) | `src/solana/pump-events.ts` parses `quote_mint` at 3 sites. `swap/scripts/build-buy-bonding-v2-tx.mjs`, `build-sell-bonding-v2-tx.mjs`, `build-buy-exact-quote-in-v2-tx.mjs`, `build-claim-cashback-v2-tx.mjs` all parameterize `quoteMint`. |
| [nirholas/pump-fun-sdk](https://github.com/nirholas/pump-fun-sdk) | 🔴 NEEDS UPDATE | `v1.32.0` — Apr-28 fee-recipient release | **The single biggest blocker.** No `buy_v2`/`sell_v2` in `src/idl/pump.json`, `buyInstructions`/`sellInstructions` don't take `quoteMint`. pumpkit pins this as `^1.32.0`. See [`prompts/v2-usdc-rollout/01-pump-fun-sdk.md`](../../prompts/v2-usdc-rollout/01-pump-fun-sdk.md). |
| [nirholas/pump-swap-sdk](https://github.com/nirholas/pump-swap-sdk) | 🔴 NEEDS UPDATE | `v1.14.0` | Mirror of upstream `@pump-fun/pump-swap-sdk`. Needs sync to upstream `1.15.0` which adds `transfer_creator_fees_to_pump_v2` to the AMM IDL. See [`prompts/v2-usdc-rollout/02-pump-swap-sdk.md`](../../prompts/v2-usdc-rollout/02-pump-swap-sdk.md). |
| [nirholas/pumpfun-claims-bot](https://github.com/nirholas/pumpfun-claims-bot) | 🟡 NEEDS UPDATE *(dormant)* | last commit 2026-03-30 | Standalone Telegram fee-claim monitor. V1 discs only, no `quote_mint` parsing. Fix is identical to what shipped in pumpkit's `packages/claim/`. Either port or retire and direct users to `@pumpkit/claim`. See [`prompts/v2-usdc-rollout/03-pumpfun-claims-bot.md`](../../prompts/v2-usdc-rollout/03-pumpfun-claims-bot.md). |
| [nirholas/pumpfun-creator-rewards](https://github.com/nirholas/pumpfun-creator-rewards) | 🟡 LOW PRIORITY | last commit 2026-05-10 | Web app querying `swap-api.pump.fun/coins-v2/{mint}`. Reads upstream API, no on-chain parsing — depends on whether pump.fun's REST normalizes USDC amounts. Add pass-through quote-mint handling. See [`prompts/v2-usdc-rollout/04-pumpfun-creator-rewards.md`](../../prompts/v2-usdc-rollout/04-pumpfun-creator-rewards.md). |
| [nirholas/three.ws](https://github.com/nirholas/three.ws) | 🟡 NEEDS UPDATE | last push 2026-05-19 | Has a vendored copy of `agent-payments-sdk/src/solana/PumpAgentOffline.ts` and pump-event fixtures. Re-sync after audit-payments-sdk publishes V2-stable. See [`prompts/v2-usdc-rollout/05-three-ws-sync.md`](../../prompts/v2-usdc-rollout/05-three-ws-sync.md). |
| [nirholas/pump-fun-workers](https://github.com/nirholas/pump-fun-workers) | ⚪ N/A | last commit 2026-04-03 | Cloudflare Worker MCP. `src/tools.ts` is read-only (`searchTokens`, `getTokenDetails`, `getBondingCurve`, `getTokenTrades`) over pump.fun's public REST API. No instruction building. |
| [nirholas/visualize-web3-realtime](https://github.com/nirholas/visualize-web3-realtime) | ⚪ N/A | last pump-related commit 2026-04-07 | Trade visualizer that consumes the PumpPortal WebSocket feed (not raw on-chain logs). V2 normalization happens upstream. |
| [nirholas/atomic](https://github.com/nirholas/atomic) | ⚪ N/A | this repo | Atomic launch / claim / Jito-bundle scripts. Uses pump-sdk through normal call paths and doesn't decode events itself. Once pump-fun-sdk ships V2, callers here can opt into USDC pairs by passing `quoteMint`. |
| [nirholas/boosty](https://github.com/nirholas/boosty) | ⚪ N/A | (private WIP) | `packages/trading-engine/src/raydium/amm.ts` references `quote_mint` but for Raydium AMMs, not pump.fun. Unaffected. |

## How to verify status on any repo

```bash
# Quick V2 awareness check — looks for any V2 marker
gh search code --owner nirholas --repo nirholas/<repo> \
  "cf118af204221338 OR quote_mint OR USDC_MINT"

# Is the V1 disc tabulated (suggests claim/event parser exists)?
gh search code --owner nirholas --repo nirholas/<repo> \
  "1416567bc61cdb84"

# Check default branch HEAD timestamp / activity
gh api repos/nirholas/<repo> --jq '{name, pushedAt, defaultBranchRef: .default_branch}'
```

## Dependency graph

Some repos depend on others being updated first. The execution order that minimizes rework:

```
1. pump-fun-sdk            (no deps — start here)
2. pump-swap-sdk           (no deps — can run in parallel with 1)
3. pumpfun-claims-bot      (no deps — can run anytime)
4. pumpfun-creator-rewards (no deps — can run anytime; depends on upstream API behavior)
5. three.ws                (depends on agent-payments-sdk being current, which it is)
6. pumpkit peer-dep bump   (depends on 1)
```

The peer-dep bump in pumpkit is left as a manual follow-up rather than a standalone prompt because:

- It's a one-line change in [`packages/core/package.json`](https://github.com/nirholas/pumpkit/blob/main/packages/core/package.json): `"@nirholas/pump-sdk": "^1.32.0"` → `"^1.33.0"`.
- It must be gated on the new pump-fun-sdk version actually being **published to npm**, not just merged. Hard to assert from a prompt.

## Risk summary

| Risk | Severity | Mitigation |
|------|----------|------------|
| pump-fun-sdk fails to ship V2 builders before May 21 | High | Already covered by [01-pump-fun-sdk.md](../../prompts/v2-usdc-rollout/01-pump-fun-sdk.md). Mirror `pumpfun-rust-client/src/sdk/pump_v2.rs` exactly. |
| pumpfun-claims-bot stays dormant; users have outdated bot | Medium | Either port (prompt 03) or retire + redirect users to pumpkit's `@pumpkit/claim`. |
| three.ws vendored copy drifts further from upstream | Medium | Once synced via prompt 05, add `VENDORED.md` documenting the sync convention so future maintenance is cheap. |
| Unknown quote mints whitelisted by pump.fun later | Low | All reference impls already handle this gracefully (default to SOL, log warning). Adding USDT or others is a one-line table entry. |
| Anchor IDL parser version drift across SDKs | Low | All SDKs use Anchor 0.30+ which handles `Option<T>` correctly. Refresh IDLs from upstream wholesale rather than hand-editing. |

## What's not in this audit

- Third-party pump.fun integrations not under nirholas ownership.
- The official `@pump-fun/pump-sdk` and `@pump-fun/pump-swap-sdk` packages — these are upstream, and we mirror them.
- Forks of nirholas repos held by others.

If a new pump-related nirholas repo is added in the future, re-run the `gh search code` queries in the "How to verify" section to slot it into the table.
