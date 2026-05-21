# Key management

How to handle the four classes of secrets this toolkit touches:

1. **Funder secrets** (the hot wallet paying SOL).
2. **Creator secrets** (the on-chain identity behind a coin).
3. **Destination pubkeys** (where drained funds settle — public, but operationally sensitive).
4. **RPC API keys** (Helius / Triton / QuickNode tokens).

This file is operational discipline, not protocol mechanics. For the protocol-level threat model see [`threat-model.md`](./threat-model.md).

## Storage hierarchy

By risk, from highest to lowest:

| Storage | Use for | Don't use for |
|---------|---------|---------------|
| Hardware wallet (Ledger, etc.) | Cold-storage of destination wallets that *receive* drained funds. | Funder or creator — the toolkit doesn't currently support remote signing. |
| Encrypted local file (`solana-keygen new --outfile`) | Creator wallets you control. | Funder wallets used for high-frequency operations (decryption overhead per call). |
| `.env` file with base58 secret, mode 600 | Funder wallets, short-running creator usage. | Anything you want safe long-term. |
| `.env` checked into a repo | **Never.** | **Never.** |
| Cloud secret manager (AWS Secrets Manager, Doppler, etc.) | Production deployments of long-running scripts (`watch-collect.js`). | Local dev — overkill. |
| Pasted into a chat / email / form | **Never.** | **Never.** |

## Funder wallet hygiene

The funder is your hot wallet. Treat it accordingly:

- **Small balance.** Keep just enough to fund the operations you have queued. Worst-case loss = current balance.
- **Top up frequently from a cold wallet.** Don't pre-fund weeks of operations at once.
- **Rotate quarterly.** Generate a new funder keypair, drain the old one, switch your `.env`. Limits exposure if the key ever leaked silently.
- **Never share the funder across machines.** Each operator machine should have its own funder keypair. Cross-machine sharing turns one compromise into all-machines compromise.
- **Don't reuse the funder as a receiving address.** A wallet that receives drained funds shouldn't be the same wallet that signs new launches — sweepers will eventually find it.

## Creator wallet hygiene

The creator's role is "on-chain identity of the coin". It signs `createV2` and `collect_creator_fee`.

- **Use a fresh creator per coin** if attribution matters. Reusing a creator wallet across coins links them publicly.
- **If the creator key is leaked or shared** (multi-sig, dev-team scenarios), use the atomic patterns (`collect-jito.js`, `consolidate.js`) so funds never rest on the creator wallet.
- **For one-off launches**, the creator can be a `solana-keygen grind`-generated vanity key. Discard after the coin is fully wound down via `consolidate.js`.
- **For long-running brand coins**, the creator should be either a hardware-wallet-derived address (manual claim flow) or a multi-sig.

## Destination pubkey hygiene

The destination is public — it's the address you tell scripts to drain into. But operational practices matter:

- **Use a fresh destination per campaign.** Don't drain ten coins into the same wallet; that wallet becomes a recognizable target.
- **Move from destination to a deeper cold wallet periodically.** The destination is one hop away from the leaked creator key in attack patterns — keep its balance bounded.
- **Verify the destination matches your intent** before every script run. The toolkit's typo-guards catch `DESTINATION == FUNDER`; they can't catch `DESTINATION = wrong address you meant something else`.
- **Never type the destination from memory.** Always copy-paste from your wallet's address book or a known-good notes file.

## RPC API key hygiene

API keys to Helius / Triton / QuickNode aren't fund-bearing, but they have value:

- **Throttle reasons to compromise.** A leaked Helius key gets used by random Solana traffic until your quota is exhausted and you get billed.
- **Store in `.env`**, never in source code or commit messages.
- **Rotate annually**, or immediately on suspected compromise (your provider's dashboard usually shows you per-key request volume).
- **Don't paste into chat.** Even if you trust the recipient, chat logs leak.
- **Separate RPC keys per environment.** Dev, staging, prod each get their own key. Compromise of one doesn't cascade.

## Rotation procedures

### Rotating the funder

```bash
# 1. Generate a new keypair
solana-keygen new --outfile ./funder-new.json --no-bip39-passphrase

# 2. Send remaining SOL from old funder to new funder (single tx — sweeper-safe since funder isn't a leaked target)
# Use solana CLI or any wallet UI

# 3. Update .env
sed -i.bak 's|^FUNDER_SECRET=.*|FUNDER_KEYPAIR=./funder-new.json|' .env

# 4. Confirm scripts work with the new funder against a throwaway operation
npm run check-balances -- $(solana-keygen pubkey ./funder-new.json)

# 5. Delete the old keypair file after confirming everything works
rm ./funder-old.json
```

### Rotating the creator

You can't change the on-chain creator of an existing coin. To "rotate", launch a new coin with a new creator. The old coin's creator stays as-is — manage its fees normally and wind it down via `consolidate.js` when ready.

### Rotating the destination

```bash
# 1. Pick a new destination (cold wallet you don't normally touch)
# 2. Update .env
sed -i.bak 's|^DESTINATION=.*|DESTINATION=<NEW_PUBKEY>|' .env
# 3. Optionally, drain the old destination to a deeper cold wallet
```

### Rotating an RPC API key

Provider-specific:

- **Helius**: dashboard → API keys → rotate. New key takes effect immediately.
- **Triton**: contact account manager.
- **QuickNode**: endpoint dashboard → rotate auth token.

Update `.env`. Restart any long-running scripts (`watch-collect.js` won't pick up the new key without restart).

## Multi-sig setups

For high-value campaigns, consider a multi-sig creator wallet (Squads, Mean Multisig, etc.):

- **Pros**: no single point of failure; deliberate sign-off on collects/distributions.
- **Cons**: the atomic toolkit's scripts assume single-sig signing. Multi-sig flows require manual ix construction + per-signer approval.

For now, the atomic toolkit is single-sig only. Multi-sig support is on the [ROADMAP](../../ROADMAP.md).

## Pitfalls

- **Don't share `.env` between teammates over chat.** Use a shared secret manager.
- **Don't commit `.env` "just temporarily to test CI"**. CI doesn't need real secrets; use placeholder values.
- **Don't grep-log secrets**. `grep -r 'SECRET' .` from a script that prints matches has leaked secrets to terminal history before.
- **Don't trust a wallet UI to "import keypair" with paste**. Most do this safely but some legacy ones cache to localStorage.
- **Don't reuse seed phrases across wallets**. A funder seed and a destination seed should be different.

## Related

- [`threat-model.md`](./threat-model.md) — the threats this discipline defends against
- [`incident-response.md`](./incident-response.md) — what to do when a key leaks anyway
- [`../runbooks/leaked-key-response.md`](../runbooks/leaked-key-response.md) — operational playbook
- [`../../SECURITY.md`](../../SECURITY.md) — disclosure + policy
