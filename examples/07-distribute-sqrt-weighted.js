/**
 * 07-distribute-sqrt-weighted.js — pay out USDC to holders with sqrt-weighted shares
 *
 * Fetches all holders of a coin, computes a sqrt-weighted share for each
 * (so the largest holder doesn't dominate), and distributes USDC pro-rata.
 *
 * Distributions are batched in groups of ~10 transfers per tx; each batch is its
 * own Jito bundle.
 *
 * For the production version with retry, EMERGENCY mode, and resumability, see
 * src/distribute.js.
 *
 * Required .env:
 *   RPC_URL, FUNDER_SECRET (holds the USDC + pays tips), MINT (coin to distribute against),
 *   TOTAL_USDC (raw amount in micro-USDC), MIN_BPS (min share to qualify, e.g. 10),
 *   JITO_TIP
 *
 * Run: node examples/07-distribute-sqrt-weighted.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
} from '@solana/spl-token';

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const TIP_ACCOUNT = new PublicKey('T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt');
const BATCH = 10;

async function submitBundle(txs) {
  const encoded = txs.map((tx) => tx.serialize().toString('base64'));
  const res = await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendBundle', params: [encoded] }),
  });
  return (await res.json()).result;
}

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const funder = Keypair.fromSecretKey(bs58.decode(process.env.FUNDER_SECRET));
const mint = new PublicKey(process.env.MINT);
const totalUsdc = BigInt(process.env.TOTAL_USDC);
const minBps = parseInt(process.env.MIN_BPS, 10);
const tipLamports = Math.floor(parseFloat(process.env.JITO_TIP) * LAMPORTS_PER_SOL);

// 1. Fetch holders of the coin's mint via getProgramAccounts
console.log('Fetching holders for', mint.toBase58());
const accounts = await conn.getParsedProgramAccounts(TOKEN_PROGRAM_ID, {
  filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint.toBase58() } }],
});

const balances = accounts
  .map((a) => ({ owner: new PublicKey(a.account.data.parsed.info.owner), amount: BigInt(a.account.data.parsed.info.tokenAmount.amount) }))
  .filter((b) => b.amount > 0n);

console.log('Holders:', balances.length);

// 2. Compute sqrt-weighted shares
const weights = balances.map((b) => ({ owner: b.owner, weight: Math.sqrt(Number(b.amount)) }));
const totalWeight = weights.reduce((s, w) => s + w.weight, 0);
const shares = weights.map((w) => ({
  owner: w.owner,
  amount: BigInt(Math.floor((w.weight / totalWeight) * Number(totalUsdc))),
})).filter((s) => Number(s.amount) * 10000 / Number(totalUsdc) >= minBps); // drop sub-min-bps

console.log('Qualifying holders:', shares.length);

// 3. Build batched transfer txs
const funderUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, funder.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

for (let i = 0; i < shares.length; i += BATCH) {
  const batch = shares.slice(i, i + BATCH);
  const ixs = [];
  for (const { owner, amount } of batch) {
    const destAta = getAssociatedTokenAddressSync(USDC_MINT, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    ixs.push(createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, destAta, owner, USDC_MINT, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
    ixs.push(createTransferInstruction(funderUsdcAta, destAta, funder.publicKey, amount, [], TOKEN_PROGRAM_ID));
  }
  ixs.push(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: TIP_ACCOUNT, lamports: tipLamports }));

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: funder.publicKey, recentBlockhash: blockhash }).add(...ixs);
  tx.sign(funder);

  const bundleId = await submitBundle([tx]);
  console.log(`Batch ${i / BATCH + 1}/${Math.ceil(shares.length / BATCH)} submitted:`, bundleId);
}

console.log('Done. Total distributed:', Number(totalUsdc) / 1e6, 'USDC');
