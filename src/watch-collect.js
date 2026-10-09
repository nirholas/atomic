// Continuous watcher: polls creator vault every POLL_MS, fires collect-jito.js
// when accumulated balance exceeds MIN_COLLECT_SOL. Retries on Jito errors.
// With MINTS set, the creator fees still waiting on those coins' curves count
// toward the threshold too (collect-jito.js sweeps them before collecting).
//
// Env:
//   CREATOR_PUBKEY    — base58 pubkey of the coin creator (whose vault to watch)
//   DESTINATION       — where collected SOL ultimately lands (forwarded to collect-jito.js)
//   FUNDER_SECRET     — funder secret (forwarded to collect-jito.js for tip + fees)
//   CREATOR_SECRET    — creator secret (forwarded to collect-jito.js for signing)
//   MINTS             : the creator's mints (forwarded to collect-jito.js, which
//                       sweeps their waiting fees; MINT also works)
//   POLL_MS           — default 30000
//   MIN_COLLECT_SOL   — default 0.05

const { spawn } = require('child_process');
const path = require('path');
const { Connection, PublicKey } = require('@solana/web3.js');
const { OnlinePumpSdk } = require('@pump-fun/pump-sdk');
const { parseMintList, readPendingCreatorFees } = require('./lib/creator-fee-sweep');

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const POLL_MS = parseInt(process.env.POLL_MS || '30000', 10);
const MIN_COLLECT_SOL = parseFloat(process.env.MIN_COLLECT_SOL || '0.05');

if (!process.env.CREATOR_PUBKEY) {
  console.error('Missing CREATOR_PUBKEY env var');
  process.exit(1);
}
const CREATOR_PUBKEY = new PublicKey(process.env.CREATOR_PUBKEY);
const MINTS = parseMintList(process.env.MINTS || process.env.MINT);

const c = new Connection(RPC_URL, 'confirmed');
const sdk = new OnlinePumpSdk(c);

function runCollectOnce() {
  return new Promise((resolve) => {
    const env = { ...process.env, BUFFER_LAMPORTS: '890880' };
    const child = spawn(process.execPath, [path.join(__dirname, 'collect-jito.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', code => resolve({ code, out, err }));
  });
}

let totalRuns = 0;
let totalSuccessful = 0;

(async () => {
  console.log('Watcher started.');
  console.log('  creator:    ', CREATOR_PUBKEY.toBase58());
  console.log('  poll every: ', POLL_MS / 1000, 's');
  console.log('  threshold:  ', MIN_COLLECT_SOL, 'SOL');
  console.log('  destination:', process.env.DESTINATION);
  console.log('  coins:      ', MINTS.length > 0 ? MINTS.map((m) => m.toBase58()).join(', ') : '(MINTS not set: waiting curve fees are not counted or swept)');
  console.log('');

  while (true) {
    try {
      const vault = await sdk.getCreatorVaultBalance(CREATOR_PUBKEY);
      const pending = await readPendingCreatorFees({ connection: c, creator: CREATOR_PUBKEY, mints: MINTS });
      const sol = (Number(vault) + Number(pending.curveLamports)) / 1e9;
      const ts = new Date().toISOString().slice(11, 19);

      if (sol >= MIN_COLLECT_SOL) {
        console.log(`[${ts}] vault=${sol.toFixed(4)} SOL >= ${MIN_COLLECT_SOL} — firing collect...`);
        totalRuns++;
        const { code, out, err } = await runCollectOnce();
        const lastLines = (out + err).split('\n').filter(l => l.includes('Destination balance:') || l.includes('CONFIRMED') || l.includes('Bundle submit failed') || l.includes('error')).slice(-3);
        if (code === 0) {
          totalSuccessful++;
          console.log(`[${ts}] success #${totalSuccessful}/${totalRuns}: ${lastLines.find(l => l.includes('Destination balance:')) || 'confirmed'}`);
        } else {
          console.log(`[${ts}] FAILED (code ${code}). Will retry next tick. tail:`);
          for (const l of lastLines) console.log('   ', l);
        }
      } else {
        process.stderr.write(`\r[${ts}] vault=${sol.toFixed(4)} SOL (< ${MIN_COLLECT_SOL})  collects=${totalSuccessful}/${totalRuns}     `);
      }
    } catch (e) {
      console.error(`\n[${new Date().toISOString()}] poll error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
})();
