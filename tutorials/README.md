# Tutorials

Step-by-step walkthroughs for each major flow in the atomic toolkit. Each tutorial is self-contained — you can read them in any order, but if you're new, start with [01](./01-launch-pump-coin-via-jito.md).

All tutorials assume you've run setup once:

```bash
# All commands run from the repo root
npm install
cp .env.example .env
# fill in RPC_URL and any other base vars; per-flow vars are passed inline in each tutorial
```

### Per-flow walkthroughs

| # | Tutorial | Script(s) | When you'd use it |
|---|---|---|---|
| 01 | [Launch a pump.fun coin via Jito bundle](./01-launch-pump-coin-via-jito.md) | `metadata.js`, `fire-jito.js`, `fire-atomic-create.js` | New coin where funder ≠ on-chain creator |
| 02 | [Collect creator fees atomically](./02-collect-creator-fees.md) | `collect-jito.js`, `watch-collect.js` | Vault drains on a leaked/shared creator key |
| 03 | [Buy via Jupiter inside a Jito bundle](./03-buy-via-jupiter-jito.md) | `buy-jito.js` | pump-sdk drift, or MEV-protected snipes |
| 04 | [Rescue tokens from a leaked wallet](./04-rescue-tokens-leaked-key.md) | `rescue-tokens.js` | SPL/Token-2022 escape under sweeper pressure |
| 05 | [Distribute USDC rewards to holders](./05-distribute-usdc-rewards.md) | `distribute.js` | Sqrt-weighted payouts or EMERGENCY sweep |
| 06 | [Consolidate vault + wallets in one bundle](./06-consolidate-wallets.md) | `consolidate.js` | Retiring a coin or shutting down a leaked setup |
| 07 | [Audit wallet provenance (pump.fun seeding)](./07-audit-wallet-provenance.md) | `tools/check-pump-funding.ts` | Forensics, anti-Sybil filtering |

### Operational depth

| # | Tutorial | Covers |
|---|---|---|
| 08 | [End-to-end coin lifecycle](./08-end-to-end-coin-lifecycle.md) | Launch → watcher → rewards → retire chained into one narrative; total cost breakdown |
| 09 | [Jito bundle anatomy & troubleshooting](./09-jito-bundle-anatomy.md) | What's in a bundle, why landings fail, decision tree for diagnosing `Invalid` / non-landings |
| 10 | [Production setup](./10-production-setup.md) | RPC choice, secret storage, supervisors (`pm2`/`systemd`), log rotation, alerting |
| 11 | [Vanity address grinding](./11-vanity-address-grinding.md) | `solana-keygen grind` vs `grind.js`, prefix-length time tables, when to bother |

## Conventions

- All commands run from the repo root. Scripts live in `src/`; `package.json` exposes `npm run <name>` shortcuts (see `package.json` for the full list).
- Secrets are passed as env vars in the examples for readability. In practice, put them in `.env` (which is gitignored) and rely on `dotenv`.
- `JITO_TIP=0.005` is the starting default everywhere. Bump to `0.01`–`0.02` if your bundles return `Invalid`.
- Where a tutorial references another flow, the link uses the same numbering above.

## Safety reminders

- The toolkit is designed for the case where **creator or funder keys are shared/leaked**. Sweeper bots watch those addresses. Any non-atomic flow loses SOL.
- Destination wallets in every tutorial should be **cold, single-controller** wallets. Never set `DESTINATION` to an exchange deposit address.
- `.gitignore` excludes `*.json` — do not weaken it. Keypairs live on disk only inside paths the repo refuses to track.
