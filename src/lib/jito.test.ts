import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';

const {
  JITO_BUNDLE_URL,
  JITO_TIP_ACCOUNTS,
  randomTipAccount,
  sendBundle,
  waitForSignatures,
} = require('./jito');

type Call = { url: string; body: { method: string; params: unknown[] } };

function stubFetch(body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Jito tip accounts', () => {
  it('lists eight distinct, valid addresses', () => {
    expect(JITO_TIP_ACCOUNTS).toHaveLength(8);
    expect(new Set(JITO_TIP_ACCOUNTS).size).toBe(8);
    for (const account of JITO_TIP_ACCOUNTS as string[]) expect(new PublicKey(account).toBase58()).toBe(account);
  });

  it('only ever picks a listed account', () => {
    for (let i = 0; i < 50; i++) expect(JITO_TIP_ACCOUNTS).toContain(randomTipAccount().toBase58());
  });
});

describe('sendBundle', () => {
  it('submits the transactions base64-encoded, in order, with the encoding flag', async () => {
    const calls = stubFetch({ jsonrpc: '2.0', id: 1, result: 'bundle-id' });
    const txs = [{ base64: 'AAA=' }, { base64: 'AQE=' }];
    expect(await sendBundle(txs)).toBe('bundle-id');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(JITO_BUNDLE_URL);
    expect(calls[0]!.body.method).toBe('sendBundle');
    expect(calls[0]!.body.params).toEqual([['AAA=', 'AQE='], { encoding: 'base64' }]);
  });

  it('throws with the block engine error instead of returning undefined', async () => {
    stubFetch({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bundle contains an expired blockhash' } });
    await expect(sendBundle([{ base64: 'AAA=' }])).rejects.toThrow(/expired blockhash/);
  });
});

describe('waitForSignatures', () => {
  const quiet = () => vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  it('returns the statuses once every signature is confirmed or finalized', async () => {
    quiet();
    let poll = 0;
    const connection = {
      getSignatureStatuses: async () => {
        poll += 1;
        return { value: poll < 2 ? [null, null] : [{ confirmationStatus: 'confirmed' }, { confirmationStatus: 'finalized' }] };
      },
    };
    const statuses = await waitForSignatures(connection, ['a', 'b'], { attempts: 5, intervalMs: 0 });
    expect(statuses).toHaveLength(2);
    expect(poll).toBe(2);
  });

  it('returns a failed transaction\'s status as confirmed, leaving the err check to the caller', async () => {
    quiet();
    const failed = { confirmationStatus: 'confirmed', err: { InstructionError: [1, { Custom: 6000 }] } };
    const connection = { getSignatureStatuses: async () => ({ value: [failed] }) };
    const [status] = await waitForSignatures(connection, ['a'], { attempts: 1, intervalMs: 0 });
    expect(status.err).toEqual(failed.err);
  });

  it('returns null once the attempts run out', async () => {
    quiet();
    const connection = { getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'processed' }] }) };
    expect(await waitForSignatures(connection, ['a'], { attempts: 3, intervalMs: 0 })).toBeNull();
  });
});
