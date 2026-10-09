/**
 * 08-watch-collect-alerts.js — long-running watcher that auto-collects and notifies
 *
 * Polls the creator-fee vault every POLL_INTERVAL_SECONDS. When the vault crosses
 * MIN_COLLECT_SOL, fires the collect-and-drain bundle (from example 03) and posts
 * a Telegram alert with the bundle ID.
 *
 * For the production version with retry, exponential backoff, and structured
 * logging, see src/watch-collect.js. This example focuses on the alerting hook.
 *
 * Required .env:
 *   RPC_URL, FUNDER_SECRET, CREATOR_SECRET, MINT, DESTINATION, MIN_COLLECT_SOL,
 *   POLL_INTERVAL_SECONDS, JITO_TIP, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *
 * Run: node examples/08-watch-collect-alerts.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { readPendingCreatorFees, creatorFeeSweepInstructions } from '../src/lib/creator-fee-sweep.js';

const TIP_ACCOUNT = new PublicKey('T1pyyaTNZsKv2WcRAB8oVnk93mLJw2XzjtVYqCsaHqt');

async function sendTelegram(text) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: false }),
  });
}

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
const creator = Keypair.fromSecretKey(bs58.decode(process.env.CREATOR_SECRET));
const mint = new PublicKey(process.env.MINT);
const destination = new PublicKey(process.env.DESTINATION);

const minLamports = Math.floor(parseFloat(process.env.MIN_COLLECT_SOL) * LAMPORTS_PER_SOL);
const tipLamports = Math.floor(parseFloat(process.env.JITO_TIP) * LAMPORTS_PER_SOL);
const pollMs = parseInt(process.env.POLL_INTERVAL_SECONDS || '30', 10) * 1000;

const sdk = new OnlinePumpSdk(conn);
if ((await sdk.fetchBondingCurve(mint)).isHolderReward) {
  throw new Error('This is a holder-reward coin: its creator fees go to holders through pump.fun, so there is nothing to watch or collect.');
}

console.log(`Watch-collect started. Polling every ${pollMs / 1000}s. Threshold: ${process.env.MIN_COLLECT_SOL} SOL.`);
await sendTelegram(`📡 <b>Watch-collect started</b> for <code>${mint.toBase58()}</code>`);

while (true) {
  try {
    // Creator vaults are per creator, not per mint: this sums the bonding-curve
    // vault and the PumpSwap vault for every coin this creator launched. Fees
    // the new trade instructions left on this coin's curve and pool are not in
    // a vault until swept, so they are added separately.
    const pending = await readPendingCreatorFees({ connection: conn, creator: creator.publicKey, mints: [mint] });
    const vaultBalance = Number(await sdk.getCreatorVaultBalanceBothPrograms(creator.publicKey))
      + Number(pending.curveLamports) + Number(pending.poolLamports);
    // The bonding-curve vault pays out lamports; the PumpSwap vault pays out
    // wrapped SOL to the creator's token account, so only the lamports are
    // forwarded here.
    const forwardLamports = Number(await sdk.getCreatorVaultBalance(creator.publicKey)) + Number(pending.curveLamports);

    if (vaultBalance >= minLamports) {
      console.log(`Vault has ${vaultBalance / LAMPORTS_PER_SOL} SOL, collecting`);
      const sweepIxs = await creatorFeeSweepInstructions({ payer: funder.publicKey, creator: creator.publicKey, coins: pending.coins });
      const collectIxs = await sdk.collectCoinCreatorFeeInstructions(creator.publicKey, funder.publicKey);

      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      const tx = new Transaction({ feePayer: funder.publicKey, recentBlockhash: blockhash }).add(
        ...sweepIxs,
        ...collectIxs,
        SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: destination, lamports: forwardLamports }),
        SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: TIP_ACCOUNT, lamports: tipLamports }),
      );
      tx.sign(funder, creator);
      const bundleId = await submitBundle([tx]);
      console.log('Collected — bundle:', bundleId);
      await sendTelegram(
        `✅ <b>Collected ${(vaultBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL</b>\n` +
        `Mint: <code>${mint.toBase58()}</code>\n` +
        `Bundle: <code>${bundleId}</code>`
      );
    }
  } catch (err) {
    console.error('Poll error:', err.message);
  }
  await new Promise((r) => setTimeout(r, pollMs));
}
