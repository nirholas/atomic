# atomic examples

Atomic pump.fun launch + fee collection + buy/transfer scripts using Jito bundles

## Example 1

```text
█████╗ ████████╗ ██████╗ ███╗   ███╗██╗ ██████╗
  ██╔══██╗╚══██╔══╝██╔═══██╗████╗ ████║██║██╔════╝
  ███████║   ██║   ██║   ██║██╔████╔██║██║██║
  ██╔══██║   ██║   ██║   ██║██║╚██╔╝██║██║██║
  ██║  ██║   ██║   ╚██████╔╝██║ ╚═╝ ██║██║╚██████╗
  ╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝
       all-or-nothing pump.fun launching & fee collection
```

## Example 2

```text
.
├── src/                       Runnable scripts (CommonJS, run via `node src/<name>.js`)
│   ├── fire-jito.js, collect-jito.js, …
│   └── lib/                   Shared TS helpers
│       ├── funding-source.ts  detectSeededByPump implementation
│       ├── programs.ts        Pump.fun program IDs + fee recipients
│       └── funding-source.test.ts
├── tools/                     Read-only CLI tools (run via tsx)
│   ├── check-pump-funding.ts  CLI wrapper around detectSeededByPump
│   ├── sanity-check.ts        Pre-flight env / keypair / balance check
│   ├── check-balances.ts      SOL + SPL / Token-2022 balances for a wallet
│   ├── check-bundle-status.ts Query a Jito bundle by UUID
│   ├── check-tip-accounts.ts  Diff live Jito tip accounts against the hardcoded list
│   └── analyze-holders.ts     Holder distribution, concentration, Gini
├── .env.example               Copy to `.env` and fill in
├── package.json               npm scripts cover every runnable file
└── tsconfig.json              Type-checks src/lib/ + tools/
```

## Example 3

```bash
npm install
cp .env.example .env
# fill in .env with your keys and target addresses
```

## Example 4

```bash
npx tsx tools/check-balances.ts <wallet> [rpcUrl]        # SOL + SPL / Token-2022 balances
npx tsx tools/check-bundle-status.ts <bundleUuid>        # why a Jito bundle did or did not land
npx tsx tools/check-tip-accounts.ts                      # drift between live and hardcoded tip accounts
npx tsx tools/analyze-holders.ts <mint> [rpcUrl]         # holder count, top-N concentration, Gini
```

## Example 5

```bash
# 1. Upload metadata (gets a URI)
NAME="MyCoin" SYMBOL="MEME" IMAGE_PATH=./logo.png \
  npm run metadata
# -> https://ipfs.io/ipfs/<CID>

# 2. Launch via Jito bundle (creator = fee payer of create tx)
URI="https://ipfs.io/ipfs/<CID>" \
NAME=MyCoin SYMBOL=MEME \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
JITO_TIP=0.005 \
  npm run launch
```

## Example 6

```bash
# Manual one-shot
DESTINATION=<your-safe-wallet> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
  npm run collect

# Long-running watcher (polls every 30s)
DESTINATION=<your-safe-wallet> \
FUNDER_SECRET=<base58> \
CREATOR_SECRET=<base58> \
CREATOR_PUBKEY=<base58-pubkey> \
MIN_COLLECT_SOL=0.05 \
  npm run watch
```

## Example 7

```bash
npm test               # one-shot
npm run test:watch     # watch mode
npm run typecheck      # tsc --noEmit
```


Every snippet above is taken from the [repository documentation](https://github.com/nirholas/atomic#readme).
