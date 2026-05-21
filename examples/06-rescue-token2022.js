/**
 * 06-rescue-token2022.js — atomically move SPL or Token-2022 tokens out of a leaked wallet
 *
 * Detects whether the mint is standard SPL Token or Token-2022, creates the
 * destination's ATA if missing, and transfers the full balance — all in one
 * Jito bundle so a sweeper bot has no window to insert.
 *
 * Required .env:
 *   RPC_URL, FUNDER_SECRET (pays bundle fee + tip),
 *   RESCUE_SOURCE (base58 secret of the leaked wallet),
 *   RESCUE_DEST (base58 pubkey of the safe wallet),
 *   RESCUE_MINT (base58 mint to transfer),
 *   JITO_TIP
 *
 * Run: node examples/06-rescue-token2022.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  createTransferInstruction, getAccount,
} from '@solana/spl-token';

async function submitBundle(txs) {
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
const source = Keypair.fromSecretKey(bs58.decode(process.env.RESCUE_SOURCE));
const destination = new PublicKey(process.env.RESCUE_DEST);
const mint = new PublicKey(process.env.RESCUE_MINT);

// 1. Detect token program (SPL Token vs Token-2022) by reading the mint account owner
const mintInfo = await conn.getAccountInfo(mint);
if (!mintInfo) throw new Error(`Mint ${mint.toBase58()} not found`);
const tokenProgram = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
console.log('Detected token program:', tokenProgram.toBase58());

// 2. Get source's ATA + balance
const sourceAta = getAssociatedTokenAddressSync(mint, source.publicKey, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
const account = await getAccount(conn, sourceAta, 'confirmed', tokenProgram);
console.log('Source balance:', account.amount.toString());
if (account.amount === 0n) throw new Error('Nothing to rescue');

// 3. Compute destination ATA; create if missing
const destAta = getAssociatedTokenAddressSync(mint, destination, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
const destAtaInfo = await conn.getAccountInfo(destAta);

const ixs = [];
if (!destAtaInfo) {
  console.log('Creating destination ATA');
  ixs.push(createAssociatedTokenAccountInstruction(funder.publicKey, destAta, destination, mint, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID));
}
ixs.push(createTransferInstruction(sourceAta, destAta, source.publicKey, account.amount, [], tokenProgram));

const tipLamports = Math.floor(parseFloat(process.env.JITO_TIP) * LAMPORTS_PER_SOL);
ixs.push(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: TIP_ACCOUNT, lamports: tipLamports }));

const { blockhash } = await conn.getLatestBlockhash('confirmed');
const tx = new Transaction({ feePayer: funder.publicKey, recentBlockhash: blockhash }).add(...ixs);
tx.sign(funder, source);

const bundleId = await submitBundle([tx]);
console.log('Bundle submitted:', bundleId);
