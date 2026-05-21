---
name: atomic-bundle-debug
description: Use when the user is debugging a Jito bundle that did not land, returned an error, or behaved unexpectedly. Triggers on "bundle didn't land", "Invalid bundle", "Jito returned Invalid", "bundle stuck pending", "tip too low", "Bundles must write lock at least one tip account", "simulation failed", "getBundleStatuses", "check bundle UUID", or any operational failure of Jito-bundle-based scripts in this repo (fire-jito, collect-jito, buy-jito, rescue-tokens, consolidate, distribute when bundled).
---

# atomic-bundle-debug — Jito bundle failure diagnosis

Bundles fail for a small number of well-defined reasons. This skill maps observed symptoms to root causes and to the specific repair action. The goal: take the user from "the bundle didn't land" to a concrete next command in under a minute.

## Decision flow

```
User reports a bundle problem.
│
├─ Does the user have a bundle UUID?
│   ├─ YES → tools/check-bundle-status.ts <uuid>
│   │       └─ classify: LANDED / PROCESSED / PENDING / UNKNOWN / inner-tx failure
│   │
│   └─ NO  → ask script's stdout. fire-jito.js, collect-jito.js etc. all
│            print the bundle UUID at submission time. If the user didn't
│            keep the output, the only signal left is the chain state:
│            did `DESTINATION` receive funds? Did the create tx land?
│
├─ Did the bundle return a synchronous error from sendBundle?
│   ├─ "Invalid" → tip too low for current congestion. Bump JITO_TIP.
│   ├─ "Bundles must write lock at least one tip account" → tip-account
│   │             list drifted. Run tools/check-tip-accounts.ts, update
│   │             JITO_TIP_ACCOUNTS in src/fire-jito.js.
│   ├─ "Bundle simulation failed" → at least one inner tx would revert.
│   │             Inspect the tx with `solana-test-validator`-style local
│   │             sim, OR re-run with verbose web3.js logging.
│   ├─ HTTP 4xx/5xx from block engine → infra issue. Retry on a different
│   │             regional endpoint (amsterdam, frankfurt, ny, tokyo).
│   └─ Auth error → only relevant if you're using a private Jito relayer
│                   with auth tokens. Public block engine is unauth.
│
└─ Did the bundle go silent (no error, no landing)?
    └─ Dropped after acceptance. Either congestion or tip outbid. Wait 5
       slots; if still no slot assigned via getBundleStatuses, treat as
       dropped and re-submit with 2x the tip.
```

## Symptom → diagnosis → action

| Symptom | Likely cause | Action |
|---|---|---|
| `sendBundle` returns `Invalid` | Tip below current floor for the leader | Bump `JITO_TIP` from 0.005 → 0.01 → 0.02. If still failing at 0.02, the leader may be censoring; try a different region |
| `Bundles must write lock at least one tip account` | Hardcoded `JITO_TIP_ACCOUNTS` in script is stale; live list rotated | `npx tsx tools/check-tip-accounts.ts` → patch list in `src/fire-jito.js` (and any other script that hardcodes) |
| `Bundle simulation failed: Custom program error 0x...` | Inner tx would revert. Check pump.fun program error codes — typical: insufficient SOL for `create`, wrong creator pubkey, mint already exists | Read the program error code in pump-sdk source; correct the inputs |
| `getBundleStatuses` returns empty `value` | UUID expired from engine cache (~5 min TTL) or never submitted | Check the original script's stdout for the UUID line; if you have it, the bundle is gone. Re-run the script |
| Bundle status `PROCESSED` but not `CONFIRMED` after 30s | Leader executed it but fork resolution still in flight | Wait. Confirmation lag of 1–2 minutes is normal during high load |
| Bundle status `LANDED` but `err.Err` is set | Inner tx reverted on-chain. The bundle "succeeded" from Jito's view but your operation failed | Inspect the tx sig in the bundle on Solscan / `solana confirm <sig>` |
| `pump-sdk` buy ix builds but bundle fails sim with `MissingAccount` | pump.fun program upgraded; SDK version behind | Switch buys to `buy-jito.js` (Jupiter route, see [[atomic-buy]]) |
| Tip account balance check fails on funder | `FUNDER_SECRET` wallet is dry. Tip is paid by funder | Top up funder with at least `JITO_TIP * 5` SOL |
| `Insufficient funds for rent` in Tx1 of fire-jito | Funder doesn't have enough to cover create rent + tip + dev-buy | Calculate: rent (~0.02 SOL for createV2) + tip + DEV_BUY_SOL + 0.001 buffer. Top up |
| Bundle accepted, never lands, same UUID stays `PENDING` for 10+ slots | Outbid by competing bundle (sniper bot with higher tip) | Re-submit with `JITO_TIP` 3–5x your previous |

## Useful commands

```bash
# Status of a specific bundle by UUID
npx tsx tools/check-bundle-status.ts 8a7b2c3d-...-9f0a

# Diff hardcoded tip accounts against live list
npx tsx tools/check-tip-accounts.ts

# Check wallet balances before re-submitting (was the funder drained?)
npx tsx tools/check-balances.ts <funder-pubkey>

# Poll a bundle UUID until terminal state. Each iteration prints status;
# exits when bundle reaches a non-pending state.
until npx tsx tools/check-bundle-status.ts <uuid>; do sleep 2; done
```

## Regional block-engine endpoints

Default in this repo: `https://mainnet.block-engine.jito.wtf/api/v1/bundles`. When the default returns `Invalid` or 5xx consistently, try a region closer to a leader:

- `https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles`
- `https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles`
- `https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles`
- `https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles`
- `https://slc.mainnet.block-engine.jito.wtf/api/v1/bundles`

Pass to `check-bundle-status.ts` as the second positional arg; for script submission, set `JITO_BLOCK_ENGINE_URL` if the script supports it (some hardcode the default — patch them when needed).

## Tip economics

Tip cost is a real expense paid per attempt regardless of landing. Tune deliberately:

| Scenario | Suggested starting tip |
|---|---|
| Off-peak fee collection (`watch-collect.js` polling) | 0.001–0.003 SOL |
| Standard launch on a quiet block | 0.005 SOL |
| Active sniper competition at launch | 0.01–0.05 SOL |
| Leaked-key rescue with same-key sweeper present | 0.01–0.02 SOL, escalate fast |
| Mass distribution batch | 0.002–0.005 SOL per bundle |

Above 0.05 SOL/bundle the cost typically exceeds the value of one create attempt. Above 0.1 SOL there's almost no legitimate use case — recheck whether your inner tx is even valid first.

## When the bundle landed but the operation didn't work

This is the most confusing failure mode: Jito reports success, but the on-chain effect you wanted didn't happen. Either:

1. The bundle's inner tx executed and reverted (`err.Err` non-null in `getBundleStatuses` response). Read the program error.
2. The bundle landed in a later slot than expected, after the on-chain state had already changed (e.g. someone else's collect-jito landed first). The tx executed against the new state and may have been a no-op.
3. The destination ATA was created mid-tx but the transfer used a stale account index. Rare in modern web3.js.

For case 2 specifically: a "successful" collect-jito that drained 0 SOL means another collector beat you to the vault in the same slot. The bundle landed, your collect tx executed, but the vault was already empty.

## Related

- [atomic-launch](../launch/SKILL.md), [atomic-collect](../collect/SKILL.md), [atomic-buy](../buy/SKILL.md), [atomic-rescue](../rescue/SKILL.md) — flows that submit bundles
- [atomic-leaked-key-response](../leaked-key-response/SKILL.md) — high-stakes scenario where bundle landings determine recovery success
- [tools/check-bundle-status.ts](../../tools/check-bundle-status.ts) — bundle UUID status query
- [tools/check-tip-accounts.ts](../../tools/check-tip-accounts.ts) — tip-account drift check
