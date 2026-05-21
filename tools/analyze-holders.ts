#!/usr/bin/env tsx
/**
 * Analyze the holder distribution of a Solana SPL / Token-2022 mint.
 * Prints holder count, top-N concentration, Gini coefficient, and a histogram
 * of holdings by order-of-magnitude. Useful as a pre-check before
 * `distribute.js` (sqrt-weighted USDC rewards) and as a Sybil signal — a
 * "natural" holder distribution roughly follows a power law; a sudden spike
 * of equal-sized holders is suspect.
 *
 * Usage:
 *   npx tsx tools/analyze-holders.ts <mint> [rpcUrl]
 *
 * Env:
 *   RPC_URL — alternative to the positional rpcUrl arg.
 *
 * Note: getProgramAccounts is heavy. Use a paid RPC (Helius/Triton) for any
 * coin with >500 holders or you will get rate-limited. Public mainnet times
 * out around the 1000-account mark.
 */

import { Connection, PublicKey } from '@solana/web3.js';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

interface Holder {
  owner: string;
  amount: bigint;
  uiAmount: number;
}

async function detectProgramId(conn: Connection, mint: PublicKey): Promise<PublicKey> {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error(`Mint ${mint.toBase58()} has no account info`);
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
  throw new Error(`Mint ${mint.toBase58()} is not owned by an SPL token program (owner: ${info.owner.toBase58()})`);
}

async function fetchHolders(conn: Connection, mint: PublicKey, programId: PublicKey): Promise<Holder[]> {
  const accounts = await conn.getParsedProgramAccounts(programId, {
    filters: [
      { dataSize: programId.equals(TOKEN_2022_PROGRAM_ID) ? 182 : 165 },
      { memcmp: { offset: 0, bytes: mint.toBase58() } },
    ],
  });
  const holders: Holder[] = [];
  for (const { account } of accounts) {
    if (!('parsed' in account.data)) continue;
    const info = (account.data as { parsed: { info: { owner: string; tokenAmount: { amount: string; uiAmount: number } } } }).parsed.info;
    const amount = BigInt(info.tokenAmount.amount);
    if (amount === 0n) continue;
    holders.push({ owner: info.owner, amount, uiAmount: info.tokenAmount.uiAmount ?? 0 });
  }
  // Sum same-owner accounts (rare but happens with multiple ATAs of different program flavors).
  const byOwner = new Map<string, Holder>();
  for (const h of holders) {
    const existing = byOwner.get(h.owner);
    if (existing) {
      existing.amount += h.amount;
      existing.uiAmount += h.uiAmount;
    } else {
      byOwner.set(h.owner, { ...h });
    }
  }
  return Array.from(byOwner.values()).sort((a, b) => Number(b.amount - a.amount));
}

function gini(amounts: bigint[]): number {
  if (amounts.length === 0) return 0;
  const sorted = [...amounts].sort((a, b) => Number(a - b));
  const n = sorted.length;
  let total = 0n;
  for (const a of sorted) total += a;
  if (total === 0n) return 0;
  let weighted = 0n;
  for (let i = 0; i < n; i++) {
    weighted += BigInt(2 * i - n + 1) * sorted[i]!;
  }
  // Gini = sum(weighted) / (n * total). Convert through Number; safe for typical token supplies.
  return Number(weighted) / (n * Number(total));
}

function histogram(holders: Holder[]): Map<number, number> {
  const buckets = new Map<number, number>();
  for (const h of holders) {
    if (h.uiAmount <= 0) continue;
    const mag = Math.floor(Math.log10(h.uiAmount));
    buckets.set(mag, (buckets.get(mag) ?? 0) + 1);
  }
  return buckets;
}

function detectSybilSignal(holders: Holder[]): string[] {
  const signals: string[] = [];
  if (holders.length < 10) return signals;

  // Signal 1: many holders with near-identical balances
  const balanceClusters = new Map<string, number>();
  for (const h of holders) {
    const key = h.uiAmount.toExponential(2); // bucket by 2 sig figs
    balanceClusters.set(key, (balanceClusters.get(key) ?? 0) + 1);
  }
  const biggestCluster = Math.max(...balanceClusters.values());
  if (biggestCluster >= holders.length * 0.1 && biggestCluster >= 5) {
    signals.push(
      `${biggestCluster} holders share the same balance (within 2 sig figs). Natural distributions rarely cluster this tightly — possible Sybil.`,
    );
  }

  // Signal 2: top-N concentration too low (un-natural egalitarianism)
  const totalBig = holders.reduce((s, h) => s + h.amount, 0n);
  const total = Number(totalBig);
  const top10Pct = (holders.slice(0, 10).reduce((s, h) => s + Number(h.amount), 0) / total) * 100;
  if (top10Pct < 15 && holders.length >= 50) {
    signals.push(
      `Top-10 hold only ${top10Pct.toFixed(1)}% of supply with ${holders.length} total holders. Natural pump.fun distributions usually have >25% top-10 concentration; suspiciously flat.`,
    );
  }

  return signals;
}

async function main(): Promise<void> {
  const [, , mintArg, rpcArg] = process.argv;
  if (!mintArg) {
    console.error('Usage: npx tsx tools/analyze-holders.ts <mint> [rpcUrl]');
    process.exit(1);
  }

  let mint: PublicKey;
  try {
    mint = new PublicKey(mintArg);
  } catch {
    console.error(`${RED}Invalid mint pubkey:${NC} ${mintArg}`);
    process.exit(1);
  }

  const rpcUrl = rpcArg ?? process.env['RPC_URL'] ?? 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpcUrl, 'confirmed');

  console.log(`${BOLD}Holder analysis${NC}`);
  console.log(`${DIM}mint: ${mint.toBase58()}${NC}`);
  console.log(`${DIM}rpc:  ${rpcUrl}${NC}\n`);

  const programId = await detectProgramId(conn, mint);
  console.log(`${DIM}program: ${programId.equals(TOKEN_2022_PROGRAM_ID) ? 'Token-2022' : 'SPL Token'}${NC}`);

  const holders = await fetchHolders(conn, mint, programId);

  if (holders.length === 0) {
    console.log(`${YELLOW}No non-zero holders.${NC}`);
    return;
  }

  const totalBig = holders.reduce((s, h) => s + h.amount, 0n);
  const total = Number(totalBig);

  console.log(`${BOLD}Holders:${NC} ${holders.length}`);
  console.log(`${BOLD}Supply held:${NC} ${holders.reduce((s, h) => s + h.uiAmount, 0).toLocaleString()}`);

  console.log(`\n${BOLD}Top-N concentration:${NC}`);
  for (const n of [1, 5, 10, 25, 50, 100]) {
    if (n > holders.length) break;
    const slice = holders.slice(0, n);
    const sum = slice.reduce((s, h) => s + Number(h.amount), 0);
    const pct = (sum / total) * 100;
    console.log(`  top-${String(n).padStart(3)}: ${pct.toFixed(2)}%`);
  }

  const g = gini(holders.map(h => h.amount));
  const giniColor = g < 0.5 ? GREEN : g < 0.8 ? YELLOW : RED;
  console.log(`\n${BOLD}Gini coefficient:${NC} ${giniColor}${g.toFixed(3)}${NC}  ${DIM}(0 = perfect equality, 1 = one holder owns everything)${NC}`);

  console.log(`\n${BOLD}Order-of-magnitude histogram (balance):${NC}`);
  const hist = histogram(holders);
  const mags = Array.from(hist.keys()).sort((a, b) => a - b);
  const maxCount = Math.max(...hist.values());
  for (const m of mags) {
    const count = hist.get(m)!;
    const bar = '█'.repeat(Math.ceil((count / maxCount) * 30));
    const low = Math.pow(10, m);
    const high = Math.pow(10, m + 1);
    console.log(`  ${DIM}[${low.toExponential(0)}, ${high.toExponential(0)})${NC}  ${CYAN}${bar}${NC} ${count}`);
  }

  console.log(`\n${BOLD}Top 10 holders:${NC}`);
  for (let i = 0; i < Math.min(10, holders.length); i++) {
    const h = holders[i]!;
    const pct = (Number(h.amount) / total) * 100;
    console.log(`  ${String(i + 1).padStart(2)}. ${h.owner}  ${BOLD}${h.uiAmount.toLocaleString()}${NC}  ${DIM}(${pct.toFixed(2)}%)${NC}`);
  }

  const sybil = detectSybilSignal(holders);
  if (sybil.length > 0) {
    console.log(`\n${YELLOW}${BOLD}Sybil signals:${NC}`);
    for (const s of sybil) console.log(`  ${YELLOW}!${NC} ${s}`);
  } else {
    console.log(`\n${GREEN}No obvious Sybil signals detected.${NC} ${DIM}(absence is not evidence — sophisticated Sybils evade these heuristics)${NC}`);
  }
}

void main().catch(err => {
  console.error(`${RED}Error:${NC} ${(err as Error).message}`);
  process.exit(2);
});
