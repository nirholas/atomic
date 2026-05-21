# Running as a service

How to run [`src/watch-collect.js`](../../src/watch-collect.js) (the
only long-running script in the toolkit) under a process supervisor
so it survives reboots, crashes, and node hangs. Covers systemd and
pm2; the patterns generalize to any supervisor.

Companion reading:
[`cost-estimates.md`](cost-estimates.md) (how often
`collect-jito.js` gets spawned, and what each spawn costs),
[`rpc-budget.md`](rpc-budget.md) (the RPC quota you're committing to
by running 24/7).

## What needs to be supervised

Only `watch-collect.js`. Everything else in `src/` is a one-shot —
launch it, it exits, no daemonization needed. `watch-collect.js`:

- Loops every `POLL_MS` (default 30,000 ms) until killed.
- On vault accrual ≥ `MIN_COLLECT_SOL`, spawns `collect-jito.js` as a
  child process and forwards the parent env.
- Has no built-in retry/backoff for RPC errors — a bad RPC response
  will print and continue to the next poll. A panic-level crash
  (uncaught exception) terminates the process.

That last point is what makes a supervisor necessary: any single
RPC timeout that escapes to an uncaught reject ends the watcher
until something restarts it.

## Pre-requisites

Before installing a service:

1. **Run the script once manually** to confirm env, RPC, and Jito
   tip are configured correctly. Catching a misconfig in foreground
   is faster than discovering it from journalctl.
2. **Use `tools/sanity-check.ts`** to verify wallets, balances, and
   RPC connectivity without spending fees.
3. **Pick an absolute path** for the project (e.g.
   `/srv/pump-toolkit`) and clone there as the service user — not as
   root.
4. **Place the `.env` outside the repo** if possible
   (`/etc/pump-toolkit/watch.env`, mode 0400, owned by the service
   user). The repo's `.gitignore` excludes `.env*` but
   defense-in-depth.

## systemd (recommended on Linux)

`/etc/systemd/system/pump-watch.service`:

```ini
[Unit]
Description=pump-launch-toolkit — vault watcher
Documentation=https://github.com/nirholas/atomic/blob/main/docs/scripts/watch-collect.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pump
Group=pump
WorkingDirectory=/srv/pump-toolkit
EnvironmentFile=/etc/pump-toolkit/watch.env
ExecStart=/usr/bin/node src/watch-collect.js

# Restart policy
Restart=on-failure
RestartSec=10s
StartLimitIntervalSec=600
StartLimitBurst=10

# Logging — stdout / stderr → journal
StandardOutput=journal
StandardError=journal
SyslogIdentifier=pump-watch

# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/pump-toolkit
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictNamespaces=true
LockPersonality=true
MemoryDenyWriteExecute=true
RestrictRealtime=true
SystemCallArchitectures=native

# Resource bounds
MemoryMax=512M
TasksMax=64

[Install]
WantedBy=multi-user.target
```

Install + start:

```bash
sudo useradd --system --shell /usr/sbin/nologin pump
sudo chown -R pump:pump /srv/pump-toolkit
sudo install -m 0400 -o pump -g pump watch.env /etc/pump-toolkit/watch.env
sudo systemctl daemon-reload
sudo systemctl enable --now pump-watch
sudo systemctl status pump-watch
```

Inspect logs:

```bash
journalctl -u pump-watch -f                    # follow live
journalctl -u pump-watch --since "1 hour ago"  # backfill
journalctl -u pump-watch -p err                # errors only
```

### Why these hardening flags

The service handles base58 private keys. The hardening directives
reduce blast radius if the Node process is compromised:

- `ProtectSystem=strict` + `ReadWritePaths=...` — service can only
  write to its own working dir.
- `PrivateTmp=true` — `/tmp` is per-service; can't read other
  processes' temp files.
- `NoNewPrivileges` — `setuid`/`setgid` ineffective inside the
  service, even if Node spawns a child.
- `MemoryDenyWriteExecute` — blocks JIT injection (Node's V8 isn't
  affected; this is belt-and-braces against shell escapes via spawned
  binaries).

### Spawned `collect-jito.js` inherits the service environment

`watch-collect.js` uses `child_process.spawn` to run
`collect-jito.js`. The child inherits the parent's env including all
secrets. systemd's `EnvironmentFile=` is loaded once at service start
— rotate keys by editing the file and restarting the unit.

## pm2 (Node-native alternative)

If systemd is unavailable (macOS dev, shared hosting, container
runtimes without init), `pm2` is the next-best option.

`ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: 'pump-watch',
      script: 'src/watch-collect.js',
      cwd: '/srv/pump-toolkit',
      interpreter: 'node',
      env_file: '/etc/pump-toolkit/watch.env',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '60s',
      restart_delay: 10000,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: '/var/log/pump-toolkit/watch.out',
      error_file: '/var/log/pump-toolkit/watch.err',
      kill_timeout: 30000,
    },
  ],
};
```

```bash
pm2 start ecosystem.config.js
pm2 save                  # persist across reboots
pm2 startup               # generates the OS-specific autostart hook
```

pm2 buys less hardening than systemd, but more is configurable in
one file. The `kill_timeout: 30000` gives a running
`collect-jito.js` child up to 30 s to finish before SIGKILL — long
enough for the Jito bundle to confirm.

## Log rotation

Both systemd-journal (default size-based rotation) and pm2 (file
output) need rotation discipline.

### systemd

The journal is rotated by `journald` per `/etc/systemd/journald.conf`:

```ini
SystemMaxUse=2G
SystemMaxFileSize=200M
MaxRetentionSec=30day
```

After editing: `sudo systemctl restart systemd-journald`.

### pm2

Install the `pm2-logrotate` module:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

## Healthchecks

`watch-collect.js` doesn't expose an HTTP endpoint. The cheapest
liveness check is "did the process emit a log line in the last
N minutes":

```bash
# Returns 0 if the watcher logged within the last 5 minutes
journalctl -u pump-watch --since "5 min ago" --quiet \
  | grep -q . && echo healthy || echo stale
```

Run that from cron or a Prometheus blackbox-exporter probe. A
"stale" result for >2 polls in a row warrants paging.

For richer signal, wrap the script in a small sidecar that exposes
`/healthz` returning the last vault-balance read. Not in scope here
— but the wrap is straightforward (parse the existing
`process.stderr` poll lines and serve the last value over HTTP).

## Monitoring metrics worth scraping

Even without a sidecar, the journal text is parseable:

| Pattern | Meaning | Alert when |
|---|---|---|
| `Vault balance: <n> SOL` | every `POLL_MS` | No line for `2 × POLL_MS` (watcher hung) |
| `collected. sig:` / `LAUNCHED` | a collect succeeded | None — useful for accounting |
| `Bundle submit failed` | Jito rejected the bundle | Same minute for 3+ consecutive collects |
| `Funder needs ≥` | Funder ran dry | First occurrence — page immediately |
| `Tx errored on chain` | Collect tx confirmed with error | First occurrence — investigate |

A 50-line Loki/Promtail config can turn these into Prometheus
counters with no code change.

## Key rotation under a service

The cheapest rotation flow:

1. Generate the new keypair locally (`solana-keygen new -o new-funder.json`).
2. Fund it (transfer SOL from the old funder).
3. Replace the base58 value in `/etc/pump-toolkit/watch.env`.
4. `sudo systemctl restart pump-watch`.
5. Sweep any residual balance from the old funder to a safe wallet.

The restart loses ≤ `POLL_MS` of poll time, no on-chain effect.

## Multiple watchers from one host

For >1 coin: install per-coin unit files with template syntax.

`/etc/systemd/system/pump-watch@.service`:

```ini
# Identical to above, but:
EnvironmentFile=/etc/pump-toolkit/watch-%i.env
SyslogIdentifier=pump-watch-%i
```

Then:

```bash
sudo systemctl enable --now pump-watch@coinA
sudo systemctl enable --now pump-watch@coinB
```

Each instance gets its own env file and journal namespace.
**Resource ceiling:** at default 30 s polling, each watcher consumes
~88K Solana RPC calls/month; budget the host's outbound RPC quota
accordingly (see [`rpc-budget.md`](rpc-budget.md)).

## Container deployment

If you'd rather run under Docker / k8s:

- Bake the repo into the image (`COPY . /srv/pump-toolkit`).
- Pass the env via `--env-file` (Docker) or a `Secret` mount (k8s).
- Use `restartPolicy: OnFailure` / `unless-stopped` to mimic the
  systemd restart semantics.
- Add a sidecar that tails stdout to your log aggregator.

Resource requests for a single watcher: ~64 MB memory steady-state,
< 1% of a vCPU. Set memory limit to 256 MB to catch leaks.

## Pitfalls

- **Don't run as root.** A privileged compromise turns "lost wallet"
  into "lost host."
- **Don't put the env file inside the repo.** Even with `.gitignore`,
  a future `cp -r` operation can leak it.
- **Watch wall-clock drift.** Solana RPC providers reject txs with
  too-stale blockhashes — `chrony` or `systemd-timesyncd` keeping
  the host within a second of NTP is enough.
- **Don't share the funder wallet across watchers.** If one instance
  drains the funder during a contested collect window, others will
  abort their next collect. Either fund each watcher independently
  or implement a balance-check skill at the next layer up.

## See also

- [`docs/scripts/watch-collect.md`](../scripts/watch-collect.md) —
  the env-var reference for the watcher itself.
- [`docs/operations/cost-estimates.md`](cost-estimates.md) — how
  often the spawned `collect-jito.js` actually fires.
- [`docs/operations/rpc-budget.md`](rpc-budget.md) — per-watcher
  RPC quota.
- [`docs/runbooks/leaked-key-response.md`](../runbooks/leaked-key-response.md)
  — what to do if the watcher's keys are compromised.
