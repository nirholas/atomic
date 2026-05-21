# Threat model

The atomic toolkit is designed to defend against a specific, narrow set of threats. This file makes those threats explicit, names them, and ranks them by likelihood. For practical fixes when something goes wrong, see [`incident-response.md`](./incident-response.md).

## Assumptions

The toolkit assumes:

1. **Operator's machine is trusted.** If your laptop is keylogged, no on-chain mechanic helps. Use disk encryption, lock the screen, don't paste secrets into web forms.
2. **RPC endpoints can see your wallets and traffic.** Don't broadcast through an RPC you don't trust. "Read-only" calls still leak the wallets you're querying.
3. **One or more keys may be public, shared, or leaked.** This is the design point. The atomic Jito-bundle patterns let you operate safely with these keys as long as funds never *rest* on them.
4. **MEV / sweeper bots are always watching.** Public balances on known-leaked keys are drained within seconds. This isn't a hypothetical.

## Threats in scope

### T1 — Sweeper races on leaked keys

**Likelihood:** High. Any coin launched with a public/shared creator key has sweepers watching from day one.

**Attack:** Operator initiates a multi-step flow (fund-then-create, claim-then-drain) without atomicity. SOL or tokens settle on the leaked wallet between txs. A sweeper sees the inbound transfer and submits a same-slot drain of its own.

**Defense:** Jito bundles. The atomic toolkit's launch / collect / consolidate / rescue scripts wrap multi-step flows in a single bundle. No mempool window for the sweeper.

**Residual risk:** None for the atomic-bundle paths. If you call the underlying pump-sdk directly (skipping the bundle), the sweeper window reopens.

### T2 — MEV reorder during launch

**Likelihood:** Medium for high-attention launches; low otherwise.

**Attack:** A sniper bot detects the `create` instruction in the mempool and inserts a buy tx ahead of the operator's dev-buy, getting the lowest possible curve price.

**Defense:** Bundle the create + dev-buy together. `fire-jito.js` does this — both txs land in the same Jito bundle, in sequence, no insertion possible.

**Residual risk:** Snipers can still buy in the *next* slot after the curve is live. That's not preventable by the create flow; managing it is a marketing / launch-strategy problem.

### T3 — Sandwich attack on buys

**Likelihood:** Medium for visible non-bundled buys; low for atomic-bundled buys.

**Attack:** Bot sees your buy tx, front-runs with its own buy (raising price), lets your tx execute at the worse price, then back-runs by selling.

**Defense:** Route through Jupiter inside a Jito bundle (`src/buy-jito.js`). Jupiter's atomic-swap semantics + Jito's same-block sequencing eliminate the sandwich window.

**Residual risk:** Very small for large buys on illiquid pools — the price impact alone is detectable even after the bundle lands. Mitigate with split-buys or off-hours execution.

### T4 — pump-sdk version drift causing failed buys

**Likelihood:** Medium. Happens at every on-chain protocol upgrade.

**Attack:** No malicious actor required. pump.fun ships an on-chain upgrade adding required accounts to the buy instruction. Outdated SDK versions produce invalid txs. Your buys fail silently or revert.

**Defense:** Route via Jupiter in `src/buy-jito.js` — Jupiter abstracts the underlying ix. Or bump pump-sdk to match the live program. Read the V2 USDC rollout doc set: [`../v2-usdc-rollout/`](../v2-usdc-rollout/).

**Residual risk:** The very first buyer after an unannounced upgrade may still fail. Always test against a throwaway wallet first.

### T5 — Accidental commit of secrets

**Likelihood:** Medium without guardrails; very low with the toolkit's defaults.

**Attack:** Operator accidentally commits `.env`, a keypair JSON, or pastes a base58 secret in a commit message. Public repo → instant drain.

**Defense:** `.gitignore` excludes `.env*` and `*.json` outside the allowlist. `SECURITY.md` calls out the rotation procedure. The repo's CI doesn't run with operator-owned secrets, eliminating leak vectors from the CI side.

**Residual risk:** Operator discipline. No tooling fully prevents typos. See [`key-management.md`](./key-management.md) for the rotation checklist.

### T6 — RPC provider sees the wallets you care about

**Likelihood:** High and ongoing — this just is the cost of using any public RPC.

**Attack:** Your RPC provider builds an attribution graph between your operator IP, the wallets you query, and the txs you broadcast. They can sell this data to indexers.

**Defense:** Use a reputable paid provider with a clean privacy policy (Helius, Triton, QuickNode). Don't broadcast through public mainnet RPC for sensitive work. Don't query the same wallets from a personal browser session.

**Residual risk:** Always present. If full deanonymization matters, use a Tor-routed RPC or run your own validator.

### T7 — Jito Block Engine censorship

**Likelihood:** Very low. Jito doesn't currently censor.

**Attack:** Jito's Block Engine refuses to land your bundle. Your launch or collect doesn't happen.

**Defense:** Non-Jito fallback. The scripts that *require* atomicity (collect-jito, consolidate, rescue) can't fall back without losing the atomicity guarantee. For non-time-sensitive operations, retry submission with different blockhashes.

**Residual risk:** Censorship at the protocol level is a structural risk for any Jito-dependent flow. If you need censorship resistance over atomicity, route to a non-Jito leader directly.

### T8 — Token-2022 transfer-fee or hook-based griefing

**Likelihood:** Low for pump.fun coins (which are standard SPL Token). Medium when interacting with arbitrary Token-2022 mints.

**Attack:** A malicious Token-2022 mint enforces a transfer fee or runs a transfer hook that fails on certain destinations. Your rescue script tries to drain such a token; the transfer reverts or sends only a fraction.

**Defense:** `src/rescue-tokens.js` checks the mint's program (SPL Token vs Token-2022), reads the transfer-fee config if present, and reports the actual amount that will arrive. Bail if it differs from expectations.

**Residual risk:** Adversarial Token-2022 extensions can still grief. Don't rescue tokens you didn't intend to receive in the first place.

## Threats out of scope

The toolkit explicitly does **not** defend against:

- **Compromised JS dependencies.** A malicious version of `@nirholas/pump-sdk` or `bs58` would compromise everything. Pin lockfiles, audit `npm ci`.
- **Funder-key compromise.** If your funder is keylogged or phished, every script using it is compromised. Treat the funder as a hot wallet.
- **Phishing of RPC API keys.** Treat your Helius/Triton key as a secret.
- **Social engineering of the operator.** "Hi, I'm pump.fun support, please send me the keypair for verification." No, they aren't, don't.
- **Hardware-wallet-specific attacks** (Ledger malware, etc.). The toolkit doesn't currently integrate with hardware wallets; when it does, that integration brings its own threat model.
- **5-eyes-level adversaries.** This toolkit isn't a privacy tool.

## Threat-to-defense matrix

| Threat | Defense in toolkit | Where to read more |
|--------|---------------------|---------------------|
| T1 sweeper races | Atomic Jito bundles | [`../architecture.md`](../architecture.md) |
| T2 launch front-running | `fire-jito.js` bundles create + dev-buy | [`../scripts/fire-jito.md`](../scripts/fire-jito.md) |
| T3 sandwich attacks | `buy-jito.js` via Jupiter in a Jito bundle | [`../scripts/buy-jito.md`](../scripts/buy-jito.md) |
| T4 pump-sdk drift | Jupiter route + V2 USDC doc set | [`../v2-usdc-rollout/`](../v2-usdc-rollout/) |
| T5 secret commits | `.gitignore` + `SECURITY.md` | [`../../SECURITY.md`](../../SECURITY.md) |
| T6 RPC observability | Document paid-provider choice | [`../operations/rpc-providers.md`](../operations/rpc-providers.md) |
| T7 Jito censorship | (no defense; document as residual risk) | This file |
| T8 Token-2022 griefing | Mint introspection in `rescue-tokens.js` | [`../scripts/rescue-tokens.md`](../scripts/rescue-tokens.md) |

## How to think about new threats

When you encounter a novel attack pattern:

1. **Map it onto T1–T8** if you can. Most attacks are variants on these.
2. **If genuinely new**, file a security advisory (see [`../../SECURITY.md`](../../SECURITY.md)), not a public issue.
3. **Don't post PoCs to public channels** before disclosure. Sweepers read Twitter too.

## Related

- [`key-management.md`](./key-management.md) — operational discipline around the keys this toolkit handles
- [`incident-response.md`](./incident-response.md) — what to do when something goes wrong
- [`../../SECURITY.md`](../../SECURITY.md) — disclosure process
- [`../runbooks/leaked-key-response.md`](../runbooks/leaked-key-response.md) — playbook for T1 actually happening
