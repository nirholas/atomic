# Monitoring pump.fun activity

How to observe what's happening on pump.fun off-chain: indexers, RPC subscriptions, webhook providers, and the trade-offs between them. Useful for running watchers more sophisticated than [`watch-collect.js`](scripts/watch-collect.md)'s polling loop.

---

## Why monitor pump.fun

A handful of common needs:

| Need | Why |
|---|---|
| **Trigger collects** when a coin's creator vault crosses a threshold | The toolkit's `watch-collect.js` does this via polling — works fine for one coin, scales poorly |
| **Detect when your coin migrates** to pump-swap AMM | Migration changes the post-trade fee model and graduates the coin's bonding curve |
| **Alert on unauthorized outflows** from your wallets | Sweeper-bot early warning |
| **Track competitor coin launches** | Market intelligence, copy-trading opportunities |
| **Detect when a new coin starts trading heavily** | Sniper bot logic |

The right tool depends on which need you have. There's no single "best" approach.

---

## Approach 1: RPC polling

What [`watch-collect.js`](scripts/watch-collect.md) does. You periodically call `getBalance` on the creator-vault PDA and act when it crosses a threshold.

**Pros:**
- Simple. No subscriptions, no webhooks, no extra infra.
- Stateless. Restarting the script costs nothing.
- Works on any RPC.

**Cons:**
- Polling lag (default 30s in the toolkit). Sweeper bots act in seconds.
- Burns RPC quota proportional to polling frequency × number of polled accounts.
- Doesn't scale to monitoring 50+ accounts; you'd hit rate limits.

**When to use:** monitoring 1–5 accounts. Most pump.fun creators with a few coins.

**Tuning:** balance polling interval vs. RPC budget. 30s is fine for a vault that drains 1–2x daily. For high-activity coins, 5s is reasonable on a paid plan. Sub-second polling is wasteful — Solana block time is ~400ms and your collect tx itself takes 1–3s to confirm.

---

## Approach 2: WebSocket subscriptions

The Solana RPC supports `accountSubscribe` and `logsSubscribe` over WebSocket. You can subscribe to a specific PDA and get pushed on every change.

```javascript
import { Connection } from "@solana/web3.js";
const ws = new Connection(WS_URL, "confirmed");

const subId = ws.onAccountChange(
  creatorVaultPDA,
  (accountInfo, context) => {
    console.log("vault changed", accountInfo.lamports, "at slot", context.slot);
  },
  "confirmed",
);
```

**Pros:**
- Real-time. <500ms from on-chain change to your callback.
- Lower RPC quota cost than polling (per change rather than per check).

**Cons:**
- WebSocket subscriptions are flaky on most public RPCs — connections drop, subscriptions silently die.
- You have to handle reconnection logic, missed-event recovery, and dedup.
- Paid plans usually charge separately for WS connections; some have low connection limits.

**When to use:** real-time requirement is critical (e.g. sniper bot, anti-sweeper monitor). Not necessary for routine vault collection.

**Caveat:** `logsSubscribe` is more useful than `accountSubscribe` for pump.fun specifically, because pump.fun emits Anchor-style events in inner instructions that you can parse for richer signals (buy/sell amounts, who bought, etc.). See [Approach 4: event parsing](#approach-4-event-parsing).

---

## Approach 3: Geyser / gRPC

For high-throughput monitoring (hundreds of accounts, sub-second latency), the standard pattern is **Geyser** — Solana's plugin interface for streaming validator data via gRPC.

You don't run Geyser yourself unless you operate a validator. Instead, you use a hosted Geyser feed:

| Provider | Notes |
|---|---|
| **Helius LaserStream** | Hosted Geyser, account-filter syntax, $$$$ |
| **Triton One** | gRPC streams, similar pricing tier |
| **Yellowstone gRPC** | Open-source Geyser plugin; some providers expose it |

These are real-time, scale to thousands of monitored accounts, and provide a guaranteed delivery model that WebSocket doesn't. The downside is **cost**: typical pricing is $500–2000/month entry tier.

**When to use:** running a serious bot operation with multiple coins and high-value latency requirements. Overkill for personal pump.fun ops.

---

## Approach 4: Event parsing

pump.fun emits Anchor events (via CPI to the event authority) for every state-changing instruction. Parsing these events gives you structured data about every trade, launch, and migration.

The events and their byte layouts are documented in [`docs/v2-usdc-rollout/02-event-layouts.md`](v2-usdc-rollout/02-event-layouts.md).

To consume events, you have two main paths:

### 4a. Parse from confirmed txs

After a tx confirms, fetch it with `getTransaction({maxSupportedTransactionVersion: 0})` and walk the inner instructions for event CPIs:

```javascript
const tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
for (const innerIxSet of tx.meta.innerInstructions ?? []) {
  for (const ix of innerIxSet.instructions) {
    if (ix.programIdIndex === eventAuthorityIdx) {
      // decode ix.data as Anchor event
      const event = decodeEvent(ix.data);
      console.log(event);
    }
  }
}
```

This is a "pull" pattern — you decide when to fetch and parse. Good for batch processing.

### 4b. Parse from logs over WebSocket

`logsSubscribe` with the pump.fun program ID pushes you the program logs in real time:

```javascript
ws.onLogs(PUMP_PROGRAM_ID, (logs, ctx) => {
  for (const line of logs.logs) {
    if (line.startsWith("Program data:")) {
      const event = decodeBase64Event(line.slice(14));
      // dispatch on event type
    }
  }
});
```

This is a "push" pattern — events arrive as they happen.

### 4c. Use the SDK's event decoders

[`@nirholas/pump-sdk`](https://github.com/anthropics/pump-sdk) exports typed event decoders for V2 events (this repo's [`refactor(channel): use typed V2 event decoders`](https://github.com/anthropics/atomic/commit/54768bc) commit added the upstream usage). Wherever possible, lean on the SDK rather than hand-rolling Borsh decoders.

---

## Approach 5: Hosted webhook services

Some providers offer pump.fun-specific webhook products:

| Provider | What it offers |
|---|---|
| **Helius enhanced webhooks** | Filtered tx feed for pump.fun program; sends parsed events to your HTTP endpoint |
| **Shyft webhooks** | Similar; supports pump.fun out of the box |
| **Custom backends** | Build your own webhook receiver on top of Geyser; many ops do this |

**Pros:**
- No infrastructure on your side beyond an HTTP endpoint.
- Provider handles event parsing.
- Reliable delivery (retries, dedup).

**Cons:**
- Latency higher than direct gRPC (typical 500ms–2s).
- Tied to a single provider; switching providers requires rewriting webhook receivers.
- Cost scales with event volume.

**When to use:** ops where you have a backend service already, latency is "fast enough" rather than "fastest possible," and you don't want to operate stream infrastructure.

---

## Approach 6: SQL indexers

Some indexers ingest pump.fun activity and expose it via SQL. You query historical state via standard SQL, get back rich joined data (creator → coin → trades).

| Indexer | Notes |
|---|---|
| **Helius DAS API** | NFT/token-focused but covers pump.fun via account state queries |
| **Solscan API** | Has a paid tier with structured tx history |
| **Dune Analytics** | Public, free for read; Solana coverage including pump.fun |
| **Top Ledger** | Dune-style queries, Solana-focused |

**Pros:**
- Best for historical analysis (e.g. "what was the volume of every coin launched by this creator over the last 30 days").
- Familiar query language.
- No infrastructure to operate.

**Cons:**
- Indexer lag of 5–60 seconds (sometimes minutes).
- Not suitable for triggering real-time ops.
- Schema can change with little notice.

**When to use:** analytics, backtesting, picking targets for future ops.

---

## Designing a monitoring stack

For most pump.fun ops, the right stack is layered:

1. **For ops that act on activity (collects, rescues):** RPC polling with `watch-collect.js`-style scripts. Simple, robust, scales to ~10 coins per script instance.
2. **For real-time alerts (sweeper-bot detection):** WebSocket subscription on each wallet. Reconnect-on-disconnect logic is critical.
3. **For analytics (which coins to launch, when to launch them):** SQL indexer queries, run periodically.
4. **For real-time intelligence (competing launches):** event parsing via `logsSubscribe` or hosted webhook.

Don't pay for a Geyser stream until you've outgrown polling. Don't pay for webhooks until you've outgrown WebSocket. Most ops never need either.

---

## Logging discipline

Independent of monitoring approach: **log every operation's outcome** with enough detail to debug later. The toolkit's scripts log:

- Bundle ID and tx sigs at submission.
- Confirmation outcome (landed / dropped / timed out).
- SOL amounts in/out for each wallet.
- Resulting balances.

For long-running watchers, write these to a file (the bundled `grind.log` pattern), not just stdout. When you debug "why didn't the collect fire at 3am," you need the history.

A reasonable log format:

```
[ISO timestamp] [script-name] [bundle-id-or-sig] [event] [params...]
```

Easy to grep, easy to ingest into Loki/Datadog/etc. if you later want centralized logging.

---

## Alerting

If you want to be paged on events, the simplest pattern is a thin shell wrapper:

```bash
# Run watch-collect.js and pipe failures to a webhook
node src/watch-collect.js 2>&1 | grep -E "(error|failed|dropped)" | \
  while read line; do
    curl -X POST https://your-alerting-webhook \
      -d "{\"text\": \"watch-collect: $line\"}"
  done
```

Or, for production, wrap the script in a process supervisor (`systemd`, `pm2`, Railway) that auto-restarts on crash and sends notifications on restart.

The toolkit doesn't include alerting code — it's too dependent on your specific notification setup (Slack vs Discord vs PagerDuty vs Telegram).

---

## Related

- [`docs/v2-usdc-rollout/02-event-layouts.md`](v2-usdc-rollout/02-event-layouts.md) — pump.fun V2 event byte layouts
- [`docs/scripts/watch-collect.md`](scripts/watch-collect.md) — the toolkit's polling watcher
- [`docs/pump-fun-protocol.md`](pump-fun-protocol.md) — programs, PDAs, event types
- [`docs/runbooks/rpc-degraded.md`](runbooks/rpc-degraded.md) — when your monitoring source is failing
