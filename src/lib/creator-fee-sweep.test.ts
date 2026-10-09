import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';
import {
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  bondingCurvePda,
  canonicalPumpPoolPdaWithQuote,
  creatorVaultPda,
  pumpIdl,
} from '@pump-fun/pump-sdk';

const {
  parseMintList,
  readPoolCreatorBucket,
  readPendingCreatorFees,
  creatorFeeSweepInstructions,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('./creator-fee-sweep');

const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qJ1oDiJ8uXnACjzAm6Lb8L3xBG');
const CURVE_DISC = Buffer.from(pumpIdl.accounts.find((a) => a.name === 'BondingCurve')!.discriminator);

function u64(value: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(value);
  return b;
}

// BondingCurve in the current pump IDL field order.
function curveAccount({ creator, quoteMint = PublicKey.default, creatorFee = 0n }: { creator: PublicKey; quoteMint?: PublicKey; creatorFee?: bigint }) {
  const data = Buffer.concat([
    CURVE_DISC,
    u64(1_073_000_000_000_000n), u64(30_000_000_000n), u64(793_100_000_000_000n), u64(0n), u64(1_000_000_000_000_000n),
    Buffer.from([0]),
    creator.toBuffer(),
    Buffer.from([0, 0]),
    quoteMint.toBuffer(),
    u64(0n),
    Buffer.from([0, 0]),
    u64(creatorFee),
    u64(0n),
    Buffer.from([0]),
    u64(30_000_000_000n), u64(0n), u64(0n),
  ]);
  return { data, owner: PUMP_PROGRAM_ID, lamports: 2_000_000, executable: false };
}

// PumpSwap Pool laid out to `length` bytes with coin_creator at 211 and
// creator_fees at 279.
function poolAccount({ coinCreator, creatorFees, length = 287 }: { coinCreator: PublicKey; creatorFees: bigint; length?: number }) {
  const data = Buffer.alloc(length);
  coinCreator.toBuffer().copy(data, 211);
  if (length >= 287) data.writeBigUInt64LE(creatorFees, 279);
  return { data, owner: PUMP_AMM_PROGRAM_ID, lamports: 3_000_000, executable: false };
}

// In-memory account store answering the one RPC method the helper calls.
function accountStore(accounts: Map<string, ReturnType<typeof curveAccount> | ReturnType<typeof poolAccount>>) {
  return {
    getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map((k) => accounts.get(k.toBase58()) ?? null),
  };
}

describe('parsing MINTS', () => {
  it('splits on commas and whitespace and drops duplicates', () => {
    const a = Keypair.generate().publicKey.toBase58();
    const b = Keypair.generate().publicKey.toBase58();
    const mints = parseMintList(` ${a}, ${b}\n${a} `);
    expect(mints.map((m: PublicKey) => m.toBase58())).toEqual([a, b]);
  });

  it('treats unset as no coins and refuses a malformed address', () => {
    expect(parseMintList(undefined)).toEqual([]);
    expect(() => parseMintList('not-a-mint')).toThrow(/invalid mint address/);
  });
});

describe('reading the pool creator bucket', () => {
  it('reads coin_creator and creator_fees from an upgraded pool', () => {
    const coinCreator = Keypair.generate().publicKey;
    const bucket = readPoolCreatorBucket(poolAccount({ coinCreator, creatorFees: 123_456n }).data);
    expect(bucket.coinCreator.equals(coinCreator)).toBe(true);
    expect(bucket.creatorFees).toBe(123_456n);
  });

  it('reads a pool written before the upgrade as having nothing waiting', () => {
    const coinCreator = Keypair.generate().publicKey;
    const bucket = readPoolCreatorBucket(poolAccount({ coinCreator, creatorFees: 0n, length: 261 }).data);
    expect(bucket.coinCreator.equals(coinCreator)).toBe(true);
    expect(bucket.creatorFees).toBe(0n);
  });
});

describe('planning creator-fee sweeps', () => {
  const creator = Keypair.generate().publicKey;
  const payer = Keypair.generate().publicKey;

  it('sweeps the curve and the pool of a migrated SOL coin into the creator vaults', async () => {
    const mint = Keypair.generate().publicKey;
    const store = new Map();
    store.set(bondingCurvePda(mint).toBase58(), curveAccount({ creator, creatorFee: 5_000_000n }));
    store.set(canonicalPumpPoolPdaWithQuote(mint, NATIVE_MINT).toBase58(), poolAccount({ coinCreator: creator, creatorFees: 7_000_000n }));

    const pending = await readPendingCreatorFees({ connection: accountStore(store), creator, mints: [mint] });
    expect(pending.curveLamports).toBe(5_000_000n);
    expect(pending.poolLamports).toBe(7_000_000n);
    expect(pending.skipped).toEqual([]);

    const ixs = await creatorFeeSweepInstructions({ payer, creator, coins: pending.coins });
    expect(ixs).toHaveLength(2);
    expect(ixs[0].programId.equals(PUMP_PROGRAM_ID)).toBe(true);
    expect(ixs[0].keys.some((k: { pubkey: PublicKey }) => k.pubkey.equals(creatorVaultPda(creator)))).toBe(true);
    expect(ixs[1].programId.equals(PUMP_AMM_PROGRAM_ID)).toBe(true);
    expect(ixs[0].keys[0].pubkey.equals(payer)).toBe(true);
  });

  it('adds nothing when no fee is waiting', async () => {
    const mint = Keypair.generate().publicKey;
    const store = new Map();
    store.set(bondingCurvePda(mint).toBase58(), curveAccount({ creator }));
    const pending = await readPendingCreatorFees({ connection: accountStore(store), creator, mints: [mint] });
    expect(await creatorFeeSweepInstructions({ payer, creator, coins: pending.coins })).toEqual([]);
  });

  it('skips coins it cannot collect, saying why', async () => {
    const missing = Keypair.generate().publicKey;
    const usdcCoin = Keypair.generate().publicKey;
    const otherCreators = Keypair.generate().publicKey;
    const movedPool = Keypair.generate().publicKey;
    const store = new Map();
    store.set(bondingCurvePda(usdcCoin).toBase58(), curveAccount({ creator, quoteMint: USDC, creatorFee: 1n }));
    store.set(bondingCurvePda(otherCreators).toBase58(), curveAccount({ creator: Keypair.generate().publicKey, creatorFee: 1n }));
    store.set(bondingCurvePda(movedPool).toBase58(), curveAccount({ creator }));
    store.set(canonicalPumpPoolPdaWithQuote(movedPool, NATIVE_MINT).toBase58(), poolAccount({ coinCreator: Keypair.generate().publicKey, creatorFees: 9n }));

    const pending = await readPendingCreatorFees({
      connection: accountStore(store),
      creator,
      mints: [missing, usdcCoin, otherCreators, movedPool],
    });
    const reasons = pending.skipped.map((s: { reason: string }) => s.reason);
    expect(reasons[0]).toMatch(/no pump.fun bonding curve/);
    expect(reasons[1]).toMatch(/SOL fees only/);
    expect(reasons[2]).toMatch(/not this wallet/);
    expect(reasons[3]).toMatch(/pool fees belong to coin creator/);
    expect(pending.curveLamports).toBe(0n);
    expect(pending.poolLamports).toBe(0n);
    expect(await creatorFeeSweepInstructions({ payer, creator, coins: pending.coins })).toEqual([]);
  });
});
