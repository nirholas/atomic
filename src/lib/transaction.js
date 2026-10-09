// Version-aware transaction builder shared by every script that signs.
//
// Solana transaction v1 (SIMD-0385) replaces compute-budget instructions with an
// inline resource config, prices priority as a TOTAL lamport fee instead of a
// per-compute-unit price, and raises the wire limit from 1232 to 4096 bytes.
// It has no address lookup tables.
//
// Two v1 rules that bite if ignored:
//   - An unset compute unit limit budgets ZERO compute units. The tx fails.
//   - An unset loaded-accounts-data limit budgets ZERO bytes. Every tx loads at
//     least its fee payer, so the tx fails.
// buildSignedTransaction therefore requires computeUnitLimit and resolves
// loadedAccountsDataSizeLimit before compiling.
//
// @pump-fun/pump-sdk and @solana/spl-token emit @solana/web3.js 1.x
// TransactionInstructions. web3.js 1.99 can read v1 but not serialize it, so
// v1 messages are compiled and encoded with @solana/kit. Version 0 stays
// available as an operational fallback: TRANSACTION_VERSION=0.

const nacl = require('tweetnacl');
const bs58mod = require('bs58');
const bs58encode = bs58mod.default ? bs58mod.default.encode : bs58mod.encode;
const kit = require('@solana/kit');
const {
  ComputeBudgetProgram, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction, VersionedMessage,
} = require('@solana/web3.js');

const LEGACY_TRANSACTION_SIZE_LIMIT = 1232;
const V1_TRANSACTION_SIZE_LIMIT = 4096;
const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const MAX_LOADED_ACCOUNTS_DATA_SIZE = 64 * 1024 * 1024;
// The runtime charges every loaded account this many bytes on top of its data.
const ACCOUNT_BASE_SIZE = 64;
const BPF_LOADER_UPGRADEABLE = 'BPFLoaderUpgradeab1e11111111111111111111111';
const COMPUTE_BUDGET_PROGRAM = ComputeBudgetProgram.programId.toBase58();
const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;

function resolveTransactionVersion(raw = process.env.TRANSACTION_VERSION) {
  if (raw === undefined || raw === '' || raw === '1' || raw === 'v1') return 1;
  if (raw === '0' || raw === 'v0') return 0;
  throw new Error(`TRANSACTION_VERSION must be 1 or 0, got "${raw}"`);
}

function sizeLimitFor(version) {
  return version === 1 ? V1_TRANSACTION_SIZE_LIMIT : LEGACY_TRANSACTION_SIZE_LIMIT;
}

// Converts a legacy per-CU price into the total lamports it would have cost at
// a given limit, so existing PRIORITY settings keep the same spend under v1.
function priorityFeeLamportsFromMicroLamports(microLamportsPerCu, computeUnitLimit) {
  const product = BigInt(microLamportsPerCu) * BigInt(computeUnitLimit);
  return (product + MICRO_LAMPORTS_PER_LAMPORT - 1n) / MICRO_LAMPORTS_PER_LAMPORT;
}

// Inverse of the above for the v0 fallback: the smallest per-CU price whose
// total at computeUnitLimit is at least priorityFeeLamports.
function microLamportsFromPriorityFeeLamports(priorityFeeLamports, computeUnitLimit) {
  if (computeUnitLimit <= 0) return 0n;
  const product = BigInt(priorityFeeLamports) * MICRO_LAMPORTS_PER_LAMPORT;
  const limit = BigInt(computeUnitLimit);
  return (product + limit - 1n) / limit;
}

// Resolves the priority fee for a script: PRIORITY_FEE_LAMPORTS (total) wins,
// then the legacy PRIORITY microlamport price converted at the tx's CU limit.
function resolvePriorityFeeLamports({ computeUnitLimit, defaultMicroLamports, env = process.env }) {
  if (env.PRIORITY_FEE_LAMPORTS !== undefined && env.PRIORITY_FEE_LAMPORTS !== '') {
    return parseNonNegativeBigInt(env.PRIORITY_FEE_LAMPORTS, 'PRIORITY_FEE_LAMPORTS');
  }
  const micro = env.PRIORITY !== undefined && env.PRIORITY !== ''
    ? parseNonNegativeBigInt(env.PRIORITY, 'PRIORITY')
    : BigInt(defaultMicroLamports);
  return priorityFeeLamportsFromMicroLamports(micro, computeUnitLimit);
}

function parseNonNegativeBigInt(raw, name) {
  if (!/^\d+$/.test(String(raw).trim())) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return BigInt(String(raw).trim());
}

function parseComputeUnitLimit(raw, fallback, name = 'CU_LIMIT') {
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  assertComputeUnitLimit(value, name);
  return value;
}

function assertComputeUnitLimit(value, name = 'computeUnitLimit') {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_COMPUTE_UNIT_LIMIT) {
    throw new Error(`${name} must be an integer in 1..${MAX_COMPUTE_UNIT_LIMIT}, got ${value}`);
  }
}

function assertLoadedAccountsDataSizeLimit(value) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_LOADED_ACCOUNTS_DATA_SIZE) {
    throw new Error(`loadedAccountsDataSizeLimit must be an integer in 1..${MAX_LOADED_ACCOUNTS_DATA_SIZE}, got ${value}`);
  }
}

function accountRole({ isSigner, isWritable }) {
  if (isSigner) return isWritable ? kit.AccountRole.WRITABLE_SIGNER : kit.AccountRole.READONLY_SIGNER;
  return isWritable ? kit.AccountRole.WRITABLE : kit.AccountRole.READONLY;
}

function toKitInstruction(ix) {
  return {
    programAddress: kit.address(ix.programId.toBase58()),
    accounts: ix.keys.map(key => ({ address: kit.address(key.pubkey.toBase58()), role: accountRole(key) })),
    data: Uint8Array.from(ix.data),
  };
}

function assertNoComputeBudgetInstructions(instructions) {
  const found = instructions.find(ix => ix.programId.toBase58() === COMPUTE_BUDGET_PROGRAM);
  if (found) {
    throw new Error('Pass compute limits and priority fees through the transaction config, not ComputeBudget instructions');
  }
}

function setLoadedAccountsDataSizeLimitInstruction(bytes) {
  const data = Buffer.alloc(5);
  data.writeUInt8(4, 0);
  data.writeUInt32LE(bytes, 1);
  return new TransactionInstruction({ programId: ComputeBudgetProgram.programId, keys: [], data });
}

// Every account a transaction names, fee payer first, deduplicated.
function transactionAccountKeys(payer, instructions) {
  const keys = new Map([[payer.toBase58(), payer]]);
  for (const ix of instructions) {
    keys.set(ix.programId.toBase58(), ix.programId);
    for (const { pubkey } of ix.keys) keys.set(pubkey.toBase58(), pubkey);
  }
  return [...keys.values()];
}

// Measures what the runtime will load: each named account's data plus the
// per-account base, plus the programdata account behind every upgradeable
// program. Accounts the tx creates count as empty, matching the pre-execution
// load. Callers add headroom through estimateLoadedAccountsDataSizeLimit.
async function measureLoadedAccountsDataSize(connection, payer, instructions) {
  const keys = transactionAccountKeys(payer, instructions);
  const infos = await getAccountSizes(connection, keys);
  let total = 0;
  const programDataKeys = [];
  infos.forEach(info => {
    total += ACCOUNT_BASE_SIZE + (info ? info.space : 0);
    if (info && info.executable && info.owner === BPF_LOADER_UPGRADEABLE && info.head.length >= 36) {
      programDataKeys.push(new PublicKey(info.head.subarray(4, 36)));
    }
  });
  if (programDataKeys.length) {
    const programData = await getAccountSizes(connection, programDataKeys);
    programData.forEach(info => { total += ACCOUNT_BASE_SIZE + (info ? info.space : 0); });
  }
  return total;
}

// Account sizes via getMultipleAccounts with a 36-byte data slice: `space`
// carries the full size, and the slice is enough to read an upgradeable
// program's programdata address. Avoids downloading megabytes of program code.
async function getAccountSizes(connection, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100).map(k => k.toBase58());
    const result = await rpcRequest(connection, 'getMultipleAccounts', [
      chunk,
      { encoding: 'base64', dataSlice: { offset: 0, length: 36 }, commitment: 'confirmed' },
    ]);
    for (const account of result.value) {
      out.push(account && {
        space: account.space,
        executable: account.executable,
        owner: account.owner,
        head: Buffer.from(account.data[0], 'base64'),
      });
    }
  }
  return out;
}

// Adds headroom for accounts that grow during execution (new ATAs, bonding
// curve init), then clamps to the runtime maximum.
function withLoadedAccountsHeadroom(measuredBytes, { multiplier = 1.25, extraBytes = 64 * 1024 } = {}) {
  const padded = Math.ceil(measuredBytes * multiplier) + extraBytes;
  return Math.min(padded, MAX_LOADED_ACCOUNTS_DATA_SIZE);
}

// LOADED_ACCOUNTS_DATA_LIMIT pins the value; otherwise it is measured from chain.
async function estimateLoadedAccountsDataSizeLimit(connection, payer, instructions, env = process.env) {
  if (env.LOADED_ACCOUNTS_DATA_LIMIT !== undefined && env.LOADED_ACCOUNTS_DATA_LIMIT !== '') {
    const pinned = Number(env.LOADED_ACCOUNTS_DATA_LIMIT);
    assertLoadedAccountsDataSizeLimit(pinned);
    return pinned;
  }
  return withLoadedAccountsHeadroom(await measureLoadedAccountsDataSize(connection, payer, instructions));
}

function signWithKeypairs(messageBytes, requiredSigners, signers) {
  const byAddress = new Map(signers.map(kp => [kp.publicKey.toBase58(), kp]));
  const signatures = {};
  for (const addr of requiredSigners) {
    const kp = byAddress.get(addr);
    if (!kp) throw new Error(`Missing signer ${addr}`);
    signatures[addr] = nacl.sign.detached(messageBytes, kp.secretKey);
  }
  return signatures;
}

function finalize(bytes, version, signature) {
  const limit = sizeLimitFor(version);
  if (bytes.length > limit) {
    throw new Error(`Transaction is ${bytes.length} bytes; version ${version} limit is ${limit}`);
  }
  return {
    version,
    bytes,
    base64: Buffer.from(bytes).toString('base64'),
    signature,
    size: bytes.length,
    limit,
  };
}

function buildV1({ payer, instructions, blockhash, lastValidBlockHeight, computeUnitLimit, loadedAccountsDataSizeLimit, priorityFeeLamports, heapSize }, signers) {
  assertNoComputeBudgetInstructions(instructions);
  let message = kit.createTransactionMessage({ version: 1 });
  message = kit.setTransactionMessageFeePayer(kit.address(payer.toBase58()), message);
  message = kit.setTransactionMessageLifetimeUsingBlockhash(
    { blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight ?? 0) },
    message,
  );
  message = kit.appendTransactionMessageInstructions(instructions.map(toKitInstruction), message);
  message = kit.setTransactionMessageConfig({
    computeUnitLimit,
    loadedAccountsDataSizeLimit,
    priorityFeeLamports: priorityFeeLamports > 0n ? priorityFeeLamports : undefined,
    heapSize,
  }, message);

  const compiled = kit.compileTransaction(message);
  const signatures = signWithKeypairs(compiled.messageBytes, Object.keys(compiled.signatures), signers);
  const bytes = new Uint8Array(kit.getTransactionEncoder().encode({ ...compiled, signatures }));
  return finalize(bytes, 1, bs58encode(signatures[payer.toBase58()]));
}

function buildV0({ payer, instructions, blockhash, computeUnitLimit, loadedAccountsDataSizeLimit, priorityFeeLamports, heapSize }, signers) {
  assertNoComputeBudgetInstructions(instructions);
  const budget = [ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })];
  const microLamports = microLamportsFromPriorityFeeLamports(priorityFeeLamports, computeUnitLimit);
  if (microLamports > 0n) budget.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  if (loadedAccountsDataSizeLimit !== undefined) budget.push(setLoadedAccountsDataSizeLimitInstruction(loadedAccountsDataSizeLimit));
  if (heapSize !== undefined) budget.push(ComputeBudgetProgram.requestHeapFrame({ bytes: heapSize }));

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...budget, ...instructions],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const required = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(k => k.toBase58());
  const byAddress = new Map(signers.map(kp => [kp.publicKey.toBase58(), kp]));
  const missing = required.filter(addr => !byAddress.has(addr));
  if (missing.length) throw new Error(`Missing signer ${missing[0]}`);
  let bytes;
  try {
    tx.sign(required.map(addr => byAddress.get(addr)));
    bytes = tx.serialize();
  } catch (e) {
    // web3.js serializes into a fixed 1232-byte buffer and reports an overflow
    // as "encoding overruns Uint8Array", which says nothing about the cause.
    if (!/overruns/.test(e.message)) throw e;
    throw new Error(`Transaction exceeds the version 0 limit of ${LEGACY_TRANSACTION_SIZE_LIMIT} bytes; use version 1 or fewer instructions`);
  }
  return finalize(bytes, 0, bs58encode(tx.signatures[0]));
}

// Builds and signs a transaction from web3.js 1.x instructions.
//
// opts.version                      1 (default via TRANSACTION_VERSION) or 0
// opts.payer                        PublicKey of the fee payer (must be in signers)
// opts.instructions                 TransactionInstruction[] with NO ComputeBudget ixs
// opts.blockhash, lastValidBlockHeight
// opts.computeUnitLimit             required, 1..1,400,000
// opts.loadedAccountsDataSizeLimit  required for v1 (see estimateLoadedAccountsDataSizeLimit)
// opts.priorityFeeLamports          total priority fee as bigint (default 0n)
// opts.heapSize                     optional heap frame request in bytes
//
// Returns { version, bytes, base64, signature, size, limit }.
function buildSignedTransaction(opts, signers) {
  const version = opts.version ?? resolveTransactionVersion();
  assertComputeUnitLimit(opts.computeUnitLimit);
  if (version === 1 || opts.loadedAccountsDataSizeLimit !== undefined) {
    assertLoadedAccountsDataSizeLimit(opts.loadedAccountsDataSizeLimit);
  }
  const normalized = { ...opts, priorityFeeLamports: BigInt(opts.priorityFeeLamports ?? 0n) };
  return version === 1 ? buildV1(normalized, signers) : buildV0(normalized, signers);
}

// Largest prefix of `instructions` (in order) that fits one transaction by
// size, tested by compiling with a placeholder blockhash and the real signers.
// Used to pack batched transfers: v1 fits several times more per tx than v0.
function packInstructions(instructions, buildFor) {
  const batches = [];
  let start = 0;
  while (start < instructions.length) {
    let end = start + 1;
    buildFor(instructions.slice(start, end));
    while (end < instructions.length) {
      try {
        buildFor(instructions.slice(start, end + 1));
        end += 1;
      } catch (e) {
        if (!/limit is \d+/.test(e.message)) throw e;
        break;
      }
    }
    batches.push(instructions.slice(start, end));
    start = end;
  }
  return batches;
}

async function rpcRequest(connection, method, params) {
  const res = await fetch(connection.rpcEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

// simulateTransaction over raw bytes, so v1 works without web3.js serializing it.
async function simulateSignedTransaction(connection, tx, { sigVerify = false, commitment = 'confirmed' } = {}) {
  const result = await rpcRequest(connection, 'simulateTransaction', [
    tx.base64,
    { encoding: 'base64', sigVerify, replaceRecentBlockhash: false, commitment },
  ]);
  return result.value;
}

async function sendSignedTransaction(connection, tx, { skipPreflight = false, maxRetries = 5 } = {}) {
  return connection.sendRawTransaction(tx.bytes, { skipPreflight, maxRetries, preflightCommitment: 'confirmed' });
}

// Detects the version of a pre-built wire transaction (e.g. Jupiter's
// swapTransaction), signs it for `signers`, and returns the same shape as
// buildSignedTransaction. Other required signatures already present are kept.
function signPrebuiltTransaction(wireBytes, signers, { maxPriorityFeeLamports } = {}) {
  const decoded = kit.getTransactionDecoder().decode(Uint8Array.from(wireBytes));
  const message = kit.getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
  const version = message.version === 'legacy' ? 'legacy' : message.version;

  if (version === 1 && maxPriorityFeeLamports !== undefined) {
    const fee = kit.decompileTransactionMessage(message).config?.priorityFeeLamports;
    if (fee !== undefined && BigInt(fee) > BigInt(maxPriorityFeeLamports)) {
      throw new Error(`Prebuilt v1 transaction asks for a ${fee} lamport priority fee; cap is ${maxPriorityFeeLamports}`);
    }
  }

  const required = Object.keys(decoded.signatures);
  const ours = signers.filter(kp => required.includes(kp.publicKey.toBase58()));
  if (ours.length !== signers.length) {
    const stray = signers.find(kp => !required.includes(kp.publicKey.toBase58()));
    throw new Error(`Signer ${stray.publicKey.toBase58()} is not a required signer of the prebuilt transaction`);
  }
  const signatures = { ...decoded.signatures };
  for (const kp of ours) signatures[kp.publicKey.toBase58()] = nacl.sign.detached(decoded.messageBytes, kp.secretKey);

  const bytes = new Uint8Array(kit.getTransactionEncoder().encode({ ...decoded, signatures }));
  const feePayer = required[0];
  const limit = sizeLimitFor(version === 1 ? 1 : 0);
  if (bytes.length > limit) throw new Error(`Prebuilt transaction is ${bytes.length} bytes; limit is ${limit}`);
  return {
    version,
    bytes,
    base64: Buffer.from(bytes).toString('base64'),
    signature: signatures[feePayer] ? bs58encode(signatures[feePayer]) : null,
    size: bytes.length,
    limit,
    blockhash: message.lifetimeToken,
  };
}

// Reads the version byte without a full decode (web3.js 1.x reads legacy, 0, 1).
function wireMessageVersion(messageBytes) {
  return VersionedMessage.deserializeMessageVersion(messageBytes);
}

module.exports = {
  LEGACY_TRANSACTION_SIZE_LIMIT,
  V1_TRANSACTION_SIZE_LIMIT,
  MAX_COMPUTE_UNIT_LIMIT,
  MAX_LOADED_ACCOUNTS_DATA_SIZE,
  resolveTransactionVersion,
  sizeLimitFor,
  priorityFeeLamportsFromMicroLamports,
  microLamportsFromPriorityFeeLamports,
  resolvePriorityFeeLamports,
  parseComputeUnitLimit,
  measureLoadedAccountsDataSize,
  withLoadedAccountsHeadroom,
  estimateLoadedAccountsDataSizeLimit,
  buildSignedTransaction,
  packInstructions,
  simulateSignedTransaction,
  sendSignedTransaction,
  signPrebuiltTransaction,
  wireMessageVersion,
  toKitInstruction,
};
