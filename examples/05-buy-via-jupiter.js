/**
 * 05-buy-via-jupiter.js — buy a Solana token via Jupiter inside a Jito bundle
 *
 * Demonstrates routing a buy through Jupiter (the DEX aggregator) instead of
 * calling pump-sdk's buy ix directly. Useful when pump-sdk drifts out of sync
 * with the live program — Jupiter handles the routing details.
 *
 * The bundle wraps the swap tx with a Jito tip so it lands atomically and isn't
 * sandwich-attackable.
 *
 * Required .env:
 *   RPC_URL, FUNDER_SECRET, TARGET_MINT, BUY_SOL, SLIPPAGE_BPS, JITO_TIP
 *
 * Run: node examples/05-buy-via-jupiter.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import {
  Connection, Keypair, PublicKey, SystemProgram, VersionedTransaction,
  TransactionMessage, AddressLookupTableAccount, LAMPORTS_PER_SOL,
} from '@solana/web3.js';

const JUP_QUOTE = 'https://quote-api.jup.ag/v6/quote';
const JUP_SWAP = 'https://quote-api.jup.ag/v6/swap';
const NATIVE_SOL = 'So11111111111111111111111111111111111111112';
const TIP_ACCOUNT = new PublicKey('T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt');

async function submitBundle(txs) {
  const encoded = txs.map((tx) => Buffer.from(tx.serialize()).toString('base64'));
  const res = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [encoded] }),
  });
  return (await res.json()).result;
}

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const wallet = Keypair.fromSecretKey(bs58.decode(process.env.FUNDER_SECRET));
const buyLamports = Math.floor(parseFloat(process.env.BUY_SOL) * LAMPORTS_PER_SOL);
const tipLamports = Math.floor(parseFloat(process.env.JITO_TIP) * LAMPORTS_PER_SOL);

// 1. Get a quote from Jupiter
const quoteUrl = `${JUP_QUOTE}?inputMint=${NATIVE_SOL}&outputMint=${process.env.TARGET_MINT}&amount=${buyLamports}&slippageBps=${process.env.SLIPPAGE_BPS}`;
const quote = await fetch(quoteUrl).then((r) => r.json());
console.log('Quote: spending', buyLamports, 'lamports for', quote.outAmount, 'tokens (min:', quote.otherAmountThreshold, ')');

// 2. Get the swap transaction from Jupiter
const swap = await fetch(JUP_SWAP, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    quoteResponse: quote, userPublicKey: wallet.publicKey.toBase58(),
    wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
  }),
}).then((r) => r.json());

const swapTx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));

// 3. Build a separate tip tx in the same bundle
const { blockhash } = await conn.getLatestBlockhash('confirmed');
const tipMsg = new TransactionMessage({
  payerKey: wallet.publicKey, recentBlockhash: blockhash,
  instructions: [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: TIP_ACCOUNT, lamports: tipLamports })],
}).compileToV0Message();
const tipTx = new VersionedTransaction(tipMsg);
tipTx.sign([wallet]);

swapTx.sign([wallet]);

const bundleId = await submitBundle([tipTx, swapTx]);
console.log('Bundle submitted:', bundleId);
