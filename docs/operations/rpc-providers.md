# RPC providers

You need a Solana RPC endpoint to do anything in this toolkit. Public mainnet RPC works for trivial use; **for any real workload, get a paid provider**. Rate-limits on the public RPC will kill long-running scripts within minutes.

This file compares the providers commonly used with this toolkit. Prices and limits change frequently — use this as a starting point and verify on the provider's site.

## Recommendation in one line

**Helius** for general pump.fun work. Free tier is enough to run `watch-collect.js`, paid tiers start at ~$50/mo. Solana-native, has the DAS / Asset APIs the SDK occasionally uses, and good support.

If you don't want Helius for some reason: Triton One for raw RPC performance, QuickNode if you also work multi-chain.

## Provider comparison

| Provider | Pros | Cons | Best for |
|----------|------|------|----------|
| **[Helius](https://helius.dev)** | Generous free tier; Solana-native; great DAS API; WS subscriptions reliable. | Slightly higher latency than Triton in benchmarks. | General-purpose. Default pick. |
| **[Triton One](https://triton.one)** | Lowest latency for raw RPC; fast getProgramAccounts. | More expensive; less developer-friendly. | Latency-critical (sniper bots, market-making). |
| **[QuickNode](https://quicknode.com)** | Multi-chain; nice dashboard. | Tighter rate limits on free; pay-per-request gets pricey. | Teams that already use QuickNode for EVM work. |
| **[Shyft](https://shyft.to)** | Cheap; pump.fun-specific webhooks. | Smaller player; check current status. | Pure pump.fun analytics workloads. |
| **[Alchemy](https://alchemy.com)** | Well-known; great UI. | Solana support is newer than the EVM side; some methods missing. | Teams standardized on Alchemy. |
| **Public mainnet (`api.mainnet-beta.solana.com`)** | Free, no signup. | Aggressively rate-limited; no SLA. | Quick tests, never production. |

## What pump.fun work specifically needs from an RPC

1. **`getSignaturesForAddress` with paging.** Used by provenance scans (`tools/check-pump-funding.ts`). Some cheap providers truncate or charge per page.
2. **`getProgramAccounts` (or `getProgramAccountsV2`).** Used to list pump.fun coins, holders, etc. Returns a *lot* of data — expensive on usage-based pricing.
3. **`getTransaction` with `maxSupportedTransactionVersion: 0`.** Required for any tx using LUTs (which is most pump-sdk buy/sell ixs as of mid-2026).
4. **WebSocket `logsSubscribe`.** Used by long-running listeners (`watch-collect.js` doesn't need this; observability tools do).
5. **Reasonable rate limits.** Sustained 50-100 req/sec is typical; "free" tiers cap at 10-50 req/sec.

If a provider lacks any of these, it's not viable for this toolkit.

## How to use a paid RPC with this toolkit

In `.env`:

```bash
RPC_URL=https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}
```

(Or whatever URL the provider gave you. Helius's URL includes the API key as a query param; other providers use Bearer headers, but the scripts here treat the URL as opaque.)

For separate read-heavy operations (provenance scans), set a secondary URL:

```bash
READ_RPC_URL=https://api.mainnet-beta.solana.com   # fall back to public for tools/check-pump-funding.ts
```

Most scripts read `RPC_URL` only. The provenance tool reads `READ_RPC_URL` first, falling back to `RPC_URL`. Splitting lets you reserve your paid quota for tx-signing operations and burn through public-RPC rate limits on read-heavy provenance walks (which retry on 429).

## Optimizing cost

- **Cache aggressively.** The same `getBondingCurve` for the same mint within a 1-second window doesn't change.
- **Batch where supported.** `getMultipleAccounts` returns up to 100 accounts in one call, vs 100 separate `getAccountInfo` calls.
- **Use WebSocket for log polling** instead of HTTP polling. One persistent connection vs N requests/minute.
- **Filter `getProgramAccounts` with `dataSlice`** when you only need a few bytes per account.
- **Skip provenance scans you don't need.** A new wallet whose first tx is 10 hours old doesn't need a 5000-signature scan to determine its origin.

## Throttling and retry

The atomic toolkit scripts retry on 429 / 500 with exponential backoff. If you're consistently hitting your provider's rate limit:

1. Upgrade your plan.
2. Lower your script's polling cadence.
3. Switch to a provider with higher limits.
4. Run scripts on different IPs (some providers limit per-IP within a plan).

## WebSocket reliability

For long-running flows (`watch-collect.js`, fee monitors):

- **Helius WS**: stable, auto-reconnects fine.
- **Triton WS**: fast, occasional disconnects on US-East off-hours.
- **Public WS**: don't.

Always design scripts to **detect WS disconnection and reconnect**. The atomic toolkit's long-running scripts do this, but if you write your own, copy the pattern.

## Privacy considerations

Your RPC provider sees every wallet you query and every tx you broadcast. Implications:

- **Don't query your destination wallets from the same RPC you broadcast from.** Splits attribution.
- **Avoid asking the same RPC about both funder and destination** if anonymity matters.
- **Use the public RPC** for read-only one-off lookups where you'd prefer not to log the wallet against your paid-RPC account.

Full anonymity is hard. If it matters, route via Tor or run your own validator. Both are out of scope for this toolkit.

## Local validator?

For development:

```bash
# Solana CLI's bundled local validator
solana-test-validator --reset
RPC_URL=http://localhost:8899 npm run launch
```

Caveats:

- **pump.fun's programs aren't deployed locally by default.** You'd need to clone them via `--clone <PROGRAM_ID>`.
- **Jito doesn't exist on local.** All `*-jito.js` scripts fail.
- **Fee recipients aren't initialized.** Some flows will fail with `AccountNotFound`.

Local validators are useful for testing *your* scripts in isolation but useless for testing pump.fun-specific flows. Use a mainnet throwaway wallet instead.

## When to switch providers

Signs you've outgrown your current provider:

- **Persistent 429s** during your normal workload.
- **Latency floor > 200ms** for simple `getAccountInfo` calls.
- **WS disconnections more than once a day** without reason.
- **Missing methods** required by an upgrade (rare but happens).

Switching is one `.env` edit. Test against a throwaway wallet on the new provider before committing to it.

## Related

- [`jito-tips.md`](./jito-tips.md) — Jito Block Engine endpoints (different from your RPC)
- [`cost-estimates.md`](./cost-estimates.md) — including RPC costs in total launch budget
- [`../security/threat-model.md`](../security/threat-model.md) — T6 (RPC observability) threat
