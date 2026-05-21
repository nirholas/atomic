---
name: atomic-audit
description: Use when the user wants to determine whether a Solana wallet was seeded (funded) by pump.fun — a provenance / forensics check. Triggers on "did pump.fun seed this wallet", "check-pump-funding", "detectSeededByPump", "wallet provenance", "funding source check", or any audit of pump.fun funding lineage.
---

# atomic-audit — wallet provenance check

Determines whether a Solana wallet was seeded by pump.fun (i.e. its first incoming SOL transfer originated from a pump.fun-controlled address). Useful for forensics, anti-Sybil checks, or filtering holders by funding lineage.

## Script

`tools/check-pump-funding.ts` (standalone TypeScript, run with `tsx`)

The detection logic lives in `packages/core/src/solana/funding-source.ts` (`detectSeededByPump`). Import it directly if you're building on top.

## Setup

The tool runs from the repo root, not the `tmp/leaked-launch/` dir:

```bash
# At repo root
npm install
```

(If there's no root `package.json` yet, install `tsx` and `@solana/web3.js` globally or use `npx`.)

## Flow

```bash
npx tsx tools/check-pump-funding.ts <walletAddress> [rpcUrl]
```

Or via env:

```bash
RPC_URL=https://your-rpc.example/ \
  npx tsx tools/check-pump-funding.ts <walletAddress>
```

Output is color-coded:

- **GREEN** — wallet was seeded by pump.fun
- **RED** — wallet was not seeded by pump.fun (or first funding source is unknown)

The default RPC is `https://api.mainnet-beta.solana.com` if neither the positional arg nor `RPC_URL` is set; this rate-limits fast, so prefer a paid RPC for any batch use.

## Programmatic use

```ts
import { Connection } from '@solana/web3.js';
import { detectSeededByPump } from './packages/core/src/solana/funding-source.js';

const conn = new Connection(process.env.RPC_URL!);
const result = await detectSeededByPump(conn, walletPubkey);
// result tells you whether and how pump.fun seeded the wallet
```

Check the type signature in `packages/core/src/solana/funding-source.ts` — the returned shape includes the originating tx and source address when positive.

## When to use

- **Anti-Sybil filtering on rewards drops.** Combine with [[atomic-distribute]] to exclude pump.fun-seeded wallets from a payout, since they're often the same actor's fresh wallets.
- **Forensics.** Tracing whether a suspicious wallet's first funds came through pump.fun's launch flow.
- **Coin provenance.** Check the creator wallet itself — sometimes pump.fun seeds new creator wallets on launch.

## Gotchas

- **RPC rate limits.** The tool walks transaction history to find the first incoming transfer. Public mainnet RPC will throttle after a few wallets; use Helius/Triton for batch use.
- **Pruned history.** Wallets with very old funding may have signatures pruned from default RPCs. Use an archive RPC (Helius mainnet-beta with `getSignaturesForAddress` archive support) if you need history beyond ~2 years.
- **Indirect funding.** A wallet seeded *via* a hop wallet that was itself seeded by pump.fun returns RED — this is a direct-funding check only, not transitive. Multi-hop tracing is a future enhancement.
- **False negatives on closed accounts.** If the original funder account has been closed and its signatures pruned, the tool reports RED even if pump.fun did seed it. Treat RED as "not confirmed", not "definitely not pump".

## Security

This is a read-only tool — no keys, no signing, no risk. Safe to run against any public address.
