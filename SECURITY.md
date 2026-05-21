# Security

Every script in [`src/`](src/) handles raw Solana private keys. Mishandling them will lose funds. Read this before running anything.

## Keypair files are private keys

A Solana keypair JSON (`funder.json`, `mint.json`, etc.) is the **full secret** — anyone with the file controls the wallet. Treat these files exactly like a `.env` containing a base58 secret.

- `*.json` is in [`.gitignore`](.gitignore) by default. The allowlist covers `package.json`, `package-lock.json`, and `tsconfig*.json` only.
- Never paste a base58 secret into a chat, issue, PR, log, or screenshot. GitHub secret scanning catches some patterns, but key-array JSON and base58 secrets are not always detected.
- Keep keypair files outside the repo when possible (e.g. `~/.config/solana/`) and point at them via `FUNDER_KEYPAIR=/abs/path` rather than dropping them in the working tree.

## If a key is leaked

Assume the wallet is compromised from the moment the key hits any external system (chat, GitHub history, a CI log, a paste site). GitHub history is permanent even after force-push or repo delete — caches and forks exist.

1. **Move funds immediately** from the compromised wallet to a fresh one. Sweeper bots watch leaked-key patterns and drain within seconds of the key going public. [`src/rescue-tokens.js`](src/rescue-tokens.js) is built for this case — it pairs the rescue with a Jito bundle so a bot can't insert between draining SPL/Token-2022 balances.
2. **Rotate** any PATs, RPC keys, or other API credentials that were exposed in the same blast radius.
3. **Burn the wallet.** Do not reuse it, even after sweeping — sweepers will re-drain any incoming funds.

## Why the atomic patterns matter

The whole point of bundling collect + drain ([`src/collect-jito.js`](src/collect-jito.js)), buy + transfer ([`src/rescue-tokens.js`](src/rescue-tokens.js)), and consolidate ([`src/consolidate.js`](src/consolidate.js)) in single Jito-bundled transactions is so that **funds never rest in a wallet a sweeper bot is watching**. If you replace any of these flows with multi-tx sequences, you're racing the sweeper — and they're faster.

## Reporting issues

Email security issues privately to the repo owner via the GitHub profile contact — do not open public issues for vulnerabilities in the launch flow itself.
