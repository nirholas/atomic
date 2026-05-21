# Runbook: sweeper attack postmortem

A sweeper bot drained your wallet. This runbook is what to do *after* — recovery, forensics, and prevention for next time.

If you're discovering an active leak *right now*, go to [`leaked-key-response.md`](leaked-key-response.md) first.

---

## Triage: what was actually drained?

Pull the wallet's recent transactions:

```bash
solana transaction-history <wallet-pubkey> --limit 50 --output json
```

Or via Solscan: `https://solscan.io/account/<wallet-pubkey>`.

Categorize each outflow:

| Outflow type | Telltale signs |
|---|---|
| **Legitimate (you authorized this)** | Tx signed by your script, recipient is your destination wallet, time matches your activity |
| **Sweeper drain (SOL)** | `SystemProgram.transfer` to an unknown wallet, signed by your wallet, fired within ~3s of any incoming SOL |
| **Sweeper drain (SPL token)** | `Token.transfer` or `Token-2022.transfer` to an unknown ATA, signed by your wallet, fired within ~3s of receiving the token |
| **Sweeper drain (NFT/Metaplex)** | Same as SPL but the mint is decimals=0, supply=1 |
| **Phishing approval** | `Token.approve` to an unknown delegate, then later transfers via that delegate |

The pattern that confirms sweeper-bot activity: the drain tx lands **within seconds** of the deposit, repeatedly, with no human keyboard delay.

---

## Forensics: tracing where the funds went

For each sweeper drain, follow the recipient:

```bash
solana account <recipient-pubkey>
solana transaction-history <recipient-pubkey> --limit 20
```

Sweeper bots typically:
1. Receive into a **hot collector wallet** — single address that receives from many compromised wallets.
2. Periodically batch-forward to a **cold consolidation wallet**.
3. Sometimes mix through Solana-side services (Tornado-style mixers exist but are uncommon on Solana).
4. Eventually bridge out to Ethereum or off-chain via a CEX (often Binance or KuCoin deposit addresses).

You can usually identify the hot collector by:
- Receiving from 50+ distinct wallets in a short period.
- Having balance accumulate to round amounts (0.5 SOL, 1 SOL) before being swept out.
- Sometimes labeled on Solscan as "MEV bot" or similar after enough complaints.

### Use `tools/check-pump-funding.ts`

If the destination wallet later interacted with pump.fun, [`tools/check-pump-funding.ts`](../../tools/check-pump-funding.ts) can tell you whether it's pump-seeded:

```bash
npm run check-funding -- <suspect-wallet>
```

A `NOT SEEDED BY PUMP.FUN` verdict with first funder being a known MEV/sweeper hot wallet is the typical signature.

---

## What you can recover

Realistic recovery from a sweeper drain:

- **SOL drained**: 0% recovery. The sweeper consolidates within minutes and bridges out within hours. There's no protocol-level recovery mechanism on Solana.
- **Approved-but-not-yet-transferred tokens**: revoke the approval before the sweeper executes the transfer. Run:
  ```bash
  spl-token revoke <token-account>
  ```
  This only helps if you catch it before the delegate fires.
- **A coin you launched whose creator key is compromised**: the *coin* is fine. The bonding curve and metadata are intact. Use atomic collect to drain future creator fees safely — see [`collect-jito.md`](../scripts/collect-jito.md).
- **Tokens already drained**: 0% recovery via on-chain means. Off-chain: file a CEX freeze request if you've traced to a CEX deposit address, but realistically this rarely results in recovery.

### When to file a CEX freeze request

If your forensics traced the funds to a CEX deposit, file a report:

- Provide the source tx hash, the CEX deposit tx hash, and the wallet trail between them.
- Include any KYC details (impossible to know directly, but the CEX can check internally).
- Be specific about amounts and timestamps.

CEX freeze success rate is low (<10% on individual losses). Filing is still worth ~20 minutes of your time if the amount is meaningful.

---

## Postmortem: how did the key leak?

Walk through the suspect-leak list in [`docs/keypair-hygiene.md#things-that-have-actually-leaked-keys`](../keypair-hygiene.md#things-that-have-actually-leaked-keys):

1. **Shell history.** Run `grep -ri "FUNDER_SECRET\|CREATOR_SECRET" ~/.zsh_history ~/.bash_history` — find any plaintext secrets.
2. **`.env` committed.** Check repo history: `git log --all -p -S "<first-8-chars-of-secret>"`.
3. **AI assistant paste.** Did you paste a `.env` or keypair into an LLM in the past 30 days?
4. **CI logs.** Did any CI job echo `env`, print `process.env`, or run with `DEBUG=*`?
5. **Backups / dotfiles repo.** Did you back up a directory containing the secret?
6. **Codespace snapshot.** Did you create the keypair *inside* a Codespace that was later shared?
7. **Browser wallet import.** Did you import this key into Phantom/Solflare?

Pick the most likely cause. Often you'll find it within 2–3 minutes of looking.

### If the cause is non-obvious

If you can't identify the leak vector, the keypair may have been guessed via:
- A weak BIP-39 mnemonic (12 words from a small wordlist).
- A keypair generated by malicious `solana-keygen` derivative (supply-chain attack).
- A vulnerability in a wallet UI you used.

These are rare but real. If you suspect this:
- Stop using the affected machine for *any* cryptography.
- Regenerate keypairs on a verified-clean machine (fresh OS install, official `solana-keygen` from solana.com).
- Treat any other key derived/used in the same environment as also compromised.

---

## Prevention going forward

### Treat every wallet as potentially compromised

The toolkit's design assumption — the *creator* key is leaked-by-default — is a useful mental model to extend. Treat *every* wallet you control as if it might be compromised in the next 30 days, and ask: would my pattern still be safe?

- ✅ Atomic bundle: drain → destination in one tx → safe even if creator leaks.
- ❌ Multi-step manual: drain → wait → manually move → vulnerable to a leak during the wait.

### Rotate funders quarterly

Even without evidence of a leak, rotate funder keys every 3 months. Generate new, fund from a known-clean source (CEX withdrawal, never the old funder), drain the old funder.

Generating fresh keys does not protect against *active* leak vectors (if your shell history is being read, the new key gets compromised too). It protects against *historical* leaks where someone got the key six months ago and is waiting for activity.

### Separate operational keys per role

Don't reuse one funder for: launching coins, collecting fees, paying for buys, paying for distributes. Use four different funders. Reasons:

- Limits blast radius if one leaks.
- Easier forensics (each wallet's tx history is single-purpose).
- Lets you rotate one without rebuilding everything.

The toolkit doesn't enforce this — it takes a single `FUNDER_SECRET` per script invocation — but you can run scripts with different env vars to achieve the separation.

### Monitor with `watch-collect.js`-style watchers on *all* your wallets

A watcher that polls `solana balance` on each of your wallets and alerts on unexpected outflows catches a sweeper within seconds of activation. There's no specific tooling in this repo for the monitor side, but the polling pattern in [`watch-collect.js`](../scripts/watch-collect.md) is easily adapted.

### Don't reuse "burned" wallets

Once a wallet is compromised, **never deposit into it again**. The sweeper will detect the deposit within seconds. Some operators try "one last withdrawal" thinking they're faster than the sweeper — the sweeper wins ~95% of the time. The 5% that succeed are not worth the 95% that don't.

If you absolutely must use a leaked wallet one more time (e.g. it holds an NFT you need to move, or it's the creator of a coin with active fees), use an atomic bundle that:
1. Funds the wallet just enough for the operation.
2. Performs the operation.
3. Drains everything (operation result + leftover dust) to a safe destination.

All in a single Jito bundle, all in the same tx. See [`rescue-tokens.js`](../scripts/rescue-tokens.md) and [`consolidate.js`](../scripts/consolidate.md).

---

## Documentation: write down what happened

After every sweeper incident, write a one-page post:

```
Date:
Wallet:
Estimated loss:
Detection time:
Suspected leak vector:
Recovery actions taken:
Prevention steps adopted:
```

This is for *you*, not anyone else. Re-read it before the next operation. Patterns emerge — "this is the third time I've leaked a key by pasting into ChatGPT" is the kind of self-knowledge that prevents the fourth time.

---

## Related

- [`docs/runbooks/leaked-key-response.md`](leaked-key-response.md) — what to do during an active leak
- [`docs/keypair-hygiene.md`](../keypair-hygiene.md) — the prevention manual
- [`docs/architecture.md`](../architecture.md) — why the toolkit is designed for leak resilience
- [`tools/check-pump-funding.ts`](../../tools/check-pump-funding.ts) — forensic tool for tracing sweeper destinations
