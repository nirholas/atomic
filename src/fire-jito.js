// Jito bundle launch: two atomic txs where the create tx's FEE PAYER is the
// designated creator wallet (independent of the funder).
//
// Tx 1 (funder pays its own fee): transfer rent SOL to creator + Jito tip
// Tx 2 (creator pays its own fee): pump.fun createV2 — Solscan "from" = creator
//
// Bundle submitted to Jito's public Block Engine — atomic, no MEV insertion possible
// between the two txs.
//
// Builds Solana transaction v1 by default (4096-byte limit, inline resource
// config). TRANSACTION_VERSION=0 falls back to version 0 transactions.
//
// Env:
//   URI                    — metadata URI (from metadata.js)
//   NAME, SYMBOL           — token name/symbol
//   FUNDER_SECRET          — base58 secret of wallet paying for Tx1 fee + tip + rent transfer
//   CREATOR_SECRET         — base58 secret of wallet that becomes on-chain creator (pays Tx2 fee)
//   MINT_SECRET            — optional base58 secret of the mint keypair (default: random)
//   RENT_SOL               — SOL to transfer to creator for tx2 rent + fees (default 0.035)
//   JITO_TIP               — Jito tip in SOL (default 0.005, bump if not landing)
//   PRIORITY_FEE_LAMPORTS  — total priority fee in lamports (overrides PRIORITY)
//   PRIORITY               — per-CU price in microlamports (default 2000000),
//                            converted to a total at each tx's CU limit
//   CU_LIMIT               — compute unit limit for the create tx (default 300000)
//   LOADED_ACCOUNTS_DATA_LIMIT — optional byte budget for loaded accounts
//                            (default: measured from chain plus headroom)
//   TRANSACTION_VERSION    — 1 (default) or 0

const bs58mod = require('bs58');
const bs58decode = bs58mod.default ? bs58mod.default.decode : bs58mod.decode;
const { Connection, Keypair, SystemProgram } = require('@solana/web3.js');
const { PUMP_SDK } = require('@nirholas/pump-sdk');
const {
  buildSignedTransaction, estimateLoadedAccountsDataSizeLimit, parseComputeUnitLimit,
  resolvePriorityFeeLamports, resolveTransactionVersion,
} = require('./lib/transaction');
const { randomTipAccount, sendBundle, waitForSignatures } = require('./lib/jito');

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

if (!process.env.URI) { console.error('Missing URI'); process.exit(1); }
const URI       = process.env.URI;
const NAME      = process.env.NAME   || 'MyCoin';
const SYMBOL    = process.env.SYMBOL || 'MEME';
const RENT_SOL  = parseFloat(process.env.RENT_SOL || '0.035');
const JITO_TIP  = parseFloat(process.env.JITO_TIP || '0.005');
const CU_LIMIT  = parseComputeUnitLimit(process.env.CU_LIMIT, 300000);
// Tx1 is two system transfers; it needs a fraction of the create tx's budget.
const TRANSFER_CU_LIMIT = 1000;
const VERSION   = resolveTransactionVersion();

const funder  = Keypair.fromSecretKey(bs58decode(process.env.FUNDER_SECRET));
const creator = Keypair.fromSecretKey(bs58decode(process.env.CREATOR_SECRET));
const mint    = process.env.MINT_SECRET
  ? Keypair.fromSecretKey(bs58decode(process.env.MINT_SECRET))
  : Keypair.generate();

(async () => {
  const c = new Connection(RPC_URL, 'confirmed');

  console.log('Funder (pays Tx1 + tip):', funder.publicKey.toBase58());
  console.log('Creator (pays Tx2):     ', creator.publicKey.toBase58());
  console.log('Mint:                    ', mint.publicKey.toBase58());
  console.log('Jito tip:', JITO_TIP, 'SOL  |  Rent funding:', RENT_SOL, 'SOL  |  Tx version:', VERSION);

  const transferFee = resolvePriorityFeeLamports({ computeUnitLimit: TRANSFER_CU_LIMIT, defaultMicroLamports: 2000000 });
  const createFee   = resolvePriorityFeeLamports({ computeUnitLimit: CU_LIMIT, defaultMicroLamports: 2000000 });

  const funderBal = await c.getBalance(funder.publicKey, 'confirmed');
  console.log('Funder balance:', funderBal / 1e9, 'SOL');
  const needed = RENT_SOL + JITO_TIP + 0.002 + Number(transferFee) / 1e9;
  if (funderBal < needed * 1e9) {
    console.error(`Funder needs >= ${needed} SOL.`);
    process.exit(1);
  }

  const tipAccount = randomTipAccount();
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed');

  // --- TX 1: funder transfers rent SOL + Jito tip ---
  const transferIxs = [
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: creator.publicKey, lamports: Math.floor(RENT_SOL * 1e9) }),
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: tipAccount, lamports: Math.floor(JITO_TIP * 1e9) }),
  ];
  const tx1 = buildSignedTransaction({
    version: VERSION,
    payer: funder.publicKey,
    instructions: transferIxs,
    blockhash,
    lastValidBlockHeight,
    computeUnitLimit: TRANSFER_CU_LIMIT,
    loadedAccountsDataSizeLimit: await estimateLoadedAccountsDataSizeLimit(c, funder.publicKey, transferIxs),
    priorityFeeLamports: transferFee,
  }, [funder]);

  // --- TX 2: creator runs createV2, pays its own fee ---
  const createIx = await PUMP_SDK.createV2Instruction({
    mint:    mint.publicKey,
    name:    NAME,
    symbol:  SYMBOL,
    uri:     URI,
    creator: creator.publicKey,
    user:    creator.publicKey,
    mayhemMode: false,
    cashback:   false,
  });
  const tx2 = buildSignedTransaction({
    version: VERSION,
    payer: creator.publicKey,
    instructions: [createIx],
    blockhash,
    lastValidBlockHeight,
    computeUnitLimit: CU_LIMIT,
    loadedAccountsDataSizeLimit: await estimateLoadedAccountsDataSizeLimit(c, creator.publicKey, [createIx]),
    priorityFeeLamports: createFee,
  }, [creator, mint]);

  console.log(`Tx1: ${tx1.size}/${tx1.limit} bytes | Tx2: ${tx2.size}/${tx2.limit} bytes`);

  console.log('\nSubmitting bundle to Jito Block Engine...');
  const bundleId = await sendBundle([tx1, tx2]);
  console.log('Bundle ID:', bundleId);
  console.log('Tx1 sig:', tx1.signature, '\nTx2 sig:', tx2.signature);

  const statuses = await waitForSignatures(c, [tx1.signature, tx2.signature], { label: ['tx1', 'tx2'] });
  if (!statuses) {
    console.error(`Bundle not confirmed in 60s. Check: https://explorer.jito.wtf/bundle/${bundleId}`);
    process.exit(1);
  }
  const failed = statuses.find(status => status.err);
  if (failed) { console.error('Tx errored:', JSON.stringify(failed.err)); process.exit(1); }

  console.log('LAUNCHED.');
  console.log('Mint:    ', mint.publicKey.toBase58());
  console.log('Pump URL:', `https://pump.fun/coin/${mint.publicKey.toBase58()}`);
  console.log('Create tx:', `https://solscan.io/tx/${tx2.signature}`);
})().catch(e => { console.error(e); process.exit(1); });
