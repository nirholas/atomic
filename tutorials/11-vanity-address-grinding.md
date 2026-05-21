# 11 — Vanity address grinding

You want a Solana address that starts with a specific prefix — `pump`, your project name, a custom 4–6 char string — for branding or for making creator/destination wallets easier to recognize at a glance.

This tutorial covers two options: the toolkit's `grind.js` (pure JS) and `solana-keygen grind` (native). **Use `solana-keygen grind` for anything beyond a 3-character prefix.** The JS version is included for completeness but is dramatically slower.

## How vanity grinding works

There's no clever trick — you generate random keypairs in a loop, check if the resulting pubkey (base58-encoded) matches the prefix you want, and stop when one does. Solana pubkeys are base58 of a 32-byte ed25519 public key; characters available in base58 are `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz` (no `0`, `O`, `I`, `l`).

Search space:

| Prefix length | Expected attempts (mean) | Time on a modern laptop (~10k keys/sec native, ~500/sec JS) |
|---|---|---|
| 3 chars | 58³ ≈ 200,000 | <1 min native, ~7 min JS |
| 4 chars | 58⁴ ≈ 11M | ~20 min native, ~6 hrs JS |
| 5 chars | 58⁵ ≈ 656M | ~18 hrs native, ~weeks JS |
| 6 chars | 58⁶ ≈ 38B | ~44 days native, never feasible JS |
| 7+ chars | — | rent a GPU rig |

These are means. The actual time varies by ~3× either direction depending on luck. Plan for the worst case.

## Option A — solana-keygen grind (recommended)

The Solana CLI ships a native grinder that's far faster than anything in JS.

### Install Solana CLI (if not already)

```bash
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

Or check existing: `solana --version`. Anything 1.16+ has `grind`.

### Grind for a prefix

```bash
solana-keygen grind --starts-with pump:1
```

Format: `<prefix>:<count>`. Generates 1 keypair whose pubkey starts with `pump`. The keypair is saved as `<pubkey>.json` in the current directory.

For multiple prefixes searched in parallel:

```bash
solana-keygen grind --starts-with pump:1 --starts-with cool:1
```

### Grind for a suffix instead

```bash
solana-keygen grind --ends-with .sol:1
```

(Solana addresses don't actually have `.sol`, but you can grind for any literal ending.)

### Useful flags

| Flag | Purpose |
|---|---|
| `--num-threads N` | Use N CPU threads. Default is "all available". Lower if grinding while doing other work |
| `--ignore-case` | Case-insensitive match. Roughly halves the expected time per char |
| `--starts-and-ends-with prefix:suffix:1` | Match both ends |

### Verify the result

The grinder writes `<pubkey>.json` — that's a Solana CLI keypair file. Confirm:

```bash
solana-keygen pubkey <pubkey>.json
# Should print the matching pubkey, starting with your prefix
```

Use this file as `FUNDER_KEYPAIR` or `CREATOR_KEYPAIR` directly:

```bash
FUNDER_KEYPAIR=./pump6xQwer....json \
CREATOR_KEYPAIR=./MyCoin8yz....json \
URI="..." NAME=MyCoin SYMBOL=MEME \
  npm run launch
```

## Option B — `grind.js` (toolkit-included, JS)

The toolkit includes `src/grind.js` (run via `npm run grind`) for environments where you can't install the Solana CLI. It's much slower (no native ed25519, no SIMD) — only use it for short prefixes.

```bash
# All commands run from the repo root

PREFIX=cool \
  npm run grind
```

Output:

```
Searching for pubkey starting with "cool"...
Tried 10,000 keys (avg 480/sec)
Tried 20,000 keys (avg 482/sec)
...
Found: cool9xQwerty1234... after 142,857 attempts
Saved to: cool9xQwerty1234.json
```

### Env vars

| Var | Purpose |
|---|---|
| `PREFIX` | The prefix to grind for. Required |
| `CASE_INSENSITIVE` | Set to `1` for case-insensitive matching |
| `OUTPUT_FILE` | Override the output filename. Default: `<pubkey>.json` |

## Choosing what to grind

Where the prefix actually helps:

- **Destination wallets.** Easier to spot at a glance in Solscan, less risk of pasting the wrong address from a clipboard manager.
- **Creator wallets for coin branding.** The Solscan token detail page shows the creator address prominently.
- **Funder wallets.** Less visible to end users, but useful for your own ops clarity.

Where it doesn't:

- **Single-use temp wallets.** No one will see them. Don't waste hours grinding.
- **Rewards-distributor wallets.** End users see thousands of transfers from this address; the prefix is invisible in the noise.

## Security notes

- **Grinding doesn't weaken the keypair.** Random keypair → check pubkey prefix → keep or discard. The kept keys are as secure as any other random ed25519 keypair.
- **Don't grind for someone else's prefix.** If you grind a wallet starting with `bonkXX...` to look like the official Bonk team, that's impersonation. Use prefixes unambiguously associated with you.
- **Don't share intermediate state.** If you're grinding on a shared/remote machine, make sure the resulting `.json` doesn't end up in someone else's shell history or backup. Move it off the host immediately.
- **JSON keypair files are full secrets.** They contain the private key in plaintext base64. Treat them with the same caution as base58 secrets. `.gitignore` excludes `*.json` for this reason.

## Gotchas

- **Solana CLI default keypair confusion.** Solana CLI uses `~/.config/solana/id.json` as the default keypair for `solana` commands. Don't accidentally overwrite it by grinding `id.json:1` or by relocating a freshly-ground keypair into that path.
- **`solana-keygen grind` is CPU-bound.** It'll pin all your cores until it finds a match. Use `--num-threads` if you need to grind in the background while doing other work.
- **No GPU support in stock tools.** For prefixes 6+ chars, you need a GPU grinder (third-party projects exist on GitHub; vet carefully — there's been at least one trojaned vanity grinder that exfiltrates found keys).
- **Prefix charset constraints.** `0`, `O`, `I`, `l` aren't in base58. Grinding for `coOl` (with capital O) will run forever.

## Next steps

- **Use your ground keypair as funder/creator** in [tutorial 01 — Launch a pump.fun coin](./01-launch-pump-coin-via-jito.md).
- **Use a ground keypair as destination** for [tutorial 02 — Collect creator fees](./02-collect-creator-fees.md) and [tutorial 06 — Consolidate wallets](./06-consolidate-wallets.md).
