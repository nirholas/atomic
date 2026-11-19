import { describe, expect, it } from 'vitest';
import { redactRpcUrl } from './redact.js';

describe('redactRpcUrl', () => {
  it('keeps a key-free endpoint readable', () => {
    expect(redactRpcUrl('https://api.mainnet-beta.solana.com')).toBe('https://api.mainnet-beta.solana.com');
    expect(redactRpcUrl('http://127.0.0.1:8899/')).toBe('http://127.0.0.1:8899');
  });

  it('hides keys in the query, the path and userinfo', () => {
    const cases = [
      'https://mainnet.helius-rpc.com/?api-key=SECRET',
      'https://name.solana-mainnet.quiknode.pro/SECRET/',
      'https://solana-mainnet.g.alchemy.com/v2/SECRET',
      'https://user:SECRET@rpc.example.com',
    ];
    for (const raw of cases) {
      const shown = redactRpcUrl(raw);
      expect(shown).not.toContain('SECRET');
      expect(shown.endsWith('/…')).toBe(true);
    }
  });

  it('never echoes a value it cannot parse', () => {
    expect(redactRpcUrl('not a url SECRET')).toBe('<unparseable RPC URL>');
  });
});
