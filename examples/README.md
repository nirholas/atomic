# Examples

Short, runnable JS snippets demonstrating each of the toolkit's call surfaces. Each example is **under 80 lines**, self-contained except for `.env`, and produces a verifiable on-chain outcome when run against a throwaway mainnet wallet.

> ⚠️ **These send real transactions on Solana mainnet.** Use a wallet with minimal funds. Don't run any example against a wallet with serious value.

## Examples

| File | Demonstrates |
|------|-------------|
| [01-basic-launch.js](./01-basic-launch.js) | Minimal `fire-jito` launch with single-wallet (funder == creator). |
| [02-launch-with-dev-buy.js](./02-launch-with-dev-buy.js) | Launch + atomic dev-buy in one bundle. |
| [03-collect-and-drain.js](./03-collect-and-drain.js) | One-shot atomic creator-fee collect + drain to safe wallet. |
| [04-consolidate-three-wallets.js](./04-consolidate-three-wallets.js) | Drain vault + creator + funder all to a single destination. |
| [05-buy-via-jupiter.js](./05-buy-via-jupiter.js) | Buy a token via Jupiter inside a Jito bundle. |
| [06-rescue-token2022.js](./06-rescue-token2022.js) | Atomically move Token-2022 balance from a leaked-key wallet. |
| [07-distribute-sqrt-weighted.js](./07-distribute-sqrt-weighted.js) | Distribute USDC to holders with sqrt-weighted shares. |
| [08-watch-collect-alerts.js](./08-watch-collect-alerts.js) | Long-running collect watcher with Telegram-webhook alerts on each fire. |

## Running an example

```bash
# From repo root:
cp .env.example .env
# Edit .env with your throwaway-wallet keys and target addresses

# Then:
node examples/01-basic-launch.js
```

Most examples read the same env vars as the production scripts in `src/`. See [`.env.example`](../.env.example) for the full list.

## What each example does NOT do

- **Production error handling.** Examples bail on first error to keep the code small. Production code in `src/` has retry loops, balance assertions, and fallback paths.
- **Long-running supervision.** Examples are single-shot. The `watch-collect` example (08) demonstrates the loop but doesn't include process supervision (PM2, systemd) — see [`docs/operations/running-as-a-service.md`](../docs/operations/running-as-a-service.md) for that.
- **Secret management.** Examples read from `.env`. For production, follow [`docs/security/key-management.md`](../docs/security/key-management.md).

## How examples differ from `src/` scripts

`src/` scripts are production-ready: full error handling, retry logic, balance assertions, atomic-bundle guarantees with extensive pre-flight checks. They're tested against real launches.

Examples are **teaching tools**. They strip away the production scaffolding to show the core API surface. The mapping:

| Example | Production equivalent |
|---------|----------------------|
| `01-basic-launch.js` | `src/fire-atomic-create.js` (single-tx variant) and `src/fire-jito.js` (full atomic). |
| `02-launch-with-dev-buy.js` | `src/fire-jito.js`. |
| `03-collect-and-drain.js` | `src/collect-jito.js`. |
| `04-consolidate-three-wallets.js` | `src/consolidate.js`. |
| `05-buy-via-jupiter.js` | `src/buy-jito.js`. |
| `06-rescue-token2022.js` | `src/rescue-tokens.js`. |
| `07-distribute-sqrt-weighted.js` | `src/distribute.js`. |
| `08-watch-collect-alerts.js` | `src/watch-collect.js` + your own alerting layer. |

For production use, **always use the `src/` scripts**, not the examples. Examples are for learning the API.

## Common patterns across examples

- **Load env**: `import 'dotenv/config';`
- **Build connection**: `new Connection(process.env.RPC_URL!)`
- **Decode keypair**: `Keypair.fromSecretKey(bs58.decode(process.env.FUNDER_SECRET!))`
- **Build instruction**: `await PUMP_SDK.<methodName>({ ... })`
- **Submit via Jito**: helper in `src/lib/jito.ts` (or a stripped version inline in the example)
- **Log result**: print bundle ID or tx signature, surface Solscan link

## Contributing examples

If you write a new example:

- **Keep it under 80 lines.** If it doesn't fit, it's not a teaching example — make it a tutorial under [`tutorials/`](../tutorials/) instead.
- **Use throwaway wallets.** Don't hardcode any real pubkey except for known on-chain constants (program IDs, USDC mint, etc.).
- **Add to this index**, with one-line description and link to the production equivalent.
- **Test it on mainnet** with a throwaway wallet before submitting. Include the tx signature in the PR.
