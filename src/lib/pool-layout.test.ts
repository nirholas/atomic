import { describe, expect, it } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { getPumpAmmProgram } from '@pump-fun/pump-sdk';

const {
  readPoolCreatorBucket,
} = require('./creator-fee-sweep');

// The program client is only used for its IDL; constructing it opens no connection.
const ammIdl = getPumpAmmProgram(new Connection('http://127.0.0.1:1')).idl;

type IdlField = { name: string; type: unknown };

const FIXED_SIZES: Record<string, number> = { bool: 1, u8: 1, u16: 2, u32: 4, u64: 8, i64: 8, u128: 16, i128: 16, pubkey: 32 };

/** Byte offset of every field of an IDL account struct, counting the 8-byte discriminator. */
function offsetsOf(fields: IdlField[]): Record<string, number> {
  const offsets: Record<string, number> = {};
  let at = 8;
  for (const field of fields) {
    const size = typeof field.type === 'string' ? FIXED_SIZES[field.type] : undefined;
    if (size === undefined) throw new Error(`field ${field.name} has a variable or unknown size: ${JSON.stringify(field.type)}`);
    offsets[field.name] = at;
    at += size;
  }
  offsets.__end = at;
  return offsets;
}

function structFields(idl: { types?: Array<{ name: string; type: unknown }> }, name: string): IdlField[] {
  const def = idl.types?.find((t) => t.name === name);
  const type = def?.type as { kind?: string; fields?: IdlField[] } | undefined;
  if (type?.kind !== 'struct' || !type.fields) throw new Error(`no struct ${name} in the IDL`);
  return type.fields;
}

describe('PumpSwap Pool layout, checked against the pump_amm IDL in the installed SDK', () => {
  const pool = offsetsOf(structFields(ammIdl, 'pool'));

  it('puts coin_creator and creator_fees where readPoolCreatorBucket reads them', () => {
    const coinCreator = Keypair.generate().publicKey;
    const data = Buffer.alloc(pool.__end!);
    coinCreator.toBuffer().copy(data, pool.coinCreator!);
    data.writeBigUInt64LE(123_456_789n, pool.creatorFees!);

    const bucket = readPoolCreatorBucket(data);
    expect(bucket.coinCreator.toBase58()).toBe(coinCreator.toBase58());
    expect(bucket.creatorFees).toBe(123_456_789n);
  });

  it('treats a pool that ends before creator_fees, as pre-upgrade pools do, as having nothing waiting', () => {
    const coinCreator = Keypair.generate().publicKey;
    const data = Buffer.alloc(pool.creatorFees!);
    coinCreator.toBuffer().copy(data, pool.coinCreator!);
    const bucket = readPoolCreatorBucket(data);
    expect(bucket.coinCreator.toBase58()).toBe(coinCreator.toBase58());
    expect(bucket.creatorFees).toBe(0n);
  });

  it('refuses data too short to hold coin_creator', () => {
    expect(readPoolCreatorBucket(Buffer.alloc(pool.coinCreator! - 1))).toBeNull();
  });

  it('reads a short pool whose coin_creator is cut off as the default key, never as garbage', () => {
    const bucket = readPoolCreatorBucket(Buffer.alloc(pool.coinCreator! + 16, 7));
    expect(bucket.coinCreator.equals(PublicKey.default)).toBe(true);
  });
});
