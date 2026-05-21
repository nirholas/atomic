# Runbook: RPC degraded or failing

The public `api.mainnet-beta.solana.com` endpoint is rate-limited, sometimes lags by tens of slots, and is the most common cause of "bundle not landing" or "createV2 reverted with stale blockhash." This runbook covers detection and switching.

**Time budget:** 2 minutes to detect, 1 minute to swap, then retry the failed operation.

---

## Symptoms

| Observation | Likely RPC issue |
|---|---|
| `Blockhash not found` after submit | RPC is several slots behind; the blockhash you fetched expired before reaching the leader |
| `getLatestBlockhash` takes >2 seconds | RPC is rate-limiting you or under load |
| `429 Too Many Requests` | You're over the rate limit |
| `getSignatureStatus` returns null for a tx you can see on Solscan | RPC index is lagging |
| Bundles consistently drop with "Bundle expired" | RPC and block engine see different head slots |
| Scripts hang for 30+ seconds with no progress | RPC connection is stalled |

---

## Detection commands

### Health endpoint

```bash
curl -s "$RPC_URL" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq
```

Expected: `{"jsonrpc":"2.0","result":"ok","id":1}`.

Bad: `{"jsonrpc":"2.0","error":{"code":-32005,"message":"Node is behind by N slots"}}` — switch RPCs.

### Slot lag

Compare your RPC's slot to a known-good reference:

```bash
# Your RPC
curl -s "$RPC_URL" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | jq .result

# A reference (Solana Foundation public)
curl -s "https://api.mainnet-beta.solana.com" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | jq .result
```

Acceptable lag: 0–2 slots. Lag of 10+ slots means your RPC is degraded; submit anything through it and the blockhash will expire mid-flight.

### Rate-limit headers

Most providers expose remaining quota in response headers:

```bash
curl -s -D - "$RPC_URL" -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' | head -20
```

Look for `X-RateLimit-Remaining` or `Retry-After`. If `Remaining` is at zero, you're rate-limited; either wait, upgrade your plan, or switch.

---

## RPC tiers, in order of preference

The repo's `RPC_URL` env var accepts any URL. Common options:

| Tier | Provider | Cost | When to use |
|---|---|---|---|
| Free public | `api.mainnet-beta.solana.com` | $0 | Quick scripts, never for production launches |
| Free trial | Helius / QuickNode / Triton trial | $0 | One-off launches; ratelimited but fine for a few txs |
| Paid baseline | Helius Pro / QuickNode Discover | $50–100/mo | Most production use; covers `watch-collect.js` |
| Paid premium | Helius Enterprise / Triton enterprise / dedicated | $500+/mo | Heavy bot ops, multiple watchers, latency-sensitive launches |

The public endpoint is fine for one-off small operations but breaks down under any of:
- More than 5–10 RPC calls per second
- Sustained `watch-collect.js` polling
- Bundle submission during congestion (the public endpoint lags badly when traffic spikes)

### Picking a provider

For pump.fun ops specifically:

- **Helius**: best for general use, has a pump.fun-specific webhook product if you graduate beyond polling.
- **Triton**: low-latency, popular for searcher/bot use.
- **QuickNode**: good UI, easy to provision additional endpoints.
- **Self-hosted**: rare for pump.fun ops; the operational overhead doesn't pay off vs. paid endpoints.

There's no "right" choice. They all expose the same JSON-RPC. Latency and rate limits are what vary.

---

## Switching mid-incident

If you're in the middle of a failing operation and need to swap RPCs:

```bash
# Option 1: export new URL in current shell
export RPC_URL="https://mainnet.helius-rpc.com/?api-key=..."
npm run launch

# Option 2: edit .env and source it
echo 'RPC_URL=https://mainnet.helius-rpc.com/?api-key=...' > .env
npm run launch
```

The scripts pick up `RPC_URL` at start time. Long-running scripts (`watch-collect.js`) need a restart.

---

## RPC + WebSocket split

For scripts that subscribe to events, you also need a WebSocket endpoint. The toolkit reads `SOLANA_WS_URL` if set; if absent, it derives it from `RPC_URL` (replacing `https://` with `wss://`).

Most providers expose both at parallel paths:

```
HTTPS:  https://mainnet.helius-rpc.com/?api-key=KEY
WSS:    wss://mainnet.helius-rpc.com/?api-key=KEY
```

If your script's WebSocket sub keeps disconnecting (`pongTimeout`, `WS connection closed`), the WebSocket endpoint is degraded. Some providers have separate rate limits for WS — you might be HTTP-healthy and WS-broken at the same time.

---

## Designing for RPC failure

For production ops, assume your RPC will fail at some point. Patterns that reduce blast radius:

### 1. Configure a fallback URL

```javascript
const RPCS = [
  process.env.RPC_URL,
  process.env.RPC_URL_BACKUP,
  "https://api.mainnet-beta.solana.com",
].filter(Boolean);

async function withFallback(fn) {
  for (const rpc of RPCS) {
    try {
      return await fn(new Connection(rpc));
    } catch (e) {
      if (isRetryable(e)) continue;
      throw e;
    }
  }
  throw new Error("all RPCs failed");
}
```

Currently the toolkit's scripts use a single RPC by design (simpler, fewer edge cases). If you fork to add fallback, this is the pattern.

### 2. Fetch the blockhash close to submit time

Don't fetch a blockhash, build a long transaction, then submit. The blockhash window is ~150 slots (~60 seconds). For Jito bundles, you want submission within ~10 seconds of the blockhash fetch to have a realistic chance of landing.

### 3. Use `confirmed` commitment for blockhash, `finalized` for state reads

```javascript
const { blockhash } = await connection.getLatestBlockhash("confirmed");  // for tx building
const balance = await connection.getBalance(pubkey, "finalized");        // for state checks
```

`processed` is too unstable for blockhash use; `finalized` is too slow and gives you a blockhash that's already near-expired by the time you submit.

### 4. Retry only on transient errors

Distinguish RPC failures (retry against another RPC) from logical failures (don't retry; the operation will fail again).

| Error | Retryable? |
|---|---|
| `Blockhash not found` | YES (fresh blockhash + retry) |
| `Node is behind` | YES (different RPC) |
| `429 Too Many Requests` | YES (after `Retry-After` delay) |
| `Account already in use` | NO (mint already minted) |
| `Insufficient funds` | NO (funder doesn't have enough SOL) |
| `Custom program error: 0x1` | NO (program-level rejection) |

---

## Specific provider quirks

### Helius

- Rate limit applies *across all your endpoints* on the same API key. Spinning up multiple endpoints with the same key doesn't multiply your quota.
- Their `getAsset`-family endpoints (DAS API) are billed separately from JSON-RPC.
- The dashboard's "current load" metric lags by 1–2 minutes.

### Triton

- Multiple regional endpoints; pick one close to your script's host.
- The `solana-rpc` endpoint is faster than the `senderr-rpc` endpoint for sends; routing to the wrong one wastes ~50ms per call.

### QuickNode

- Provisioning a new endpoint takes 1–2 minutes after creation before it's actually live.
- The default rate limit per endpoint is conservative; raise it in the UI if you hit 429s.

### Public endpoint (`api.mainnet-beta.solana.com`)

- ~10 req/s soft limit (no `X-RateLimit-Remaining` header; you just get 429s).
- WebSocket subscriptions disconnect after ~5 minutes of inactivity.
- Lags behind real head by 5–20 slots during congestion.

---

## Related

- [`docs/runbooks/bundle-not-landing.md`](bundle-not-landing.md) — the meta-runbook this feeds into
- [`docs/setup.md`](../setup.md) — initial RPC selection at setup time
- [`docs/jito-bundle-mechanics.md`](../jito-bundle-mechanics.md) — why blockhash freshness matters for bundles
