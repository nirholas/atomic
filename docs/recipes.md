# Recipes

End-to-end flows. Each recipe stitches together two or more scripts to solve a real task. Per-script details live in [`docs/scripts/`](scripts/); this page assumes you've read [Setup](setup.md).

- [Recipe 1 — Launch a coin and auto-collect fees](#recipe-1--launch-a-coin-and-auto-collect-fees)
- [Recipe 2 — Rescue tokens from a leaked wallet](#recipe-2--rescue-tokens-from-a-leaked-wallet)
- [Recipe 3 — Buy a token from a fresh wallet via Jupiter](#recipe-3--buy-a-token-from-a-fresh-wallet-via-jupiter)
- [Recipe 4 — End-of-life: consolidate everything to one wallet](#recipe-4--end-of-life-consolidate-everything-to-one-wallet)
- [Recipe 5 — Distribute USDC rewards to holders](#recipe-5--distribute-usdc-rewards-to-holders)
- [Recipe 6 — Forensics: was this wallet seeded by pump.fun?](#recipe-6--forensics-was-this-wallet-seeded-by-pumpfun)
- [Recipe 7 — Launch with a vanity mint address](#recipe-7--launch-with-a-vanity-mint-address)

---

## Recipe 1 — Launch a coin and auto-collect fees

**Goal:** launch a new pump.fun coin where the creator wallet has a shared/leaked key, and continuously collect creator fees to a safe destination.

Uses: [`metadata`](scripts/metadata.md) → [`fire-jito`](scripts/fire-jito.md) → [`watch-collect`](scripts/watch-collect.md).

```bash
# 0. Make sure .env has FUNDER_SECRET, CREATOR_SECRET, DESTINATION (safe wallet pubkey)
set -a; source .env; set +a

# 1. Upload metadata
URI=$(NAME="MyCoin" SYMBOL="MEME" IMAGE_PATH=./logo.png \
      npm run metadata --silent | tail -1)
echo "URI: $URI"

# 2. Launch via Jito (creator = on-chain "from")
URI=$URI \
NAME=MyCoin SYMBOL=MEME \
JITO_TIP=0.005 \
npm run launch
# -> records the mint address; coin lives at https://pump.fun/coin/<mint>

# 3. Start the auto-collector. Runs forever; Ctrl-C to stop.
CREATOR_PUBKEY=$(node -e "console.log(require('bs58').decode(process.env.CREATOR_SECRET).slice(32).toString('hex'))" )
# Actually easier — derive CREATOR_PUBKEY from CREATOR_SECRET:
CREATOR_PUBKEY=$(node -e "
  const bs58 = require('bs58');
  const { Keypair } = require('@solana/web3.js');
  const kp = Keypair.fromSecretKey(bs58.decode(process.env.CREATOR_SECRET));
  console.log(kp.publicKey.toBase58());
")

CREATOR_PUBKEY=$CREATOR_PUBKEY \
MIN_COLLECT_SOL=0.05 \
POLL_MS=30000 \
npm run watch
```

**For production**, run `watch-collect` under systemd / pm2 / Docker so it auto-restarts. See [watch-collect → Run it under a supervisor](scripts/watch-collect.md#run-it-under-a-supervisor).

---

## Recipe 2 — Rescue tokens from a leaked wallet

**Goal:** a wallet's private key is in too many hands, and tokens it holds need to move *before* a sweeper bot drains them.

Uses: [`rescue-tokens`](scripts/rescue-tokens.md).

```bash
# Pre-flight: figure out the mint's decimals + token program if you don't know
# (pump.fun coins: DECIMALS=6, TOKEN_PROGRAM=t22)
# For other tokens, check Solscan's "Token" tab → "Token Program" field.

MINT=<token mint base58> \
FROM_SECRET=<leaked wallet base58> \
DEST_OWNER=<your safe wallet pubkey> \
DECIMALS=6 \
TOKEN_PROGRAM=t22 \
FUNDER_SECRET=<your funder base58> \
JITO_TIP=0.01 \
npm run transfer-tokens
```

The funder pays the tx fee + Jito tip + the destination ATA rent (~0.002 SOL if the ATA didn't exist). The leaked wallet only signs the token transfer ix.

If you have *multiple* mints to rescue from the same leaked wallet, run the command once per mint. They're independent.

If the tokens are SPL (not Token-2022), set `TOKEN_PROGRAM=spl`.

To rescue a *specific* amount instead of the full balance:

```bash
AMOUNT_RAW=500000000  # raw amount; for DECIMALS=6, this is 500 tokens
```

---

## Recipe 3 — Buy a token from a fresh wallet via Jupiter

**Goal:** acquire a token, with the funder paying everything and the buyer wallet being a fresh, private key with no SOL of its own. Useful when pump-sdk's direct buy ix is failing due to program drift.

Uses: [`buy-jito`](scripts/buy-jito.md).

```bash
# Generate a fresh buyer
solana-keygen new --no-bip39-passphrase --outfile buyer.json
BUYER_SECRET=$(node -e "
  console.log(require('bs58').encode(Buffer.from(JSON.parse(require('fs').readFileSync('buyer.json','utf8')))));
")

TARGET_MINT=<token mint base58> \
BUY_SOL=0.05 \
SLIPPAGE_BPS=500 \
JITO_TIP=0.005 \
FUNDER_SECRET=<funder base58> \
BUYER_SECRET=$BUYER_SECRET \
npm run buy

# Tokens now live in the buyer wallet's ATA.
```

**If the buyer wallet later becomes public** (e.g. shared with someone, posted somewhere): the output tokens are exposed to sweeper bots. Two follow-ups:

1. Move them out immediately with [`rescue-tokens`](scripts/rescue-tokens.md) (Recipe 2).
2. Or extend `buy-jito.js` to add a *third* tx to the bundle that transfers the tokens atomically — that's a code change in [`src/buy-jito.js`](../src/buy-jito.js); the [rescue-tokens script](scripts/rescue-tokens.md) is a good template for the ixs.

---

## Recipe 4 — End-of-life: consolidate everything to one wallet

**Goal:** you're done with a coin. The vault has fees, the funder has leftover operating SOL, the creator wallet has its rent buffer + maybe some dust. You want it all on one safe wallet.

Uses: [`consolidate`](scripts/consolidate.md).

```bash
DESTINATION=<your safe wallet pubkey> \
FUNDER_SECRET=<funder base58> \
CREATOR_SECRET=<creator base58> \
JITO_TIP=0.01 \
npm run consolidate
```

Single atomic Jito tx that:

1. Collects creator vault → creator wallet.
2. Transfers (creator wallet) → destination, leaving only the rent-exempt floor (~0.00089 SOL).
3. Transfers (funder wallet) → destination, leaving a 0.005 SOL operating buffer.

After this, the creator wallet is effectively closed (it still exists, but holds only the rent floor). The funder retains ~0.005 SOL. Everything else is on the destination.

If you want the funder *fully* drained too, after this run a regular `solana transfer` from the funder for its remaining ~0.005 SOL.

---

## Recipe 5 — Distribute USDC rewards to holders

**Goal:** convert some fraction of collected creator fees to USDC and airdrop to current holders, sqrt-weighted. (`REWARD_PERCENT=80` keeps 20% of fees for you.)

Uses: [`distribute`](scripts/distribute.md).

```bash
# Dry run first — see who's eligible and what they'd get, no txs sent
MINT=<token mint base58> \
CREATOR_SECRET=<base58> \
REWARD_PERCENT=80 \
MIN_BPS=10 \
DRY_RUN=1 \
npm run distribute

# Looks good? Drop DRY_RUN=1 and run for real
MINT=<token mint base58> \
CREATOR_SECRET=<base58> \
REWARD_PERCENT=80 \
MIN_BPS=10 \
npm run distribute
```

Things to be aware of (full list in [distribute.md](scripts/distribute.md)):

- **The creator wallet must hold its own private key here**, *and* have enough SOL on it to cover the airdrop tx fees (the script doesn't use the funder pattern).
- **The holder snapshot uses legacy SPL Token, not Token-2022.** If the mint is Token-2022 (pump.fun default), this will miss holders. Patch [`src/distribute.js`](../src/distribute.js) before relying on it for Token-2022 distributions.
- **No idempotency.** If a batch fails partway through, re-running airdrops to everyone *again*. For high-value distributions, capture the per-batch sigs and exclude already-paid holders manually.

If something goes wrong mid-flight, sweep all remaining USDC to a safe wallet:

```bash
MINT=<token mint base58> \
CREATOR_SECRET=<base58> \
EMERGENCY=1 \
EMERGENCY_TO=<your safe wallet pubkey, must already have a USDC ATA> \
npm run distribute
```

---

## Recipe 6 — Forensics: was this wallet seeded by pump.fun?

**Goal:** verify (or refute) the claim that a particular wallet was bootstrapped by pump.fun itself.

Uses: [`tools/check-pump-funding.ts`](scripts/check-pump-funding.md).

```bash
npm run check-funding -- <walletAddress>

# With a paid RPC for speed
RPC_URL=https://rpc.helius.xyz/?api-key=… \
  npm run check-funding -- <walletAddress>
```

Outputs:

- `Verdict: SEEDED BY PUMP.FUN` — first inbound SOL came from a known pump.fun source.
- `Verdict: NOT seeded by pump.fun` — first inbound SOL came from somewhere else; the printed `First funder` shows where.

The verdict is strict: "the protocol put the very first lamports there." A wallet that *uses* pump.fun heavily but was originally funded from Coinbase will say NOT seeded.

For programmatic use, import [`detectSeededByPump`](../src/lib/funding-source.ts) directly — it returns a structured result with sender, slot, signature, lamports.

---

## Recipe 7 — Launch with a vanity mint address

**Goal:** the coin's mint address starts with a chosen prefix (e.g. `pump…` or your project name).

Uses: `solana-keygen grind` (preferred) or [`grind`](scripts/grind.md), then [`fire-jito`](scripts/fire-jito.md).

```bash
# Grind a mint keypair starting with "pump"
solana-keygen grind --starts-with pump:1 --num-threads $(nproc)
# -> creates pump<...>.json in cwd

# Convert that JSON keypair to base58
MINT_SECRET=$(node -e "
  console.log(require('bs58').encode(
    Buffer.from(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')))
  ));
" pump*.json)

# Launch using that mint
URI=https://ipfs.io/ipfs/Qm… \
NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
MINT_SECRET=$MINT_SECRET \
npm run launch
```

**Expected time** for a 4-char prefix on 8 cores: a few minutes. 5 chars: hours. 6+ chars: don't bother without GPU. See [grind → time-to-find expectations](scripts/grind.md#time-to-find-expectations).

After launch the mint keypair is no longer needed — pump.fun owns the mint via PDAs. Delete `pump*.json` if you want a clean tree.
