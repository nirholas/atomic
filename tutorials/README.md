# Tutorials

Step-by-step walkthroughs for each major flow in the atomic toolkit. Each tutorial is self-contained — you can read them in any order, but if you're new, start with [01](./01-launch-pump-coin-via-jito.md).

All tutorials assume you've run setup once:

```bash
cd tmp/leaked-launch
npm install
cp .env.example .env
# fill in RPC_URL and any other base vars; per-flow vars are passed inline in each tutorial
```

| # | Tutorial | Script(s) | When you'd use it |
|---|---|---|---|
| 01 | [Launch a pump.fun coin via Jito bundle](./01-launch-pump-coin-via-jito.md) | `metadata.js`, `fire-jito.js`, `fire-atomic-create.js` | New coin where funder ≠ on-chain creator |
| 02 | [Collect creator fees atomically](./02-collect-creator-fees.md) | `collect-jito.js`, `watch-collect.js` | Vault drains on a leaked/shared creator key |
| 03 | [Buy via Jupiter inside a Jito bundle](./03-buy-via-jupiter-jito.md) | `buy-jito.js` | pump-sdk drift, or MEV-protected snipes |
| 04 | [Rescue tokens from a leaked wallet](./04-rescue-tokens-leaked-key.md) | `rescue-tokens.js` | SPL/Token-2022 escape under sweeper pressure |
| 05 | [Distribute USDC rewards to holders](./05-distribute-usdc-rewards.md) | `distribute.js` | Sqrt-weighted payouts or EMERGENCY sweep |
| 06 | [Consolidate vault + wallets in one bundle](./06-consolidate-wallets.md) | `consolidate.js` | Retiring a coin or shutting down a leaked setup |
| 07 | [Audit wallet provenance (pump.fun seeding)](./07-audit-wallet-provenance.md) | `tools/check-pump-funding.ts` | Forensics, anti-Sybil filtering |

## Conventions

- All commands assume you're in `tmp/leaked-launch/` unless the tutorial says otherwise (`07` is the only exception — it runs from repo root).
- Secrets are passed as env vars in the examples for readability. In practice, put them in `.env` (which is gitignored) and rely on `dotenv`.
- `JITO_TIP=0.005` is the starting default everywhere. Bump to `0.01`–`0.02` if your bundles return `Invalid`.
- Where a tutorial references another flow, the link uses the same numbering above.

## Safety reminders

- The toolkit is designed for the case where **creator or funder keys are shared/leaked**. Sweeper bots watch those addresses. Any non-atomic flow loses SOL.
- Destination wallets in every tutorial should be **cold, single-controller** wallets. Never set `DESTINATION` to an exchange deposit address.
- `.gitignore` excludes `*.json` — do not weaken it. Keypairs live on disk only inside paths the repo refuses to track.
