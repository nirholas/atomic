// Atomic create-only launch in a SINGLE tx (no Jito bundle needed).
// Funder transfers rent SOL to creator, creator runs pump.fun createV2, all atomic.
// No bot race window. No dev buy (avoids any buy-ix changes in the pump program).
//
// Builds a Solana transaction v1 by default (4096-byte limit, inline compute
// budget). TRANSACTION_VERSION=0 falls back to a version 0 transaction.
//
// Use this when:
//   - You don't want to pay a Jito tip
//   - You don't need the create tx's "from" to equal creator (it will be funder)
//
// Env:
//   URI                    — metadata URI (from metadata.js)
//   NAME, SYMBOL           — token name/symbol
//   FUNDER_SECRET          — base58 secret of fee payer + rent source
//   CREATOR_SECRET         — base58 secret of on-chain creator
//   MINT_SECRET            — optional; base58 secret of mint keypair (default: random)
//   RENT_SOL               — SOL to fund creator with for internal rent (default 0.035)
//   PRIORITY_FEE_LAMPORTS  — total priority fee in lamports (overrides PRIORITY)
//   PRIORITY               — per-CU price in microlamports (default 3000000),
//                            converted to a total at CU_LIMIT
//   CU_LIMIT               — compute unit limit (default 300000)
//   LOADED_ACCOUNTS_DATA_LIMIT — optional byte budget for loaded accounts
//                            (default: measured from chain plus headroom)
//   TRANSACTION_VERSION    — 1 (default) or 0

const bs58mod = require('bs58');
const bs58decode = bs58mod.default ? bs58mod.default.decode : bs58mod.decode;
const { Connection, Keypair, SystemProgram } = require('@solana/web3.js');
const { PUMP_SDK } = require('@nirholas/pump-sdk');
const {
  buildSignedTransaction, estimateLoadedAccountsDataSizeLimit, parseComputeUnitLimit,
  resolvePriorityFeeLamports, resolveTransactionVersion, sendSignedTransaction, simulateSignedTransaction,
} = require('./lib/transaction');

const RPC_URL  = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
if (!process.env.URI) { console.error('Missing URI'); process.exit(1); }
const URI      = process.env.URI;
const NAME     = process.env.NAME   || 'MyCoin';
const SYMBOL   = process.env.SYMBOL || 'MEME';
const RENT_SOL = parseFloat(process.env.RENT_SOL || '0.035');
const CU_LIMIT = parseComputeUnitLimit(process.env.CU_LIMIT, 300000);
const PRIORITY_FEE_LAMPORTS = resolvePriorityFeeLamports({ computeUnitLimit: CU_LIMIT, defaultMicroLamports: 3000000 });
const VERSION  = resolveTransactionVersion();

const funder  = Keypair.fromSecretKey(bs58decode(process.env.FUNDER_SECRET));
const creator = Keypair.fromSecretKey(bs58decode(process.env.CREATOR_SECRET));
const mint    = process.env.MINT_SECRET
  ? Keypair.fromSecretKey(bs58decode(process.env.MINT_SECRET))
  : Keypair.generate();

(async () => {
  const c = new Connection(RPC_URL, 'confirmed');

  console.log('Funder (fee payer):', funder.publicKey.toBase58());
  console.log('Creator:           ', creator.publicKey.toBase58());
  console.log('Mint:              ', mint.publicKey.toBase58());
  console.log('Tx version:', VERSION, '| CU limit:', CU_LIMIT, '| Priority fee:', PRIORITY_FEE_LAMPORTS.toString(), 'lamports');

  const funderBal = await c.getBalance(funder.publicKey, 'confirmed');
  console.log('Funder balance:', funderBal / 1e9, 'SOL');
  const needed = RENT_SOL + 0.005 + Number(PRIORITY_FEE_LAMPORTS) / 1e9;
  if (funderBal < needed * 1e9) {
    console.error('Funder needs >=', needed, 'SOL');
    process.exit(1);
  }

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
  const instructions = [
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey:   creator.publicKey,
      lamports:   Math.floor(RENT_SOL * 1e9),
    }),
    createIx,
  ];

  const loadedAccountsDataSizeLimit = await estimateLoadedAccountsDataSizeLimit(c, funder.publicKey, instructions);
  const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed');
  const tx = buildSignedTransaction({
    version: VERSION,
    payer: funder.publicKey,
    instructions,
    blockhash,
    lastValidBlockHeight,
    computeUnitLimit: CU_LIMIT,
    loadedAccountsDataSizeLimit,
    priorityFeeLamports: PRIORITY_FEE_LAMPORTS,
  }, [funder, creator, mint]);

  console.log(`Tx size: ${tx.size} bytes (v${tx.version} limit ${tx.limit}) | loaded-accounts budget: ${loadedAccountsDataSizeLimit} bytes`);

  const sim = await simulateSignedTransaction(c, tx);
  if (sim.err) {
    console.error('Sim failed:', JSON.stringify(sim.err));
    console.error('Logs:\n' + (sim.logs || []).join('\n'));
    process.exit(1);
  }
  console.log('Sim OK. CU consumed:', sim.unitsConsumed, '| loaded account data:', sim.loadedAccountsDataSize, 'bytes');

  console.log('Sending...');
  const sig = await sendSignedTransaction(c, tx);
  const conf = await c.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (conf.value.err) { console.error('Tx errored:', JSON.stringify(conf.value.err)); process.exit(1); }
  console.log('LAUNCHED.');
  console.log('Mint:    ', mint.publicKey.toBase58());
  console.log('Pump URL:', `https://pump.fun/coin/${mint.publicKey.toBase58()}`);
  console.log('Solscan: ', `https://solscan.io/tx/${sig}`);
})().catch(e => { console.error(e); process.exit(1); });
