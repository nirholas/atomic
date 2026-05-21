---
name: atomic-watch
description: Use when the user wants a long-running poller that monitors a pump.fun coin's creator-fee vault and automatically runs `collect-jito` whenever the accumulated balance crosses a threshold. Triggers on "watch creator fees", "auto-collect", "watch-collect.js", "deploy collect bot on Railway", "long-running collect", or any request to schedule recurring vault drains without manual intervention.
---

# atomic-watch — long-running auto-collect for pump.fun creator fees

`src/watch-collect.js` is a daemon that polls a coin's `coinCreatorVault` PDA on a schedule and fires `src/collect-jito.js` (atomically: collect + drain to `DESTINATION`) when the vault crosses `MIN_COLLECT_SOL`.

It's the script you deploy to Railway / Fly / a screen session when you want creator fees swept to a safe wallet automatically.

## When to invoke

Pick this skill when the user wants to:

- **Deploy an auto-collect bot** to a persistent host (Railway, Fly, bare VM, screen session).
- **Avoid manually running `collect-jito.js`** every time the vault fills up.
- **Drain on a threshold** (e.g. "only collect when ≥ 0.05 SOL has accumulated, otherwise the Jito tip eats the proceeds").

Skip this skill if the user only wants:

- A one-shot collect right now → use `skills/collect/`.
- A full drain (vault + creator + funder) → use `skills/consolidate/`.
- Notifications without collection → use `tools/check-balances.ts` polled by your own cron.

## Required environment

```bash
RPC_URL=...                     # paid provider strongly recommended for long-running
FUNDER_SECRET=<base58>          # or FUNDER_KEYPAIR=./funder.json
CREATOR_PUBKEY=<base58>         # pubkey only; the script doesn't need the secret for polling
CREATOR_SECRET=<base58>         # needed to sign the collect ix when threshold is met
MINT=<base58>                   # the pump.fun coin's mint
DESTINATION=<base58>            # safe wallet for the drained SOL
MIN_COLLECT_SOL=0.05            # vault threshold (SOL) before firing collect
POLL_INTERVAL_SECONDS=30        # default 30; lower if your RPC supports it
JITO_TIP=0.005                  # raise in busy markets
```

`CREATOR_PUBKEY` lets you keep the creator secret offline most of the time — the poller only needs the pubkey. The secret is loaded at collect-fire time. This is the *less wrong* option for a long-running daemon; the *right* option is a remote signer (out of scope).

## Usage

Foreground:

```bash
npm run watch
# or
node src/watch-collect.js
```

Background (Railway / Fly / systemd):

```bash
# In Railway's `Start Command`:
node src/watch-collect.js
```

The script logs every poll cycle, every threshold crossing, and every collect attempt.

## Operational characteristics

- **Poll cadence**: `POLL_INTERVAL_SECONDS` (default 30s). Faster polling costs more RPC requests; slower polling means fees sit in the vault longer.
- **Exit behavior**: any uncaught exception exits the process. Use a supervisor (PM2, systemd, Railway's restart policy, Fly's machine restart).
- **Memory**: ~100 MB resident. No leaks observed over multi-day runs.
- **RPC rate limits**: Helius free tier sustains ~60s polls indefinitely. Public RPC will rate-limit within minutes.
- **Tip auction**: if collect bundles return `Invalid`, the script logs and retries with the same tip. Raise `JITO_TIP` if this becomes persistent.

## Failure modes and fixes

| Symptom | Cause | Fix |
|---------|-------|-----|
| Script exits silently after a few minutes | RPC rate-limited or network glitch | Use a paid RPC; add a supervisor that restarts on exit. |
| `"Vault below threshold"` repeatedly | Vault isn't filling | Check the coin has trading volume; consider lowering `MIN_COLLECT_SOL`. |
| Collect bundles consistently `Invalid` | Stale tip-account list | `npm run check-tip-accounts`; update. |
| `"FUNDER_SECRET not set"` | `.env` not loaded by the supervisor | Set env vars in the supervisor's config (Railway env tab, systemd `EnvironmentFile`). |
| Multiple collects firing in parallel | Two instances of `watch-collect.js` running | Use a supervisor that enforces single-instance. |

## Worked example — Railway deployment

1. Fork or clone this repo into your Railway project.
2. Railway → Variables: set every `*_SECRET`, `MINT`, `DESTINATION`, `MIN_COLLECT_SOL`, `JITO_TIP`, `RPC_URL`.
3. Railway → Settings → Start Command: `node src/watch-collect.js`.
4. Deploy. Logs should show "Polling vault..." every 30s.
5. After the vault crosses `MIN_COLLECT_SOL`, you should see a "Collecting..." line followed by a Solscan link.

The destination wallet's balance should grow over time. Verify with `npm run check-balances -- <destination>`.

## Reference

- Script: [`src/watch-collect.js`](../../src/watch-collect.js)
- Per-script docs: [`docs/scripts/watch-collect.md`](../../docs/scripts/watch-collect.md)
- Atomic primitive: [`skills/collect/`](../collect/) (the one-shot collect that this daemon wraps)
