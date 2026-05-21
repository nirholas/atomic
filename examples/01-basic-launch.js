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
 * Run: node examples/01-basic-launch.js
 */

import 'dotenv/config';
import bs58 from 'bs58';
import { Connection, Keypair, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import { PUMP_SDK } from '@nirholas/pump-sdk';

const conn = new Connection(process.env.RPC_URL, 'confirmed');

const wallet = Keypair.fromSecretKey(bs58.decode(process.env.FUNDER_SECRET));
const mint = Keypair.generate();

console.log('Launching:', process.env.NAME, '(' + process.env.SYMBOL + ')');
console.log('Mint:', mint.publicKey.toBase58());
console.log('Signer:', wallet.publicKey.toBase58());

// Build the createV2 instruction(s). Wallet is both creator and fee-payer.
const instructions = await PUMP_SDK.createV2Instructions({
  mint: mint.publicKey,
  name: process.env.NAME,
  symbol: process.env.SYMBOL,
  uri: process.env.URI,
  creator: wallet.publicKey,
  user: wallet.publicKey,
  mayhemMode: false,
  cashback: true,
});

const tx = new Transaction().add(...instructions);
const sig = await sendAndConfirmTransaction(conn, tx, [wallet, mint]);

console.log('Done. tx:', `https://solscan.io/tx/${sig}`);
console.log('Coin page:', `https://pump.fun/coin/${mint.publicKey.toBase58()}`);
