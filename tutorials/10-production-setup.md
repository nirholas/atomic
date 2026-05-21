# 10 — Production setup

The per-flow tutorials show how to run each script once. This tutorial covers the operational concerns that come up when you actually run this in production for weeks or months: RPC choice, secret storage, process supervision for long-running watchers, log rotation, and alerting.

If you're only doing one-off launches and collects, you don't need most of this. If you're running `watch-collect.js` 24/7 against a leaked-key coin, you need all of it.

## RPC choice

The toolkit makes 3 broad categories of RPC calls:

| Category | Volume | Sensitivity |
|---|---|---|
| Bundle submission (to Jito) | low (1 call per bundle) | landing-rate critical |
| Account reads (`getBalance`, `getAccountInfo`) | high (every watcher cycle, every holder enum) | rate-limit critical |
| Tx submission / confirmation | low | not critical |

### Recommended providers

| Provider | Use case | Notes |
|---|---|---|
| **Helius** | Watchers + distribution | Best balance of price + rate limits. Free tier handles small ops; Pro/Business for >100 holder distributions |
| **Triton** | High-throughput sniping/sniper-style buys | Higher RPS ceiling than Helius free tier; harder to onboard |
| **QuickNode** | General use | Solid but pricier than Helius for equivalent quota |
| **Jito Block Engine RPC** | Bundle submission only | Required for `getTipAccounts` lookups (use `tools/check-tip-accounts.ts`). Free for submission |
| Public mainnet (`api.mainnet-beta.solana.com`) | Local testing only | Rate-limits within minutes for any non-trivial workload. **Never use in production.** |

### Practical setup

Use **two RPC endpoints**:

```bash
# In .env
RPC_URL=https://your-helius-rpc/      # for normal account reads + tx submission
JITO_RPC=https://mainnet.block-engine.jito.wtf/api/v1/  # for bundles
```

Most scripts already use `RPC_URL` for general calls and a separate Jito endpoint for bundles. Splitting these gives you independent quota for each.

### Backup RPC

For 24/7 watchers, have a fallback. The scripts don't currently auto-failover — you'd need a wrapper. Simplest pattern:

```bash
# pseudocode wrapper around watch-collect.js
while true; do
  RPC_URL=$PRIMARY_RPC npm run watch && break
  echo "Primary failed, falling back" >&2
  RPC_URL=$BACKUP_RPC npm run watch && break
  sleep 30
done
```

The script exits on RPC failure, the wrapper restarts. Not elegant but reliable.

## Secret storage

The toolkit reads keypairs from env vars (base58) or local JSON files. Rules:

1. **Never commit secrets.** `.gitignore` excludes `*.json` by default. Do **not** weaken this; if you need a build JSON tracked, add a narrow allowlist entry, never a blanket exception.
2. **Never paste secrets into chat, issues, PRs, or CI logs.** If you've done this even once, treat the key as compromised — use the toolkit's rescue patterns to drain it.
3. **Production hosts use env vars, not JSON files.** Pass secrets via a secrets manager (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or even just systemd's `EnvironmentFile` with restricted permissions).
4. **The watcher host and the destination host should be different machines.** The watcher needs the creator key — assume it's eventually breached. The destination key never touches the watcher.

### Minimum-privilege wallet split

For a typical leaked-key scenario:

```
┌───────────────────────────┐
│  Watcher host (any VPS)   │
│  - CREATOR_SECRET         │  ◀── this host can be compromised
│  - FUNDER_SECRET          │      worst case: lose tip SOL + current
│                           │      vault accrual since last collect
└───────────────────────────┘
              │
              │ atomic bundle
              ▼
┌───────────────────────────┐
│  Destination (cold/HW)    │
│  - DESTINATION pubkey     │  ◀── secret never on a live host
│    only on watcher        │      
└───────────────────────────┘
```

If the watcher host is fully owned, attacker drains funder + current vault before you notice. Everything already swept to `DESTINATION` is safe.

### Don't bundle the keys

Some users put `FUNDER_KEYPAIR` + `CREATOR_KEYPAIR` + `DESTINATION_KEYPAIR` in the same `.env` file on the same host. **Don't.** The destination keypair has no business being on the watcher host at all — only the pubkey is needed there.

## Process supervision for `watch-collect.js`

The watcher must restart on crash. Three reasonable options.

### Option A — pm2 (simplest)

```bash
npm install -g pm2

# Start
pm2 start watch-collect.js \
  --name watch-collect-mycoin \
  --env-file .env \
  --max-restarts 100 \
  --restart-delay 5000

# Save config for reboot persistence
pm2 save
pm2 startup  # follow the printed instructions to enable on reboot
```

Logs live in `~/.pm2/logs/watch-collect-mycoin-out.log` (stdout) and `…-error.log`. Rotate with `pm2 install pm2-logrotate`.

### Option B — systemd (most robust)

`/etc/systemd/system/watch-collect-mycoin.service`:

```ini
[Unit]
Description=watch-collect for mycoin
After=network-online.target

[Service]
Type=simple
User=watcher
WorkingDirectory=/opt/atomic
EnvironmentFile=/etc/atomic/watch-collect-mycoin.env
ExecStart=/usr/bin/npm run watch
Restart=always
RestartSec=10s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

`/etc/atomic/watch-collect-mycoin.env` (chmod 0600, owned by `watcher`):

```
RPC_URL=https://your-helius-rpc/
DESTINATION=<safe-wallet>
CREATOR_PUBKEY=<base58>
FUNDER_SECRET=<base58>
CREATOR_SECRET=<base58>
MIN_COLLECT_SOL=0.05
JITO_TIP=0.005
```

Enable + start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable watch-collect-mycoin.service
sudo systemctl start watch-collect-mycoin.service

# Logs
journalctl -u watch-collect-mycoin -f
```

### Option C — tmux + while loop (quick & dirty)

For one-off long-runs on a server you ssh into:

```bash
tmux new-session -d -s watch-mycoin \
  "while true; do npm run watch; sleep 5; done"
```

Reattach with `tmux a -t watch-mycoin`. No log rotation, no reboot persistence. Fine for short-lived experiments.

## Log rotation

Watchers run for weeks. Without rotation, logs hit disk caps and the watcher dies.

- **pm2:** `pm2 install pm2-logrotate && pm2 set pm2-logrotate:max_size 50M && pm2 set pm2-logrotate:retain 14`
- **systemd journal:** journal auto-rotates by default. Configure in `/etc/systemd/journald.conf` if you need tighter caps.
- **tmux + redirect to file:** roll your own with `logrotate`. Sample `/etc/logrotate.d/atomic-watcher`:

```
/var/log/atomic-watcher.log {
  daily
  rotate 14
  compress
  missingok
  notifempty
}
```

## Alerting

You want to know when the watcher stops landing bundles. Two signals worth alerting on:

### Signal 1 — landing rate dropped below threshold

```bash
# Pseudocode for a cron'd healthcheck
LANDED=$(grep "Bundle landed" /var/log/atomic-watcher.log | tail -50 | wc -l)
SUBMITTED=$(grep "Bundle submitted" /var/log/atomic-watcher.log | tail -50 | wc -l)
RATE=$((100 * LANDED / SUBMITTED))
if [ "$RATE" -lt 50 ]; then
  curl -X POST $SLACK_WEBHOOK -d "{\"text\": \"Watcher landing rate: ${RATE}% — bump JITO_TIP?\"}"
fi
```

### Signal 2 — vault balance keeps growing (collects not happening)

Hit the RPC directly from outside the watcher host (so this alert doesn't depend on the watcher itself):

```bash
VAULT_BALANCE=$(solana balance <vault-pda> --url $RPC_URL --output json | jq '.lamports')
if [ "$VAULT_BALANCE" -gt 100000000 ]; then  # 0.1 SOL
  curl -X POST $SLACK_WEBHOOK -d "{\"text\": \"Vault has $VAULT_BALANCE lamports uncollected\"}"
fi
```

Run from a separate host. If the watcher dies silently and your only health check is on the watcher, you'll miss it.

## Built-in inspection tools

The repo ships a few tsx-based tools you'll want on the cron of any production deployment:

| Tool | Purpose | Cadence |
|---|---|---|
| `tools/check-tip-accounts.ts` | Diffs your hardcoded Jito tip-account list against the live `getTipAccounts` response. Exits non-zero on drift. | Daily — drift is rare but bundles fail hard when it happens |
| `tools/check-balances.ts <wallet>` | Prints SOL + all SPL/Token-2022 balances for a wallet. Useful as pre/post audit around any sweep. | Manual, plus after every `consolidate.js` |
| `tools/check-pump-funding.ts <wallet>` | Wallet provenance check. See [tutorial 07](./07-audit-wallet-provenance.md). | Ad-hoc / batch when filtering holders |
| `npm run sanity` (`tools/sanity-check.ts`) | No-spend sanity check: validates env vars, RPC reachability, key derivations. | Before every long-running deployment |

Wire `check-tip-accounts.ts` into your cron. Tip-account drift is the kind of failure that produces silent zero-landing rates until you notice, exactly the worst failure mode for a leaked-key watcher.

## Backup destination wallet

If your destination wallet's seed phrase is lost, every successful collect is also lost. Belt and suspenders:

1. Generate destination wallet offline.
2. Store seed phrase in two places: paper backup + a password manager you trust.
3. Send a tiny test tx in before pointing the watcher at it.

## Disaster scenarios

| Scenario | Mitigation |
|---|---|
| Watcher host fully compromised | Rotate funder + creator keys (not possible for the on-chain creator field, but you can move the live operational role to a new wallet pair if you anticipate this). Pre-built kill switch: `consolidate.js` to drain everything. |
| RPC provider outage | Fallback RPC in wrapper (see above). |
| Jito Block Engine downtime | Only affects bundle landings. Vault accumulates safely; watcher exits the cycle and retries. No data loss, only delayed collects. |
| Destination key compromised | Stop the watcher immediately. Move all balances from destination to a fresh cold wallet (no atomicity needed if you act faster than the attacker). Then resume with a new destination. |

## Next steps

- **Diagnosing failed bundles** in production: [tutorial 09 — Jito bundle anatomy](./09-jito-bundle-anatomy.md).
- **End-to-end mental model** of how the pieces fit: [tutorial 08 — End-to-end coin lifecycle](./08-end-to-end-coin-lifecycle.md).
