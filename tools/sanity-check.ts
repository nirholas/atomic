#!/usr/bin/env tsx
/**
 * Pre-flight sanity check for pump-launch-toolkit env.
 *
 * Read-only. Does NOT send any transaction or spend any SOL. Use this
 * before a launch / collect / consolidate run to validate that:
 *   - Required env vars are set and parseable.
 *   - FUNDER_SECRET / CREATOR_SECRET decode to valid Ed25519 keypairs.
 *   - DESTINATION (when set) is a valid PublicKey.
 *   - The configured RPC is reachable.
 *   - Funder, creator, and destination balances make sense.
 *   - Creator-fee vault balance (if known) is fetchable.
 *
 * Usage:
 *   npm run sanity                              # checks whatever env you have
 *   FUNDER_SECRET=… CREATOR_SECRET=… npm run sanity
 *
 * Env (all optional — only checks what you provide):
 *   RPC_URL           Solana RPC endpoint.       Default: mainnet-beta.
 *   FUNDER_SECRET     Base58 secret key.         Checks balance.
 *   CREATOR_SECRET    Base58 secret key.         Checks balance + vault.
 *   DESTINATION       Base58 pubkey.             Checks existence.
 *
 * Exit status:
 *   0  every check that ran passed (or info-only).
 *   1  at least one check failed (invalid key, RPC unreachable, etc).
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58Mod from 'bs58';

const bs58decode: (s: string) => Uint8Array =
  (bs58Mod as { default?: { decode: (s: string) => Uint8Array }; decode?: (s: string) => Uint8Array }).default?.decode
    ?? (bs58Mod as { decode: (s: string) => Uint8Array }).decode;

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

const RENT_EXEMPT_MIN_LAMPORTS = 890_880;

type Status = 'ok' | 'warn' | 'fail' | 'info';
interface Check {
  name: string;
  status: Status;
  detail: string;
}

function fmt(status: Status): string {
  switch (status) {
    case 'ok':   return `${GREEN}${BOLD}OK${NC}    `;
    case 'warn': return `${YELLOW}${BOLD}WARN${NC}  `;
    case 'fail': return `${RED}${BOLD}FAIL${NC}  `;
    case 'info': return `${DIM}${BOLD}INFO${NC}  `;
  }
}

function tryParseKeypair(secret: string): Keypair | Error {
  try {
    return Keypair.fromSecretKey(bs58decode(secret));
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

function tryParsePubkey(addr: string): PublicKey | Error {
  try {
    return new PublicKey(addr);
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  }
}

async function main(): Promise<void> {
  const checks: Check[] = [];

  // ── Env presence ────────────────────────────────────────────────────
  const rpcUrl = process.env['RPC_URL'] ?? 'https://api.mainnet-beta.solana.com';
  checks.push({
    name: 'RPC_URL',
    status: process.env['RPC_URL'] ? 'ok' : 'info',
    detail: rpcUrl + (process.env['RPC_URL'] ? '' : ' (default — public mainnet, may rate-limit)'),
  });

  // ── Wallet parsing ──────────────────────────────────────────────────
  let funder: Keypair | null = null;
  let creator: Keypair | null = null;
  let destination: PublicKey | null = null;

  if (process.env['FUNDER_SECRET']) {
    const r = tryParseKeypair(process.env['FUNDER_SECRET']);
    if (r instanceof Keypair) {
      funder = r;
      checks.push({ name: 'FUNDER_SECRET', status: 'ok', detail: r.publicKey.toBase58() });
    } else {
      checks.push({ name: 'FUNDER_SECRET', status: 'fail', detail: `parse error: ${r.message}` });
    }
  } else {
    checks.push({ name: 'FUNDER_SECRET', status: 'info', detail: 'unset (skipped)' });
  }

  if (process.env['CREATOR_SECRET']) {
    const r = tryParseKeypair(process.env['CREATOR_SECRET']);
    if (r instanceof Keypair) {
      creator = r;
      checks.push({ name: 'CREATOR_SECRET', status: 'ok', detail: r.publicKey.toBase58() });
    } else {
      checks.push({ name: 'CREATOR_SECRET', status: 'fail', detail: `parse error: ${r.message}` });
    }
  } else {
    checks.push({ name: 'CREATOR_SECRET', status: 'info', detail: 'unset (skipped)' });
  }

  if (process.env['DESTINATION']) {
    const r = tryParsePubkey(process.env['DESTINATION']);
    if (r instanceof PublicKey) {
      destination = r;
      checks.push({ name: 'DESTINATION', status: 'ok', detail: r.toBase58() });
    } else {
      checks.push({ name: 'DESTINATION', status: 'fail', detail: `parse error: ${r.message}` });
    }
  } else {
    checks.push({ name: 'DESTINATION', status: 'info', detail: 'unset (skipped)' });
  }

  // ── RPC reachability ────────────────────────────────────────────────
  const connection = new Connection(rpcUrl, 'confirmed');
  let rpcOk = false;
  try {
    const t0 = Date.now();
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const ms = Date.now() - t0;
    rpcOk = true;
    checks.push({
      name: 'RPC reachable',
      status: 'ok',
      detail: `blockhash ${blockhash.slice(0, 8)}… in ${ms}ms`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    checks.push({ name: 'RPC reachable', status: 'fail', detail: msg });
  }

  // ── Balances (only if both RPC is up and the wallet parsed) ─────────
  if (rpcOk && funder) {
    const bal = await connection.getBalance(funder.publicKey, 'confirmed');
    const sol = bal / 1e9;
    let status: Status = 'ok';
    let detail = `${sol.toFixed(4)} SOL`;
    if (bal === 0) {
      status = 'fail';
      detail += ' — empty; cannot pay fees or tips';
    } else if (bal < 0.05 * 1e9) {
      status = 'warn';
      detail += ' — below 0.05 SOL; may run out of headroom for ATA rents / Jito tips';
    }
    checks.push({ name: 'Funder balance', status, detail });
  }

  if (rpcOk && creator) {
    const bal = await connection.getBalance(creator.publicKey, 'confirmed');
    const sol = bal / 1e9;
    let status: Status = 'ok';
    let detail = `${sol.toFixed(6)} SOL`;
    if (bal === 0) {
      status = 'info';
      detail += ' — empty (normal pre-launch; collect-jito fills + drains in one tx)';
    } else if (bal < RENT_EXEMPT_MIN_LAMPORTS) {
      status = 'warn';
      detail += ` — below rent-exempt floor (${RENT_EXEMPT_MIN_LAMPORTS / 1e9} SOL); wallet may not stay open after drain`;
    }
    checks.push({ name: 'Creator balance', status, detail });
  }

  if (rpcOk && destination) {
    const info = await connection.getAccountInfo(destination, 'confirmed');
    if (info === null) {
      checks.push({
        name: 'Destination',
        status: 'warn',
        detail: 'account does not yet exist on-chain — first SOL transfer will create it (this is usually fine)',
      });
    } else {
      const sol = info.lamports / 1e9;
      checks.push({
        name: 'Destination',
        status: 'ok',
        detail: `exists, ${sol.toFixed(4)} SOL`,
      });
    }
  }

  // ── Creator-fee vault (if creator parsed and pump-sdk is installed) ─
  if (rpcOk && creator) {
    try {
      const sdkModule = (await import('@nirholas/pump-sdk')) as { OnlinePumpSdk?: new (c: Connection) => { getCreatorVaultBalance: (pk: PublicKey) => Promise<{ toString(): string }> } };
      if (sdkModule.OnlinePumpSdk) {
        const sdk = new sdkModule.OnlinePumpSdk(connection);
        const vaultRaw = await sdk.getCreatorVaultBalance(creator.publicKey);
        const vaultLamports = Number(vaultRaw.toString());
        const vaultSol = vaultLamports / 1e9;
        let status: Status = 'info';
        let detail = `${vaultSol.toFixed(6)} SOL accumulated`;
        if (vaultLamports >= 0.001 * 1e9) {
          status = 'ok';
          detail += ' — large enough to collect';
        } else if (vaultLamports > 0) {
          status = 'info';
          detail += ' — below collect-jito threshold (0.001 SOL)';
        }
        checks.push({ name: 'Creator vault', status, detail });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      checks.push({
        name: 'Creator vault',
        status: 'info',
        detail: `skipped (${msg.split('\n')[0]})`,
      });
    }
  }

  // ── Print + exit ────────────────────────────────────────────────────
  console.log(`\n${BOLD}pump-launch-toolkit sanity check${NC}\n`);
  for (const c of checks) {
    console.log(`${fmt(c.status)} ${c.name.padEnd(20)} ${c.detail}`);
  }
  console.log();

  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  if (failed > 0) {
    console.log(`${RED}${BOLD}${failed} check(s) failed.${NC} Resolve before running launch/collect.`);
    process.exit(1);
  }
  if (warned > 0) {
    console.log(`${YELLOW}${BOLD}${warned} warning(s).${NC} Review above before spending SOL.`);
  } else {
    console.log(`${GREEN}${BOLD}All checks passed.${NC}`);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
