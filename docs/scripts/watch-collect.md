# watch-collect.js

A long-running poller. Polls the creator-vault balance every `POLL_MS` and, when it crosses `MIN_COLLECT_SOL`, spawns [`collect-jito.js`](collect-jito.md) as a child process. Retries forever on failures.

- **Source:** [`src/watch-collect.js`](../../src/watch-collect.js)
- **npm alias:** `npm run watch`
- **Lifetime:** runs indefinitely until killed (Ctrl-C, SIGTERM, host shutdown).

## When to use this

- You launched a coin and want to **continuously** collect fees as they accumulate, instead of running [`collect-jito`](collect-jito.md) by hand each time.
- You want to skip collects when the vault is too small to be worth the Jito tip — `MIN_COLLECT_SOL=0.05` means "only fire when ≥ 0.05 SOL is sitting in the vault."

## Environment

`watch-collect.js` reads:

| Var | Required | Default | Notes |
|---|---|---|---|
| `CREATOR_PUBKEY` | **yes** | — | Base58 *pubkey* (not secret) of the creator whose vault to poll. |
| `POLL_MS` | no | `30000` | Poll interval, ms. |
| `MIN_COLLECT_SOL` | no | `0.05` | Vault threshold (SOL) before firing a collect. |
| `RPC_URL` | no | mainnet-beta | Same RPC for polling and (forwarded to) `collect-jito.js`. |

Plus everything [`collect-jito.js`](collect-jito.md) needs — **the watcher forwards its entire `process.env`** to the child, with `BUFFER_LAMPORTS` forced to `890880`:

| Var | Why the watcher needs it | |
|---|---|---|
| `FUNDER_SECRET` | Forwarded to collect-jito for tx fee + Jito tip. |
| `CREATOR_SECRET` | Forwarded to collect-jito for signing. |
| `DESTINATION` | Forwarded to collect-jito as the drain target. |
| `JITO_TIP` | Forwarded; defaults to 0.005 if not set. |

## What it does

```
loop forever:
  poll the creator vault balance
  if balance < MIN_COLLECT_SOL:
    print one-line status (overwriting), keep looping
  else:
    spawn `node src/collect-jito.js` with the same env (+ BUFFER_LAMPORTS=890880)
    capture stdout + stderr
    log success or failure + last few interesting lines
  sleep POLL_MS
```

A counter of `successful/total` runs is shown in the status line.

## Example

```bash
DESTINATION=<base58 pubkey> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
CREATOR_PUBKEY=<base58 pubkey> \
MIN_COLLECT_SOL=0.05 \
POLL_MS=30000 \
npm run watch
```

Output (representative — the "vault < threshold" line rewrites itself with `\r`):

```
Watcher started.
  creator:     9aPq…Yz1k
  poll every:  30 s
  threshold:   0.05 SOL
  destination: 7yYx…Mq8P

[14:02:11] vault=0.0421 SOL (< 0.05)  collects=0/0
[14:02:42] vault=0.0518 SOL >= 0.05 — firing collect...
[14:02:54] success #1/1: Destination balance: 0.0518 SOL
[14:03:24] vault=0.0019 SOL (< 0.05)  collects=1/1
…
```

## Run it under a supervisor

`watch-collect.js` is meant to run for days/weeks. Crashes during long sessions can come from RPC flakiness or transient Jito errors. Run it under `systemd`, `pm2`, `tmux`, or a Docker container with `restart: unless-stopped`. The script does not auto-restart itself.

Minimal systemd unit:

```ini
[Unit]
Description=pump.fun creator-fee watcher
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/atomic
EnvironmentFile=/opt/atomic/.env
ExecStart=/usr/bin/node src/watch-collect.js
Restart=always
RestartSec=10
User=atomic

[Install]
WantedBy=multi-user.target
```

## Failure modes

| Symptom | Cause | Effect |
|---|---|---|
| `poll error: …` printed but loop continues | Transient RPC error during vault balance read. | Watcher retries on next tick. No tx attempted; nothing to clean up. |
| `FAILED (code N). Will retry next tick.` | Child `collect-jito.js` exited non-zero. | Watcher logs the tail and waits `POLL_MS` before trying again. |
| Persistent failures with `Bundle submit failed` / `Bundles must write lock at least one tip account` | Jito tip-account list has rotated. | Update the hardcoded list in [`src/collect-jito.js`](../../src/collect-jito.js). See [Setup → tip-account refresh](../setup.md#tip-account-refresh). |
| Hangs after Ctrl-C | The current `collect-jito.js` child is mid-confirm. | The child finishes (or times out at 60 s) before the watcher's loop sees the signal. Wait or send SIGKILL. |

## Notes

- The watcher uses `child_process.spawn('node', ['src/collect-jito.js'], …)`. It runs *the same script you'd run by hand*, with the same exit semantics. If you want to dry-run, replace the command with `echo` in [`src/watch-collect.js`](../../src/watch-collect.js).
- Vault balance reads go through `@nirholas/pump-sdk`'s `OnlinePumpSdk.getCreatorVaultBalance`, which is a single RPC call (an account read). Cheap; safe to poll every 30 s on any provider.
- The watcher itself doesn't need `FUNDER_SECRET` / `CREATOR_SECRET` for polling — it only forwards them to the child. So you can technically run the watcher with only `CREATOR_PUBKEY` set… but then every fired collect will fail until the child's required vars are present. Always set them all.
- There's no per-coin cap: the watcher will keep firing forever. If you only want to collect N times, wrap in a shell loop with a counter instead.
