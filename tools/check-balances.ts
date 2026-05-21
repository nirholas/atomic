#!/usr/bin/env tsx
/**
 * Print SOL + all SPL / Token-2022 balances for a Solana wallet.
 *
 * Useful as a pre/post check around any of the atomic flows in this repo:
 * before sweeping a leaked wallet (audit what's there) and after (confirm
 * residual is only the rent-exempt minimum).
 *
 * Usage:
 *   npx tsx tools/check-balances.ts <walletAddress> [rpcUrl]
 *
 * Env:
 *   RPC_URL — alternative to the positional rpcUrl arg.
 */

import { Connection, PublicKey } from '@solana/web3.js';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

interface TokenBalance {
  mint: string;
  amount: bigint;
  decimals: number;
  uiAmount: number;
  programId: string;
  programLabel: 'SPL Token' | 'Token-2022';
}

async function fetchTokenBalances(
  conn: Connection,
  owner: PublicKey,
  programId: PublicKey,
  label: TokenBalance['programLabel'],
): Promise<TokenBalance[]> {
  const accounts = await conn.getParsedTokenAccountsByOwner(owner, { programId });
  const balances: TokenBalance[] = [];
  for (const { account } of accounts.value) {
    const info = account.data.parsed.info;
    const amountStr: string = info.tokenAmount.amount;
    const decimals: number = info.tokenAmount.decimals;
    const uiAmount: number = info.tokenAmount.uiAmount ?? 0;
    const amount = BigInt(amountStr);
    if (amount === 0n) continue;
    balances.push({
      mint: info.mint,
      amount,
      decimals,
      uiAmount,
      programId: programId.toBase58(),
      programLabel: label,
    });
  }
  return balances;
}

async function main(): Promise<void> {
  const [, , walletArg, rpcArg] = process.argv;
  if (!walletArg) {
    console.error('Usage: npx tsx tools/check-balances.ts <walletAddress> [rpcUrl]');
    process.exit(1);
  }

  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletArg);
  } catch {
    console.error(`${RED}Invalid pubkey:${NC} ${walletArg}`);
    process.exit(1);
  }

  const rpcUrl = rpcArg ?? process.env['RPC_URL'] ?? 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');

  console.log(`${BOLD}Wallet:${NC} ${wallet.toBase58()}`);
  console.log(`${DIM}RPC: ${rpcUrl}${NC}\n`);

  const [lamports, splBalances, t22Balances] = await Promise.all([
    conn.getBalance(wallet),
    fetchTokenBalances(conn, wallet, TOKEN_PROGRAM_ID, 'SPL Token'),
    fetchTokenBalances(conn, wallet, TOKEN_2022_PROGRAM_ID, 'Token-2022'),
  ]);

  const sol = lamports / 1e9;
  const solColor = sol > 0.01 ? GREEN : sol > 0 ? YELLOW : DIM;
  console.log(`${BOLD}SOL${NC}: ${solColor}${sol.toFixed(6)}${NC} ${DIM}(${lamports} lamports)${NC}`);
  if (lamports > 0 && lamports <= 0.002 * 1e9) {
    console.log(`  ${DIM}≈ rent-exempt minimum — likely unrecoverable without closing the account${NC}`);
  }
  console.log();

  const allTokens = [...splBalances, ...t22Balances];
  if (allTokens.length === 0) {
    console.log(`${DIM}No non-zero SPL or Token-2022 balances.${NC}`);
    return;
  }

  console.log(`${BOLD}Tokens (${allTokens.length}):${NC}`);
  for (const t of allTokens.sort((a, b) => Number(b.uiAmount - a.uiAmount))) {
    const programTag = t.programLabel === 'Token-2022' ? `${YELLOW}[2022]${NC}` : `${DIM}[SPL] ${NC}`;
    console.log(`  ${programTag} ${t.mint}  ${BOLD}${t.uiAmount}${NC} ${DIM}(${t.amount} @ ${t.decimals}dp)${NC}`);
  }
}

void main().catch(err => {
  console.error(`${RED}Error:${NC} ${(err as Error).message}`);
  process.exit(2);
});
