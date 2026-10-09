/**
 * 03-collect-and-drain.js — one-shot atomic creator-fee collect + drain
 *
 * Builds a single tx that:
 *   1. Sweeps the creator fees waiting on the coin's bonding curve (and pool,
 *      once graduated) into the creator vaults. The new trade instructions
 *      (buy_v3 / sell_v3, PumpSwap buy_v2 / sell_v2) leave the fee there until
 *      a sweep_creator_fee moves it.
 *   2. Calls pump.fun's collect_creator_fee and collect_coin_creator_fee.
 *   3. Transfers the collected SOL from creator wallet to DESTINATION.
 *
 * Both in one tx, in one Jito bundle. The collected SOL never settles on the
 * creator wallet long enough for a sweeper to grab it.
 *
 * Required .env:
 *   RPC_URL, FUNDER_SECRET, CREATOR_SECRET, MINT, DESTINATION, JITO_TIP
 *
 * Run: node examples/03-collect-and-drain.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { readPendingCreatorFees, creatorFeeSweepInstructions } from '../src/lib/creator-fee-sweep.js';

async function submitBundle(_conn, txs, jitoUrl = 'https://mainnet.block-engine.jito.wtf') {
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

const TIP_ACCOUNTS = [new PublicKey('T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt')];

const conn = new Connection(process.env.RPC_URL, 'confirmed');
const funder = Keypair.fromSecretKey(bs58.decode(process.env.FUNDER_SECRET));
const creator = Keypair.fromSecretKey(bs58.decode(process.env.CREATOR_SECRET));
const mint = new PublicKey(process.env.MINT);
const destination = new PublicKey(process.env.DESTINATION);

if (destination.equals(funder.publicKey) || destination.equals(creator.publicKey)) {
  throw new Error('DESTINATION must not equal funder or creator — refusing to run.');
}

console.log('Collecting creator fees from:', mint.toBase58());

// Pre-balance — used to compute the post-collect balance to forward.
const preBalance = await conn.getBalance(creator.publicKey, 'confirmed');

const sdk = new OnlinePumpSdk(conn);
const bc = await sdk.fetchBondingCurve(mint);
if (bc.isHolderReward) {
  throw new Error('This is a holder-reward coin: its creator fees go to holders through pump.fun, so there is nothing for the creator to collect.');
}
// Sweep first: a collect without it leaves every fee from the new trade
// instructions sitting on the curve or pool.
const pending = await readPendingCreatorFees({ connection: conn, creator: creator.publicKey, mints: [mint] });
const sweepIxs = await creatorFeeSweepInstructions({ payer: funder.publicKey, creator: creator.publicKey, coins: pending.coins });
// Collects the bonding-curve vault and the PumpSwap vault in one go, so it
// works before and after graduation.
const collectIxs = await sdk.collectCoinCreatorFeeInstructions(creator.publicKey, funder.publicKey);
const vaultLamports = Number(await sdk.getCreatorVaultBalance(creator.publicKey)) + Number(pending.curveLamports);

const tipLamports = Math.floor(parseFloat(process.env.JITO_TIP) * LAMPORTS_PER_SOL);
const tipAccount = TIP_ACCOUNTS[0];

// Forward the creator's balance plus the lamports the bonding-curve vault pays
// out, minus a small rent reserve. The PumpSwap vault pays wrapped SOL to the
// creator's token account, so it is not part of this lamport transfer.
const RESERVE = 1_000_000; // ~0.001 SOL for rent
const forwardLamports = Math.max(0, preBalance + vaultLamports - RESERVE);

const { blockhash } = await conn.getLatestBlockhash('confirmed');
const tx = new Transaction({ feePayer: funder.publicKey, recentBlockhash: blockhash }).add(
  ...sweepIxs,
  ...collectIxs,
  SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: destination, lamports: forwardLamports }),
  SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: tipAccount, lamports: tipLamports }),
);
tx.sign(funder, creator);

const bundleId = await submitBundle(conn, [tx]);
console.log('Bundle submitted:', bundleId);
console.log('Destination Solscan:', `https://solscan.io/account/${destination.toBase58()}`);
