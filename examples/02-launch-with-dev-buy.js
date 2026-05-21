/**
 * 02-launch-with-dev-buy.js — launch + atomic dev-buy in one Jito bundle
 *
 * Two-tx bundle:
 *   Tx1: funder transfers rent + tip to a Jito tip account.
 *   Tx2: creator runs createV2 and immediately buys `DEV_BUY_SOL` worth.
 *
 * The atomicity guarantees that:
 *   - Snipers can't insert a buy between the create and the dev-buy.
 *   - The funder's rent SOL never sits on the creator wallet long enough to be
 *     sweeper-bait.
 *
 * Required .env:
 *   RPC_URL, FUNDER_SECRET, CREATOR_SECRET, NAME, SYMBOL, URI, DEV_BUY_SOL, JITO_TIP
 *
 * Run: node examples/02-launch-with-dev-buy.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PUMP_SDK } from '@nirholas/pump-sdk';
import BN from 'bn.js';

// Production code uses src/lib/jito.ts. Inlined here for clarity.
async function submitBundle(connection, txs, jitoUrl = 'https://mainnet.block-engine.jito.wtf') {
  const encoded = txs.map((tx) => tx.serialize().toString('base64'));
  const res = await fetch(`${jitoUrl}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [encoded] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Jito rejected: ${JSON.stringify(json.error)}`);
  return json.result;
}

// Pick a Jito tip account. Refresh via tools/check-tip-accounts.ts when bundles fail.
const TIP_ACCOUNTS = [
  'T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt',
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE',
];
const tipAccount = new PublicKey(TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)]);

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const funder = Keypair.fromSecretKey(bs58.decode(process.env.FUNDER_SECRET));
const creator = Keypair.fromSecretKey(bs58.decode(process.env.CREATOR_SECRET));
const mint = Keypair.generate();

console.log('Launching:', process.env.NAME, 'with dev-buy', process.env.DEV_BUY_SOL, 'SOL');
console.log('Mint:', mint.publicKey.toBase58());

const tipLamports = Math.floor(parseFloat(process.env.JITO_TIP) * LAMPORTS_PER_SOL);
const devBuyLamports = Math.floor(parseFloat(process.env.DEV_BUY_SOL || '0') * LAMPORTS_PER_SOL);

const { blockhash } = await conn.getLatestBlockhash('confirmed');

// Tx1: funder pays rent + tip
const tx1 = new Transaction({ feePayer: funder.publicKey, recentBlockhash: blockhash }).add(
  SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: creator.publicKey, lamports: 25_000_000 }),
  SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: tipAccount, lamports: tipLamports }),
);
tx1.sign(funder);

// Tx2: creator runs create + dev-buy
const createIxs = await PUMP_SDK.createV2AndBuyInstructions({
  mint: mint.publicKey, name: process.env.NAME, symbol: process.env.SYMBOL, uri: process.env.URI,
  creator: creator.publicKey, user: creator.publicKey, solAmount: new BN(devBuyLamports),
  amount: new BN(1), mayhemMode: false, cashback: true,
});
const tx2 = new Transaction({ feePayer: creator.publicKey, recentBlockhash: blockhash }).add(...createIxs);
tx2.sign(creator, mint);

const bundleId = await submitBundle(conn, [tx1, tx2]);
console.log('Bundle submitted:', bundleId);
console.log('Coin page:', `https://pump.fun/coin/${mint.publicKey.toBase58()}`);
