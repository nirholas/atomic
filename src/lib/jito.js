// Jito Block Engine helpers shared by every bundle script.
//
// Bundles are submitted base64-encoded. Base58 is deprecated by the Block
// Engine and does not scale to 4096-byte version 1 transactions.

const { PublicKey } = require('@solana/web3.js');

const JITO_BUNDLE_URL = process.env.JITO_BUNDLE_URL || 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

// Current Jito tip accounts. Refresh with `npx tsx tools/check-tip-accounts.ts`
// if you hit "Bundles must write lock at least one tip account".
const JITO_TIP_ACCOUNTS = [
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
];

function randomTipAccount() {
  return new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
}

// txs: results of buildSignedTransaction / signPrebuiltTransaction, in bundle order.
async function sendBundle(txs, url = JITO_BUNDLE_URL) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [txs.map(tx => tx.base64), { encoding: 'base64' }],
    }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`Bundle submit failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

// Polls until every signature reaches `confirmed` (or `finalized`), or the
// attempts run out. Returns the statuses on success, null on timeout.
async function waitForSignatures(connection, signatures, { attempts = 30, intervalMs = 2000, label = signatures.map((_, i) => `tx${i + 1}`) } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    const { value } = await connection.getSignatureStatuses(signatures);
    process.stderr.write(`\r  poll ${i}: ${value.map((s, j) => `${label[j]}=${s?.confirmationStatus || '...'}`).join(' ')}    `);
    const done = value.every(s => s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized');
    if (done) {
      process.stderr.write('\n');
      return value;
    }
  }
  process.stderr.write('\n');
  return null;
}

module.exports = {
  JITO_BUNDLE_URL,
  JITO_TIP_ACCOUNTS,
  randomTipAccount,
  sendBundle,
  waitForSignatures,
};
