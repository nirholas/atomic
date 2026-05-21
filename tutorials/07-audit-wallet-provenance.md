# 07 — Audit wallet provenance (pump.fun seeding)

You have a Solana wallet address and you want to know: **was this wallet first funded by pump.fun?** Answering this lets you:

- Filter pump.fun-seeded fresh wallets out of a rewards distribution (anti-Sybil).
- Trace whether a suspicious wallet's first funds came through pump.fun's launch flow.
- Audit creator-wallet provenance — sometimes pump.fun seeds the creator wallet itself on launch.

The check is **read-only** — no keys, no signing, no risk. Safe to run against any public address.

## The detection logic

`detectSeededByPump` (in `packages/core/src/solana/funding-source.ts`) walks the wallet's incoming transfer history and identifies the first inbound SOL transfer. If the originating address is a known pump.fun-controlled address, the wallet is flagged as **seeded by pump.fun**.

This is a **direct-funding check only** — not transitive. A wallet seeded *via* a hop wallet that was itself seeded by pump.fun returns RED. Multi-hop tracing is a future enhancement.

## Prerequisites

- Node + `tsx` installed (`npm i -g tsx` if missing).
- An RPC endpoint. **Use Helius/Triton or another archive RPC** for any batch use — public mainnet rate-limits within a handful of wallets.

This tool runs from the **repo root**, like every other tutorial in this set.

## Step 1 — Basic check

```bash
# From repo root
npm run check-funding -- <walletAddress>
```

Output is color-coded:

- **GREEN** — wallet was seeded by pump.fun. Includes the originating tx signature and source address.
- **RED** — wallet was not seeded by pump.fun, *or* the first funding source is unknown (e.g. signatures pruned, account closed).

Treat RED as **"not confirmed pump.fun seeded"**, not **"definitely not pump"**. False negatives are possible — see Gotchas below.

## Step 2 — With explicit RPC

```bash
npm run check-funding -- <walletAddress> https://your-rpc.example/
```

Or via env:

```bash
RPC_URL=https://your-rpc.example/ \
  npm run check-funding -- <walletAddress>
```

If neither the positional arg nor `RPC_URL` is set, the tool falls back to `https://api.mainnet-beta.solana.com`, which rate-limits fast.

## Step 3 — Programmatic use

For batch auditing inside your own scripts, import `detectSeededByPump` directly:

```ts
import { Connection, PublicKey } from '@solana/web3.js';
import { detectSeededByPump } from './packages/core/src/solana/funding-source.js';

const conn = new Connection(process.env.RPC_URL!);
const wallet = new PublicKey('<base58>');

const result = await detectSeededByPump(conn, wallet);
if (result.seeded) {
  console.log(`Seeded by ${result.source} in tx ${result.signature}`);
} else {
  console.log('Not seeded by pump.fun (or unknown)');
}
```

The returned shape includes the originating tx signature and source address when positive. Check the type signature in `packages/core/src/solana/funding-source.ts` for the exact fields.

## Use cases

### Anti-Sybil filter on a rewards drop

Combine with [tutorial 05 — Distribute USDC rewards](./05-distribute-usdc-rewards.md):

1. Enumerate holders for your mint.
2. For each holder, run `detectSeededByPump`.
3. Drop holders that are GREEN (pump.fun-seeded fresh wallets — typically Sybil farms).
4. Pass the curated holder list into a custom variant of `distribute.js`.

This won't catch everything (multi-hop seeding, washed wallets), but cuts the most obvious Sybil patterns.

### Forensics

Investigating a suspicious wallet that received your rescued tokens or your USDC payout? Run the check on it. If it's GREEN, you're likely looking at a freshly-spun pump.fun-adjacent wallet, not a long-standing actor.

### Coin provenance

Check the **creator wallet** of a coin you don't trust. Sometimes pump.fun seeds new creator wallets on launch, which is a tell that the creator is using a single-purpose wallet (no long-standing history). Doesn't mean malicious, but it's a signal.

## Gotchas

- **RPC rate limits.** The tool walks transaction history to find the first incoming transfer. Public mainnet RPC throttles after a few wallets. Use Helius/Triton or any archive-supporting RPC for batch use.
- **Pruned history.** Wallets with very old funding may have signatures pruned from default RPCs. Use an archive RPC if you need history beyond ~2 years.
- **Indirect funding.** A wallet seeded *via* a hop wallet that was itself seeded by pump.fun returns RED. Multi-hop tracing would let you follow the chain, but it's not implemented. Treat RED with mild skepticism if you're auditing actively obscured wallets.
- **False negatives on closed accounts.** If the original funder account has been closed and its signatures pruned, the tool reports RED even if pump.fun did seed the wallet. Treat RED as "not confirmed", not "definitely not pump".
- **Read-only.** This tool never signs anything, never moves SOL, never needs a secret. If a variant of this script ever asks for a `*_SECRET` env var, something is wrong — bail and inspect.

## Security

Fully safe. No keys, no signing, no on-chain writes. The only thing you spend is RPC quota.

## Next steps

- **Want to pre-filter a rewards drop**? Pipe the holder list through this tool, drop GREEN holders, then run [tutorial 05](./05-distribute-usdc-rewards.md) with a custom holder set.
- **Building a holder-quality dashboard**? Loop `detectSeededByPump` across all holders and tag each. The result includes the originating tx, which you can render as a Solscan link in a UI.
