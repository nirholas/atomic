#!/usr/bin/env tsx
/**
 * Fetch the live Jito Block Engine tip-account list and diff against the
 * hardcoded list in tmp/leaked-launch/fire-jito.js. Reports drift so the
 * hardcoded list can be updated before bundles start failing with:
 *   "Bundles must write lock at least one tip account"
 *
 * Usage:
 *   npx tsx tools/check-tip-accounts.ts [blockEngineUrl]
 *
 * Defaults to mainnet block engine. Exit code:
 *   0 — local list contains all live accounts (no drift, or local is a superset)
 *   1 — drift detected (live has accounts the local list does not)
 *   2 — RPC error
 */

const DEFAULT_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

// Mirror of JITO_TIP_ACCOUNTS in tmp/leaked-launch/fire-jito.js as of last sync.
// Update this constant when running this tool flags drift.
const HARDCODED: readonly string[] = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDe9B',
  'ADuUkR4vqLUMWXxW9gh6D6L8pivKeVBBmf9pNxqx9aja',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

async function fetchLiveTipAccounts(endpoint: string): Promise<string[]> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getTipAccounts',
      params: [],
    }),
  });

  if (!res.ok) {
    throw new Error(`Block engine HTTP ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as JsonRpcResponse<string[]>;
  if (body.error) {
    throw new Error(`Block engine RPC error ${body.error.code}: ${body.error.message}`);
  }
  if (!Array.isArray(body.result)) {
    throw new Error(`Unexpected response shape: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.result;
}

async function main(): Promise<void> {
  const endpoint = process.argv[2] ?? DEFAULT_BLOCK_ENGINE;

  console.log(`${BOLD}Jito tip-account drift check${NC}`);
  console.log(`${DIM}endpoint: ${endpoint}${NC}\n`);

  let live: string[];
  try {
    live = await fetchLiveTipAccounts(endpoint);
  } catch (err) {
    console.error(`${RED}RPC error:${NC} ${(err as Error).message}`);
    process.exit(2);
  }

  const liveSet = new Set(live);
  const hardcodedSet = new Set(HARDCODED);

  const liveOnly = live.filter(a => !hardcodedSet.has(a));
  const hardcodedOnly = HARDCODED.filter(a => !liveSet.has(a));

  console.log(`${BOLD}Live accounts:${NC} ${live.length}`);
  for (const a of live) {
    const marker = hardcodedSet.has(a) ? `${GREEN}✓${NC}` : `${YELLOW}+${NC}`;
    console.log(`  ${marker} ${a}`);
  }

  if (hardcodedOnly.length > 0) {
    console.log(`\n${BOLD}In hardcoded list but not live${NC} ${DIM}(removed upstream?)${NC}:`);
    for (const a of hardcodedOnly) console.log(`  ${YELLOW}-${NC} ${a}`);
  }

  console.log();
  if (liveOnly.length > 0) {
    console.log(`${RED}${BOLD}DRIFT:${NC} ${liveOnly.length} live tip account(s) missing from hardcoded list.`);
    console.log('Update JITO_TIP_ACCOUNTS in tmp/leaked-launch/fire-jito.js (and any other script that hardcodes the list) to include:');
    for (const a of liveOnly) console.log(`  '${a}',`);
    process.exit(1);
  }

  if (hardcodedOnly.length > 0) {
    console.log(`${YELLOW}${BOLD}WARNING:${NC} hardcoded list has ${hardcodedOnly.length} account(s) not present upstream. Bundles using these may fail; consider pruning.`);
    process.exit(0);
  }

  console.log(`${GREEN}${BOLD}OK${NC} — hardcoded list matches live tip accounts exactly.`);
  process.exit(0);
}

void main();
