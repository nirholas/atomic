import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { PUMP_SDK, holderRewardsPda } from '@pump-fun/pump-sdk';

const {
  parseBooleanFlag,
  resolveLaunchOptions,
  assertLaunchOptionsAllowed,
  describeFeeRecipient,
  // eslint-disable-next-line @typescript-eslint/no-var-requires
} = require('./launch-options');

// Anchor discriminator of create_v2 (see docs/v2-usdc-rollout/01-discriminators.md).
const CREATE_V2_DISC = 'd6904cec5f8b31b4';

function createArgs(overrides: Record<string, unknown> = {}) {
  return {
    mint: Keypair.generate().publicKey,
    name: 'Synthetic',
    symbol: 'SYN',
    uri: 'https://example.invalid/metadata.json',
    creator: Keypair.generate().publicKey,
    user: Keypair.generate().publicKey,
    mayhemMode: false,
    ...overrides,
  };
}

describe('parsing launch flags', () => {
  it('treats unset and empty as false', () => {
    expect(parseBooleanFlag('X', undefined)).toBe(false);
    expect(parseBooleanFlag('X', '')).toBe(false);
  });

  it('accepts the usual spellings', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) expect(parseBooleanFlag('X', value)).toBe(true);
    for (const value of ['0', 'false', 'No', 'off']) expect(parseBooleanFlag('X', value)).toBe(false);
  });

  it('refuses a typo instead of guessing a launch mode', () => {
    expect(() => parseBooleanFlag('HOLDER_REWARD', 'ture')).toThrow(/HOLDER_REWARD must be true or false/);
  });
});

describe('resolving launch options', () => {
  it('defaults to a standard creator-fee launch', () => {
    expect(resolveLaunchOptions({})).toEqual({ holderReward: false });
  });

  it('turns on holder rewards from HOLDER_REWARD', () => {
    expect(resolveLaunchOptions({ HOLDER_REWARD: 'true' })).toEqual({ holderReward: true });
  });

  it('rejects cashback with a pointer to holder rewards', () => {
    expect(() => resolveLaunchOptions({ CASHBACK: 'true' })).toThrow(/6082.*HOLDER_REWARD=true/s);
  });

  it('lets an explicit CASHBACK=false through', () => {
    expect(resolveLaunchOptions({ CASHBACK: 'false' })).toEqual({ holderReward: false });
  });
});

describe('gating holder rewards on the Pump Global account', () => {
  it('refuses a holder-reward launch while the program has it disabled', () => {
    expect(() => assertLaunchOptionsAllowed({ holderReward: true }, { isHolderRewardEnabled: false }))
      .toThrow(/6084/);
  });

  it('allows it once enabled, and never gates a standard launch', () => {
    expect(() => assertLaunchOptionsAllowed({ holderReward: true }, { isHolderRewardEnabled: true })).not.toThrow();
    expect(() => assertLaunchOptionsAllowed({ holderReward: false }, { isHolderRewardEnabled: false })).not.toThrow();
  });
});

describe('describing the fee recipient', () => {
  const mint = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;

  it('names the creator for a standard launch', () => {
    expect(describeFeeRecipient({ holderReward: false }, mint, creator)).toBe(`creator ${creator.toBase58()}`);
  });

  it('names the holder rewards PDA for a holder-reward launch', () => {
    expect(describeFeeRecipient({ holderReward: true }, mint, creator)).toContain(holderRewardsPda(mint).toBase58());
  });
});

describe('@pump-fun/pump-sdk 4 create_v2 encoding', () => {
  it('encodes a cashback flag as given, so the launcher guard is what stops it', async () => {
    // pump-sdk 4 no longer throws for cashback in createV2Instruction: it
    // encodes the flag and leaves the program to reject it with 6082. The
    // CASHBACK guard in resolveLaunchOptions is therefore the only check
    // before a launch pays for a doomed bundle.
    const base = createArgs();
    const standard = await PUMP_SDK.createV2Instruction(base);
    const cashback = await PUMP_SDK.createV2Instruction({ ...base, cashback: true });
    expect(cashback.data.length).toBe(standard.data.length);
    const differing = [...cashback.data].filter((byte, i) => byte !== standard.data[i]);
    expect(differing).toEqual([1]);
    expect(() => resolveLaunchOptions({ CASHBACK: 'true' })).toThrow(/6082/);
  });

  it('encodes the holder-reward flag as the trailing create_v2 byte', async () => {
    const standard = await PUMP_SDK.createV2Instruction(createArgs());
    const holder = await PUMP_SDK.createV2Instruction(createArgs({ holderReward: true }));

    expect(standard.data.subarray(0, 8).toString('hex')).toBe(CREATE_V2_DISC);
    expect(holder.data.subarray(0, 8).toString('hex')).toBe(CREATE_V2_DISC);
    // is_holder_reward is the IDL's OptionBool, a one-bool tuple struct, so it
    // serializes as a single trailing byte.
    expect(holder.data.length).toBe(standard.data.length);
    expect(holder.data[holder.data.length - 1]).toBe(1);
    expect(standard.data[standard.data.length - 1]).toBe(0);
  });

  it('derives a distinct holder rewards PDA per mint', () => {
    const a = holderRewardsPda(Keypair.generate().publicKey);
    const b = holderRewardsPda(Keypair.generate().publicKey);
    expect(a).toBeInstanceOf(PublicKey);
    expect(a.equals(b)).toBe(false);
  });
});
