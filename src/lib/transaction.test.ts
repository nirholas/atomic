import { describe, expect, it } from 'vitest';
import { Keypair, SystemProgram, ComputeBudgetProgram, VersionedTransaction } from '@solana/web3.js';

const {
  LEGACY_TRANSACTION_SIZE_LIMIT,
  V1_TRANSACTION_SIZE_LIMIT,
  MAX_COMPUTE_UNIT_LIMIT,
  resolveTransactionVersion,
  sizeLimitFor,
  priorityFeeLamportsFromMicroLamports,
  microLamportsFromPriorityFeeLamports,
  resolvePriorityFeeLamports,
  parseComputeUnitLimit,
  withLoadedAccountsHeadroom,
  buildSignedTransaction,
  packInstructions,
  signPrebuiltTransaction,
  wireMessageVersion,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('./transaction');

const blockhash = '11111111111111111111111111111111';
const payer = Keypair.generate();
const other = Keypair.generate();

const transfer = (lamports: number) => SystemProgram.transfer({
  fromPubkey: payer.publicKey,
  toPubkey: Keypair.generate().publicKey,
  lamports,
});

const build = (overrides: Record<string, unknown> = {}, signers = [payer]) => buildSignedTransaction({
  version: 1,
  payer: payer.publicKey,
  instructions: [transfer(1)],
  blockhash,
  lastValidBlockHeight: 1,
  computeUnitLimit: 20_000,
  loadedAccountsDataSizeLimit: 128 * 1024,
  ...overrides,
}, signers);

describe('version selection', () => {
  it('defaults to v1 and accepts the documented spellings', () => {
    expect(resolveTransactionVersion(undefined)).toBe(1);
    expect(resolveTransactionVersion('')).toBe(1);
    expect(resolveTransactionVersion('v1')).toBe(1);
    expect(resolveTransactionVersion('0')).toBe(0);
    expect(resolveTransactionVersion('v0')).toBe(0);
    expect(() => resolveTransactionVersion('2')).toThrow('must be 1 or 0');
  });

  it('knows each version wire limit', () => {
    expect(sizeLimitFor(1)).toBe(V1_TRANSACTION_SIZE_LIMIT);
    expect(sizeLimitFor(0)).toBe(LEGACY_TRANSACTION_SIZE_LIMIT);
    expect(V1_TRANSACTION_SIZE_LIMIT).toBe(4096);
    expect(LEGACY_TRANSACTION_SIZE_LIMIT).toBe(1232);
  });
});

describe('priority fee conversion', () => {
  it('converts a per-CU price into the same total spend', () => {
    expect(priorityFeeLamportsFromMicroLamports(3_000_000, 300_000)).toBe(900_000n);
    // Rounds up so a sub-lamport price is never silently dropped.
    expect(priorityFeeLamportsFromMicroLamports(1, 1)).toBe(1n);
  });

  it('round-trips back to a price that still pays at least the total', () => {
    const total = priorityFeeLamportsFromMicroLamports(2_000_000, 300_000);
    const micro = microLamportsFromPriorityFeeLamports(total, 300_000);
    expect(priorityFeeLamportsFromMicroLamports(micro, 300_000)).toBeGreaterThanOrEqual(total);
    expect(microLamportsFromPriorityFeeLamports(500n, 0)).toBe(0n);
  });

  it('prefers an explicit lamport total over the legacy price', () => {
    const env = { PRIORITY_FEE_LAMPORTS: '750', PRIORITY: '3000000' };
    expect(resolvePriorityFeeLamports({ computeUnitLimit: 300_000, defaultMicroLamports: 1, env })).toBe(750n);
    expect(resolvePriorityFeeLamports({ computeUnitLimit: 300_000, defaultMicroLamports: 1_000_000, env: {} })).toBe(300_000n);
    expect(() => resolvePriorityFeeLamports({ computeUnitLimit: 1, defaultMicroLamports: 1, env: { PRIORITY: '-5' } })).toThrow('non-negative integer');
  });
});

describe('resource limits', () => {
  it('rejects a compute limit the runtime would refuse', () => {
    expect(parseComputeUnitLimit(undefined, 300_000)).toBe(300_000);
    expect(parseComputeUnitLimit('50000', 1)).toBe(50_000);
    expect(() => parseComputeUnitLimit('0', 1)).toThrow('must be an integer');
    expect(() => parseComputeUnitLimit(String(MAX_COMPUTE_UNIT_LIMIT + 1), 1)).toThrow('must be an integer');
  });

  it('pads a measured loaded-accounts size and clamps to the maximum', () => {
    expect(withLoadedAccountsHeadroom(1_000, { multiplier: 2, extraBytes: 0 })).toBe(2_000);
    expect(withLoadedAccountsHeadroom(64 * 1024 * 1024)).toBe(64 * 1024 * 1024);
  });

  it('requires both v1 limits, because an unset limit budgets zero', () => {
    expect(() => build({ computeUnitLimit: undefined })).toThrow('computeUnitLimit');
    expect(() => build({ loadedAccountsDataSizeLimit: undefined })).toThrow('loadedAccountsDataSizeLimit');
  });
});

describe('building signed transactions', () => {
  it('produces a v1 wire transaction the decoder recognizes', () => {
    const tx = build();
    expect(tx.version).toBe(1);
    expect(tx.limit).toBe(V1_TRANSACTION_SIZE_LIMIT);
    expect(tx.size).toBe(tx.bytes.length);
    expect(Buffer.from(tx.base64, 'base64').length).toBe(tx.size);
    expect(tx.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
    expect(VersionedTransaction.deserialize(tx.bytes).message.version).toBe(1);
  });

  it('produces a version 0 transaction that web3.js can deserialize', () => {
    const tx = build({ version: 0 });
    expect(tx.version).toBe(0);
    expect(tx.limit).toBe(LEGACY_TRANSACTION_SIZE_LIMIT);
    const decoded = VersionedTransaction.deserialize(tx.bytes);
    expect(decoded.message.version).toBe(0);
    expect(wireMessageVersion(decoded.message.serialize())).toBe(0);
    // v0 has no inline config, so the budget becomes ComputeBudget instructions.
    expect(decoded.message.compiledInstructions.length).toBeGreaterThan(1);
  });

  it('fits far more instructions in v1 than in v0', () => {
    const instructions = Array.from({ length: 40 }, (_, index) => transfer(index + 1));
    const forVersion = (version: number) => packInstructions(instructions, (batch: unknown[]) => build({ version, instructions: batch }));
    expect(forVersion(1).length).toBeLessThan(forVersion(0).length);
    expect(forVersion(1).flat()).toHaveLength(instructions.length);
  });

  it('refuses ComputeBudget instructions, which v1 replaces with its config', () => {
    expect(() => build({ instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }), transfer(1)] }))
      .toThrow('transaction config');
  });

  it('names the signer it is missing instead of producing an unsigned transaction', () => {
    expect(() => build({}, [other])).toThrow(`Missing signer ${payer.publicKey.toBase58()}`);
  });

  it('explains an oversized version 0 transaction instead of leaking a buffer error', () => {
    const instructions = Array.from({ length: 60 }, (_, index) => transfer(index + 1));
    expect(() => build({ version: 0, instructions })).toThrow('exceeds the version 0 limit of 1232 bytes');
    // The same instructions are well inside the v1 envelope.
    expect(build({ version: 1, instructions }).size).toBeLessThanOrEqual(4096);
  });
});

describe('signing a prebuilt transaction', () => {
  it('adds the missing signature while keeping the wire message intact', () => {
    // Two required signers: the fee payer, plus the owner of a second transfer.
    const coSigned = SystemProgram.transfer({ fromPubkey: other.publicKey, toPubkey: payer.publicKey, lamports: 5 });
    const original = build({ instructions: [transfer(1), coSigned] }, [payer, other]);
    // Re-sign as the second party, the way a service hands us a transaction it
    // already signed. Ed25519 is deterministic, so the bytes must come back
    // identical, which proves the message was not rebuilt or reordered.
    const signed = signPrebuiltTransaction(original.bytes, [other]);
    expect(signed.version).toBe(1);
    expect(signed.blockhash).toBe(blockhash);
    expect(Buffer.from(signed.bytes)).toEqual(Buffer.from(original.bytes));
  });

  it('rejects a signer the transaction never asked for', () => {
    const stranger = Keypair.generate();
    expect(() => signPrebuiltTransaction(build().bytes, [stranger]))
      .toThrow(`Signer ${stranger.publicKey.toBase58()} is not a required signer`);
  });

  it('caps the priority fee a prebuilt v1 transaction can charge us', () => {
    const tx = build({ priorityFeeLamports: 900_000n });
    expect(() => signPrebuiltTransaction(tx.bytes, [payer], { maxPriorityFeeLamports: 1_000n }))
      .toThrow(/900000 lamport priority fee/);
    expect(signPrebuiltTransaction(tx.bytes, [payer], { maxPriorityFeeLamports: 1_000_000n }).version).toBe(1);
  });
});
