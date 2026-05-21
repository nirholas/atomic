# grind.js

Multi-threaded vanity-address grinder. Generates Ed25519 keypairs in parallel worker threads until one produces a base58 address starting with a given prefix, then writes the secret key to `funder.json` and the public address to `funder.pub`.

- **Source:** [`src/grind.js`](../../src/grind.js)
- **npm alias:** `npm run grind`

## When to use this

Honestly: **rarely**. `solana-keygen grind` (part of the Solana CLI) is dramatically faster (native code, not Node). This script is here as a self-contained, no-CLI-dependency reference implementation — useful in environments where you only have Node available, or as a starting point for grinding *constrained* keys (e.g. matching a specific bonding-curve PDA prefix).

For everyday vanity addresses, prefer:

```bash
solana-keygen grind --starts-with usdc:1 --num-threads $(nproc)
```

## Configuration

`grind.js` is **not env-driven**. Edit the constants at the top of [`src/grind.js`](../../src/grind.js) before running:

| Constant | What to set |
|---|---|
| `PREFIX` | The base58 string the public key must start with. Default: `'usdc'`. |
| `OUT_DIR` | Directory the resulting `funder.json` + `funder.pub` are written to. Default: directory of the script. |

If you want to grind for a different role (e.g. `creator.json`), edit the file paths in the script's `'found'` handler.

## What it does

```
main thread:
  spawns one worker per CPU core, all running this file's worker body
  prints rolling stats (rate, total tried, elapsed) on stdout
  on first 'found' message:
    writes funder.json (raw byte array) + funder.pub (base58 address)
    terminates all workers and exits 0

each worker:
  loop forever:
    generate a random 32-byte seed
    derive ed25519 keypair (tweetnacl)
    if base58(pubkey).startsWith(PREFIX):
      send 'found' to main thread
    every 10,000 tries, send 'stats' to main thread
```

## Example

```bash
# Edit PREFIX in src/grind.js first if you don't want "usdc"
npm run grind
```

Output:

```
Grinding prefix="usdc" on 8 workers
Expected attempts: ~11,316,496
49231/s | 152,000 tried | 3s elapsed
…
FOUND in 41.2s: usdcZpQRk4…
Saved keypair to: /…/src/funder.json
```

## Time-to-find expectations

For a base58 alphabet of 58 characters, expected attempts is `58^N` for an N-character prefix:

| Prefix length | Expected attempts | Approx time on 8 cores at 50k/s |
|---|---|---|
| 2 chars | 3,364 | < 1 s |
| 3 chars | ~195k | ~4 s |
| 4 chars | ~11.3M | ~3 min |
| 5 chars | ~656M | ~3 hours |
| 6 chars | ~38B | ~9 days |
| 7 chars | ~2.2T | ~520 days |

Add roughly one zero per character. For >5 chars use `solana-keygen grind` (native, ~5–10× faster) or specialized GPU grinders.

## Notes

- **Always uses CPU cores from `os.cpus().length`.** Doesn't accept a `--threads` arg. On a 32-core box, that's 32 workers — fine for grinding, but if you want to limit it, edit the script.
- **Writes plain JSON byte arrays** — same format as `solana-keygen new`. You can import the resulting `funder.json` directly with the Solana CLI (`solana config set --keypair funder.json`).
- **Doesn't check whether the address is "good" beyond prefix match.** No checks for vanity middle/end, no checks for visual ambiguity (e.g. `0`/`O`, `l`/`I` — base58 already excludes those, so not an issue).
- **Single hit, single output file.** If you want N matching keys, run the script N times. Or replace the immediate exit on `'found'` with appending to a JSONL file and letting workers keep running.
- **No PBKDF2 / BIP-39 seed phrase.** The grinder uses raw `crypto.randomBytes(32)` for the seed — these are *not* mnemonic-compatible keypairs. If you want a 12/24-word seed, use `solana-keygen new` with `--word-count`.
