/**
 * 04-consolidate-three-wallets.js — drain vault + creator + funder into one safe destination
 *
 * Builds one tx with three transfers:
 *   1. Sweep the creator fees waiting on the coin's curve and pool into the
 *      creator vaults, then collect them → creator wallet (via pump-sdk ixs).
 *   2. Drain creator wallet → DESTINATION.
 *   3. Drain funder wallet (minus small reserve for the tx fee) → DESTINATION.
 *
 * All in one Jito bundle. Used to wind down a coin or recover from a leaked-key
 * incident. After this tx lands, the three wallets are effectively empty.
 *
 * For the production version with retry, balance assertions, and post-graduation
 * handling, see src/consolidate.js.
 *
 * Required .env:
 *   RPC_URL, FUNDER_SECRET, CREATOR_SECRET, MINT, DESTINATION, JITO_TIP
 *
 * Run: node examples/04-consolidate-three-wallets.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { readPendingCreatorFees, creatorFeeSweepInstructions } from '../src/lib/creator-fee-sweep.js';

async function submitBundle(_conn, txs) {
  const encoded = txs.map((tx) => tx.serialize().toString('base64'));
  const res = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [encoded] }),
  });
  return (await res.json()).result;
}

const TIP_ACCOUNT = new PublicKey('T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt');

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const funder = Keypair.fromSecretKey(bs58.decode(process.env.FUNDER_SECRET));
const creator = Keypair.fromSecretKey(bs58.decode(process.env.CREATOR_SECRET));
const mint = new PublicKey(process.env.MINT);
const destination = new PublicKey(process.env.DESTINATION);

// Sanity guards
if (destination.equals(funder.publicKey)) throw new Error('DESTINATION == funder');
if (destination.equals(creator.publicKey)) throw new Error('DESTINATION == creator');

const tipLamports = Math.floor(parseFloat(process.env.JITO_TIP) * LAMPORTS_PER_SOL);
const RESERVE = 1_000_000; // small rent reserve

const [funderBal, creatorBal] = await Promise.all([
  conn.getBalance(funder.publicKey, 'confirmed'),
  conn.getBalance(creator.publicKey, 'confirmed'),
]);

console.log('Pre-consolidate balances:');
console.log('  funder:', funderBal / LAMPORTS_PER_SOL, 'SOL');
console.log('  creator:', creatorBal / LAMPORTS_PER_SOL, 'SOL');

const sdk = new OnlinePumpSdk(conn);
const bc = await sdk.fetchBondingCurve(mint);
if (bc.isHolderReward) {
  throw new Error('This is a holder-reward coin: its creator fees go to holders through pump.fun, so there is nothing for the creator to collect.');
}
const pending = await readPendingCreatorFees({ connection: conn, creator: creator.publicKey, mints: [mint] });
const sweepIxs = await creatorFeeSweepInstructions({ payer: funder.publicKey, creator: creator.publicKey, coins: pending.coins });
const collectIxs = await sdk.collectCoinCreatorFeeInstructions(creator.publicKey, funder.publicKey);
// Lamports the bonding-curve vault pays the creator in this tx (vault + swept curve fee).
const vaultLamports = Number(await sdk.getCreatorVaultBalance(creator.publicKey)) + Number(pending.curveLamports);

const creatorDrain = Math.max(0, creatorBal + vaultLamports - RESERVE);
const funderDrain = Math.max(0, funderBal - RESERVE - tipLamports - 5000); // 5000 for network fee

const { blockhash } = await conn.getLatestBlockhash('confirmed');
const tx = new Transaction({ feePayer: funder.publicKey, recentBlockhash: blockhash }).add(
  ...sweepIxs,
  ...collectIxs,
  SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: destination, lamports: creatorDrain }),
  SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: destination, lamports: funderDrain }),
  SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: TIP_ACCOUNT, lamports: tipLamports }),
);
tx.sign(funder, creator);

const bundleId = await submitBundle(conn, [tx]);
console.log('Bundle submitted:', bundleId);
console.log('Destination:', `https://solscan.io/account/${destination.toBase58()}`);
