# Keypair hygiene

Secrets handling for this toolkit: where keys come from, where they go, what gets logged, and how to avoid the failure modes that have *actually* caused losses in pump.fun ops.

This is a security page, but it's organized around concrete keyboard-level practice, not threat-model platitudes. If you read one section, read [Things that have actually leaked keys](#things-that-have-actually-leaked-keys).

---

## The two ways to supply a keypair

Every script in this repo accepts either:

| Form | Env var pattern | Format |
|---|---|---|
| **Base58 secret** | `FUNDER_SECRET`, `CREATOR_SECRET` | A single base58 string (the 64-byte secret key encoded). |
| **Solana CLI keypair file** | `FUNDER_KEYPAIR`, `CREATOR_KEYPAIR` | Path to a `.json` file holding a 64-element byte array. |

The toolkit checks the `*_SECRET` env var first; if absent, falls back to `*_KEYPAIR` file path; if both absent, aborts.

### Which form to use

| Use case | Recommended form | Why |
|---|---|---|
| Interactive scripts on your dev machine | `*_KEYPAIR` file path | Less likely to end up in shell history |
| CI/CD or hosted scripts | `*_SECRET` via secret manager | Secret manager can rotate without rewriting files |
| Quick one-shot from a terminal | `*_SECRET` inline | Convenient, but be aware of shell history (see below) |

There is **no difference in security** between the two at the program level — they hold the same secret. The difference is the surface area for accidental disclosure.

---

## `.gitignore` and the JSON allowlist

`.gitignore` in this repo excludes `*.json` by default:

```
# Ignore JSON files by default (likely to be keypairs)
*.json

# But allow specific JSON files we *do* want tracked
!package.json
!package-lock.json
!tsconfig.json
!tsconfig.*.json
```

The default-deny-then-allowlist pattern is deliberate. It means **any new JSON file you create is ignored unless you explicitly whitelist it**. If you have a keypair file at `wallets/funder.json`, git won't see it — even if you run `git add .`.

⚠️ **Don't override the gitignore for "configs" without thought.** A common mistake: someone adds `!config.json` to allow a config file, then a teammate later saves their keypair at `config.json` thinking it's a config, and the next commit publishes the key.

If you need a non-keypair JSON tracked:
1. Put it in a non-`wallets/` directory.
2. Name it something that can't be confused with a keypair (`metadata.json`, `manifest.json`, etc.).
3. Add an explicit allowlist line: `!docs/metadata.json` (not `!*.json` in some subdirectory).

---

## Things that have actually leaked keys

Ordered by frequency. Each item is something that has caused real losses in real pump.fun ops, not theoretical risk.

### 1. Shell history

```bash
FUNDER_SECRET=4xK7...nVZ npm run launch
```

This line ends up in `~/.bash_history` or `~/.zsh_history`. Anyone who later gains shell access (Codespaces snapshots, leaked SSH keys, shared dev VM) can grep it.

**Fix:** Use `.env` files for repeated runs. For one-shots, prefix with a space (most shells skip space-prefixed commands in history) or use `read -s` to prompt:

```bash
read -s -p "FUNDER_SECRET: " FUNDER_SECRET
export FUNDER_SECRET
npm run launch
```

### 2. `.env` files committed via `git add -A`

The pattern: developer creates `.env` from `.env.example`, fills in real secrets, then later runs `git add -A` expecting it to skip ignored files. It does — *unless* the `.env` file is in a subdirectory and a `.gitignore` in that subdirectory doesn't reference it.

**Fix:** Make `.env` ignored at the *repo root* `.gitignore`:

```
.env
.env.local
.env.*.local
```

And run `git status` *before* `git commit`. If `.env` appears in staged files, something is wrong.

### 3. Pasting secrets into AI assistants

Pasting a `.env` file into ChatGPT, Claude, or any LLM with conversation history → that file is now in the assistant's training-eligible logs. Most providers say they don't train on paid-tier data, but the file is still cached somewhere.

**Fix:** Never paste real secrets into an LLM. Use placeholders (`FUNDER_SECRET=<redacted>`) when asking for help. The toolkit's scripts never need to know your real secret value to be debugged — error messages and stack traces have all the diagnostic info needed.

### 4. CI logs

Setting `FUNDER_SECRET` as a CI environment variable is fine. *Echoing* it in a CI step is not. Common ways this happens:

- `env` or `printenv` in a CI step (shows all env vars including secrets).
- A debugging `console.log(process.env)` in code that runs in CI.
- A test that prints the entire config object including secrets.

**Fix:** Use the CI provider's secret-masking. GitHub Actions auto-masks secrets registered via `secrets.*`, but only for *exact* matches — a partial echo (e.g. first 8 chars) bypasses the mask.

### 5. Backups, screenshots, dotfiles repos

Backing up your home directory to a public S3 bucket, or pushing your dotfiles to a public GitHub repo, with `.zsh_history` or `~/.solana/` included.

**Fix:** Audit your backup and dotfile rules. `find ~ -name "*.json" -path "*keypair*"` finds CLI keypairs. Move them to a directory excluded from all backup rules.

### 6. Codespace snapshots

GitHub Codespaces snapshots your working directory. If you created keypairs inside the codespace and the codespace is later shared (rare but happens), the snapshot may include them.

**Fix:** Keep secrets *outside* the codespace's repo directory. Mount them via a tmpfs or pass via Codespace secrets (`gh codespace edit -s name`). The repo's `.gitignore` covers committed leaks; it does not cover snapshot leaks.

### 7. Imported wallets in a hot wallet UI

Importing your `FUNDER_SECRET` into Phantom/Solflare for "easy access" exposes it to:
- Browser extensions you have installed.
- Wallet UI bugs and supply-chain attacks on the wallet provider.
- Phishing dApps that abuse the wallet's `signMessage` for sensitive operations.

**Fix:** The funder is a *script wallet*. It should never touch a browser UI. If you need to inspect its balance, use `solana balance <pubkey>` — the public key is enough to read state.

---

## What the toolkit does to minimize leakage

### Doesn't log secrets

Every script that prints a "Loaded wallet" line logs only the *public key*. Search the repo for `console.log` calls referencing secret variables — there should be zero.

If you add new code, the rule is: **never log a secret, even truncated, even for "debugging."** A truncated secret is still enough to reduce the search space dramatically for a brute-force.

### Validates the secret before use

Every keypair loader runs through `Keypair.fromSecretKey(base58.decode(secret))` and catches the failure to give a clear error like "Invalid base58 secret for FUNDER_SECRET" — *without* echoing the malformed value. A malformed secret pasted from a corrupted source is a common error and should not double as a way to leak the value to logs.

### Doesn't write keys to tmp

Scripts that need to pass keypairs to subprocesses pass them via env, not via temp files. Tmp files survive crashes and can end up in core dumps.

### Sends-then-clears

Long-running scripts (`watch-collect.js`) load the keypair once and keep it in memory. They do not periodically re-read the env var. This means rotating a key in CI doesn't take effect until the process restarts — by design, to avoid mid-flight surprises.

---

## Rotating a funder key

Routine rotation is good practice. The flow:

1. Generate a new keypair: `solana-keygen new --no-bip39-passphrase -o new-funder.json`.
2. Fund it from an exchange or a previously-collected wallet (not from the old funder — that creates a tx linking them).
3. Update the env var or `.env` file.
4. Restart any long-running scripts (`watch-collect.js`).
5. Drain the old funder back to your safe wallet using [`rescue-tokens.js`](scripts/rescue-tokens.md) or `solana transfer`.

The creator wallet is harder to rotate because the on-chain attribution is permanent. If you must rotate, you essentially launch a new coin from a new creator — there's no way to retroactively change the creator field on an existing coin.

---

## Recovering a leaked funder

If your funder secret leaked, **assume every sweeper bot in the ecosystem now has it**. The minute SOL arrives, it will be drained.

The recovery flow:

1. Generate a new funder keypair offline.
2. Do not deposit any new SOL into the leaked funder.
3. For any pending operations (coins mid-launch, vaults mid-collection), use the funder *one final time* via an atomic Jito bundle that drains the funder's balance in the same tx as the operation. The atomicity guarantees the sweeper can't drain between operations.
4. Once the funder is empty, abandon it. Don't try to "recover" by depositing more SOL — the sweeper will get it.

This is the scenario [`docs/runbooks/leaked-key-response.md`](runbooks/leaked-key-response.md) covers in detail.

---

## Recovering a leaked creator key

A leaked *creator* key is the toolkit's design assumption (the whole atomic-collect pattern exists for this scenario). You don't need to "recover" — you just need to ensure every collection goes through [`collect-jito.js`](scripts/collect-jito.md) so the SOL never rests in the creator wallet between drain and final destination.

Things you should *not* do with a leaked creator key:

- Send SOL to it for any reason. The sweeper drains in <3 seconds.
- Buy tokens to its ATA. The sweeper has Token-2022 capability and will move tokens out.
- Use it as a Jupiter swap recipient. Same as above.

Things you *can* safely do with a leaked creator key:

- Sign `createV2` (no SOL rests in it — the bundle pays rent and immediately moves on).
- Sign `collectCoinCreatorFee` *inside an atomic bundle* that also drains to a safe destination in the same tx.

---

## Related

- [`docs/runbooks/leaked-key-response.md`](runbooks/leaked-key-response.md) — what to do *right now* if you suspect a leak
- [`docs/architecture.md`](architecture.md) — the funder/creator split as a response to leakable creator keys
- [`tools/check-pump-funding.ts`](../tools/check-pump-funding.ts) — verify a wallet's first SOL source as part of forensics
- [`.env.example`](../.env.example) — the only file you should be filling in with real secrets
