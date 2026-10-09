/**
 * 01-basic-launch.js — minimal pump.fun coin launch
 *
 * Demonstrates the create-only flow with no Jito bundle (single tx, single signer).
 * Useful for a coin where the funder == creator and there's no concern about
 * sweeper races or MEV.
 *
 * For the atomic-bundle variant (separate funder/creator + Jito atomicity), see
 * src/fire-jito.js or example 02.
 *
 * Required .env:
 *   RPC_URL, FUNDER_SECRET (which also signs as creator), NAME, SYMBOL, URI
 *
 * Optional .env:
 *   HOLDER_REWARD=true  launch a holder-reward coin (creator fees are paid out to
 *                       holders by pump.fun). Cashback launches are retired.
 *
 * Run: node examples/01-basic-launch.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import { assertLaunchOptionsAllowed, describeFeeRecipient, resolveLaunchOptions } from '../src/lib/launch-options.js';

const conn = new Connection(process.env.RPC_URL, 'confirmed');

const wallet = Keypair.fromSecretKey(bs58.decode(process.env.FUNDER_SECRET));
const mint = Keypair.generate();
const launch = resolveLaunchOptions();
if (launch.holderReward) assertLaunchOptionsAllowed(launch, await new OnlinePumpSdk(conn).fetchGlobal());

console.log('Launching:', process.env.NAME, '(' + process.env.SYMBOL + ')');
console.log('Mint:', mint.publicKey.toBase58());
console.log('Signer:', wallet.publicKey.toBase58());
console.log('Creator fees accrue to:', describeFeeRecipient(launch, mint.publicKey, wallet.publicKey));

// Build the createV2 instruction. Wallet is both creator and fee-payer.
const createIx = await PUMP_SDK.createV2Instruction({
  mint: mint.publicKey,
  name: process.env.NAME,
  symbol: process.env.SYMBOL,
  uri: process.env.URI,
  creator: wallet.publicKey,
  user: wallet.publicKey,
  mayhemMode: false,
  holderReward: launch.holderReward,
});

const tx = new Transaction().add(createIx);
const sig = await sendAndConfirmTransaction(conn, tx, [wallet, mint]);

console.log('Done. tx:', `https://solscan.io/tx/${sig}`);
console.log('Coin page:', `https://pump.fun/coin/${mint.publicKey.toBase58()}`);
