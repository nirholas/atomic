#!/usr/bin/env tsx
/**
 * Query the status of a Jito bundle by UUID. Useful for debugging why a
 * bundle did or did not land — distinguishes "Invalid" (rejected before
 * scheduling) from "Pending" (scheduled but not yet landed) from "Landed"
 * (executed in a block) from "Failed" (executed but the inner tx failed).
 *
 * Usage:
 *   npx tsx tools/check-bundle-status.ts <bundleUuid> [blockEngineUrl]
 *
 * Examples:
 *   npx tsx tools/check-bundle-status.ts 8a7b2c3d-...-9f0a
 *   npx tsx tools/check-bundle-status.ts 8a7b2c3d-...-9f0a https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles
 *
 * Exit codes:
 *   0 — landed (the bundle made it on-chain, regardless of inner-tx success)
 *   1 — pending (still in flight or unscheduled)
 *   2 — invalid / failed / dropped (terminal non-success)
 *   3 — unknown UUID (Jito has no record; usually means it expired out of the cache)
 *   4 — RPC error
 *
 * For a high-throughput debug session, loop this script with `until <cond>`
 * around it rather than sleeping between calls in this tool.
 */

const DEFAULT_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: { code: number; message: string };
}

interface BundleStatus {
  bundle_id: string;
  transactions: string[];
  slot?: number;
  confirmation_status?: 'processed' | 'confirmed' | 'finalized';
  err?: { Ok: null } | { Err: unknown } | null;
}

interface BundleStatusEnvelope {
  context: { slot: number };
  value: BundleStatus[];
}

async function getBundleStatuses(endpoint: string, uuid: string): Promise<BundleStatusEnvelope> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getBundleStatuses',
      params: [[uuid]],
    }),
  });

  if (!res.ok) {
    throw new Error(`Block engine HTTP ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as JsonRpcResponse<BundleStatusEnvelope>;
  if (body.error) {
    throw new Error(`Block engine RPC error ${body.error.code}: ${body.error.message}`);
  }
  if (!body.result) {
    throw new Error(`Empty result: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.result;
}

function classify(status: BundleStatus | undefined): {
  label: string;
  color: string;
  exit: number;
  diagnosis: string;
} {
  if (!status) {
    return {
      label: 'UNKNOWN',
      color: DIM,
      exit: 3,
      diagnosis:
        'Block engine has no record of this UUID. Either the bundle never reached the engine (network/auth error before submission) or its result expired from the engine cache (typically ~5 min).',
    };
  }

  const conf = status.confirmation_status;
  const err = status.err;

  if (conf === 'finalized' || conf === 'confirmed') {
    if (err && 'Err' in err) {
      return {
        label: 'LANDED (INNER TX FAILED)',
        color: RED,
        exit: 0,
        diagnosis: `Bundle landed on-chain at slot ${status.slot ?? '?'} but the inner transaction reverted. Inspect the failed tx signature with \`solana confirm <sig>\` or via an explorer. The bundle "landed" from Jito's perspective but the operation did not succeed.`,
      };
    }
    return {
      label: 'LANDED',
      color: GREEN,
      exit: 0,
      diagnosis: `Bundle landed at slot ${status.slot ?? '?'} (${conf}). Inner txs succeeded.`,
    };
  }

  if (conf === 'processed') {
    return {
      label: 'PROCESSED (NOT YET CONFIRMED)',
      color: YELLOW,
      exit: 1,
      diagnosis: `Landed at slot ${status.slot ?? '?'} but not yet confirmed. Re-query in a few seconds.`,
    };
  }

  return {
    label: 'PENDING / DROPPED',
    color: YELLOW,
    exit: 1,
    diagnosis:
      'No slot assigned yet. Either still in the leader queue (re-query in 1–2 slots) or dropped silently. If 5+ slots have passed since submission and status is still pending, treat as dropped — re-submit with a higher tip.',
  };
}

async function main(): Promise<void> {
  const [, , uuid, endpointArg] = process.argv;
  if (!uuid) {
    console.error('Usage: npx tsx tools/check-bundle-status.ts <bundleUuid> [blockEngineUrl]');
    process.exit(4);
  }

  const endpoint = endpointArg ?? DEFAULT_BLOCK_ENGINE;
  console.log(`${BOLD}Jito bundle status${NC}`);
  console.log(`${DIM}endpoint: ${endpoint}${NC}`);
  console.log(`${DIM}uuid:     ${uuid}${NC}\n`);

  let envelope: BundleStatusEnvelope;
  try {
    envelope = await getBundleStatuses(endpoint, uuid);
  } catch (err) {
    console.error(`${RED}RPC error:${NC} ${(err as Error).message}`);
    process.exit(4);
  }

  const status = envelope.value[0];
  const { label, color, exit, diagnosis } = classify(status);

  console.log(`${BOLD}Status:${NC} ${color}${label}${NC}`);
  if (status?.slot) console.log(`${BOLD}Slot:${NC} ${status.slot}`);
  if (status?.transactions?.length) {
    console.log(`${BOLD}Transactions in bundle (${status.transactions.length}):${NC}`);
    for (const sig of status.transactions) {
      console.log(`  ${CYAN}${sig}${NC}  ${DIM}https://solscan.io/tx/${sig}${NC}`);
    }
  }
  if (status?.err) {
    console.log(`${BOLD}Inner-tx result:${NC} ${JSON.stringify(status.err)}`);
  }
  console.log(`\n${BOLD}Diagnosis:${NC} ${diagnosis}`);

  process.exit(exit);
}

void main();
