# Incident response

When something goes wrong, follow this playbook. It's organized by the most common incident types.

For the immediate-action runbook on leaked creator keys, see [`../runbooks/leaked-key-response.md`](../runbooks/leaked-key-response.md) — that's the on-call card. This file is the deeper procedure.

## Triage: which incident is this?

| Symptom | Incident type | Jump to |
|---------|---------------|---------|
| Wallet balance dropped unexpectedly | **Drained wallet** | [§ Drained wallet](#drained-wallet) |
| Committed `.env` or keypair JSON | **Leaked secret in repo** | [§ Leaked secret in repo](#leaked-secret-in-repo) |
| Suspect a key is publicly known | **Leaked key (suspected)** | [§ Leaked key (suspected)](#leaked-key-suspected) |
| A tx you didn't sign appears in wallet history | **Unauthorized tx** | [§ Unauthorized tx](#unauthorized-tx) |
| `watch-collect.js` stopped working | **Long-running script down** | [§ Long-running script down](#long-running-script-down) |
| Funds went to the wrong destination | **Misdirected funds** | [§ Misdirected funds](#misdirected-funds) |
| pump-sdk produced an invalid tx | **SDK drift** | [§ SDK drift](#sdk-drift) |
| RPC suddenly returns garbage | **Compromised RPC** | [§ Compromised RPC](#compromised-rpc) |

## Drained wallet

A wallet you control just lost SOL or tokens you didn't initiate.

**Immediate (within minutes):**

1. **Stop running any scripts using that key.** If `watch-collect.js` is running with the affected wallet, kill it.
2. **Confirm via on-chain data**, not just your wallet UI. Use Solscan: `https://solscan.io/account/<pubkey>`. Identify the outgoing tx and its destination.
3. **If the drained wallet is your destination wallet**, treat it as a key-leak incident — see [§ Leaked key (suspected)](#leaked-key-suspected). Move remaining funds out of any other wallet that shares the key.
4. **If the drained wallet is a known leaked-key wallet** (e.g. a creator with shared key), this is the expected sweeper behavior and your defense was insufficient — run [`../runbooks/leaked-key-response.md`](../runbooks/leaked-key-response.md) for any other affected coins.

**Recovery:**

- Drained funds are **not recoverable.** Solana txs are final.
- File a Solscan or block-explorer report if you want others to recognize the destination address as a sweeper.
- Update your `.env` to remove the compromised key. Rotate any related keys (see [`key-management.md`](./key-management.md#rotation-procedures)).

## Leaked secret in repo

You just `git push`-ed a `.env`, a keypair JSON, or a base58 secret in commit text.

**Time-critical (assume drainage in minutes):**

1. **Drain the compromised wallet to a fresh safe wallet immediately.** Use `npm run consolidate` if it's a creator wallet; use a manual transfer otherwise. Don't waste time on the git history yet — funds first.
2. **Rotate any affected RPC keys** at the provider dashboard.

**After funds are safe:**

3. **Rewrite git history** to remove the leaked file:
   ```bash
   git filter-repo --invert-paths --path .env
   # or for an in-line secret:
   git filter-repo --replace-text expressions.txt
   ```
4. **Force-push** the rewritten history. **Notify collaborators** so they can re-clone (their local copies still have the secret).
5. **Verify on GitHub** that the file is gone from `main` and from any open PRs.
6. **Treat the secret as compromised** forever. Even if you remove it from git, it was visible to anyone who cloned during the leak window.

GitHub also has a secret-scanning feature — they'll likely email you about the leak. Take it seriously.

## Leaked key (suspected)

You haven't seen a drain yet but have reason to suspect a key is now non-confidential (a former team member left, a backup got copied somewhere, etc.).

**Run the assumption-of-compromise playbook:**

1. **Move funds preemptively.** If the suspected key is a creator wallet, run `npm run consolidate` to drain vault + creator + funder to a fresh destination.
2. **Switch to a new key for future operations.** Generate a new wallet, update `.env`, retire the old one.
3. **Watch the old wallet's address** for drains. If a sweeper drains it, that confirms the leak.

**Don't:**

- Assume that "nobody knows about this key yet" means it's safe. Sweeper bots scan for any key that's ever been logged, posted, or committed.
- Try to "use up" the value on the old key before retiring it. Just drain.

## Unauthorized tx

A tx in your wallet's history that you didn't sign.

**This means the key is compromised.** No other explanation. Even a legit signer that you'd forgotten about counts as "compromised" relative to your current security model.

1. **Drain the wallet immediately** (see [§ Drained wallet](#drained-wallet)).
2. **Investigate after.** Check signer pubkeys on the suspicious tx. If it's a wallet you don't recognize, that's the sweeper. If it's a multi-sig participant, talk to them.
3. **Rotate everything related.** Funder, creator, destination — anything that shared infrastructure with the compromised key.

## Long-running script down

`watch-collect.js` or another daemon stopped collecting.

**Diagnose:**

1. **Check the process.** `ps aux | grep watch-collect`. If it's not running, your supervisor (PM2, Railway, systemd) didn't restart it.
2. **Check logs.** Last few entries usually reveal the cause: RPC rate-limit, missing env var, OOM, etc.
3. **Check the funder balance.** If the funder is empty, the script can't pay Jito tip. Top up.
4. **Check the destination's accumulated collections.** Compare to expected vault accumulation; you may have lost some collection cycles.

**Mitigate:**

- Restart the script. With a supervisor that auto-restarts on exit, this should already have happened — investigate why it didn't.
- If the script crashed mid-collect, the bundle either landed (vault is drained, destination got the funds) or didn't (vault still has the SOL). Bundle ID in logs tells you which.

**Prevent recurrence:**

- Add monitoring on the destination address; alert on no-deposits-for-N-hours.
- Use a paid RPC provider if rate-limits keep killing the script.
- Reduce `POLL_INTERVAL_SECONDS` to fail faster on RPC issues.

## Misdirected funds

You ran a script with the wrong `DESTINATION` and SOL went somewhere unintended.

**If the wrong destination is a wallet you control:** transfer the funds back to the intended destination via a normal tx. Done.

**If the wrong destination is a wallet you don't control:** the funds are gone. Solana is final. The toolkit's `DESTINATION != FUNDER` typo-guard exists to prevent this exact case — review your `.env` before every script run.

**Process improvement:**

- Add a `DESTINATION_CONFIRM=<first 4 chars>` env var requirement to all scripts. Mismatch → refuse to run. (This is on the roadmap as a feature, not yet shipped.)
- Use shell aliases that pre-populate `DESTINATION` from a known-good source.
- Run `npm run check-balances -- $DESTINATION` before any large operation to confirm it's your wallet.

## SDK drift

A `buy-jito.js` or other pump-sdk call started producing invalid txs.

**Cause:** pump.fun shipped an on-chain upgrade. Your local SDK version no longer matches.

**Fix:**

1. **Check pump-sdk's CHANGELOG**. There's almost certainly a recent release mentioning the upgrade.
2. **Bump the SDK** in `package.json`, run `npm install`. Test against a throwaway wallet.
3. **Or route via Jupiter** (`src/buy-jito.js` already does this; check that it's the entry point you're using).
4. **Check the V2 USDC doc set** at [`../v2-usdc-rollout/`](../v2-usdc-rollout/) for the May-21 rollout specifically.

**Don't:**

- Manually edit the SDK's account lists. You'll break in a different way.
- Disable pre-flight assertions to "make it work". The assertions exist because the alternative is silent failure.

## Compromised RPC

Your RPC provider is returning bogus data — wrong account balances, stale tx confirmations, etc.

**Confirm it's the RPC**, not your code:

1. Query the same data via a different RPC (the public mainnet endpoint, even rate-limited, works for one-off checks).
2. Cross-check on Solscan.
3. If results differ, your RPC is the problem.

**Mitigate:**

1. **Switch RPC immediately**. Update `RPC_URL` in `.env`, restart scripts.
2. **Rotate the API key** for the suspect provider — if their endpoint is misbehaving, the key may also be at risk.
3. **Re-run any reads** that informed recent decisions. Don't trust cached state from the compromised RPC.

## Communication

For incidents that affect *other users* of the toolkit (CVE-class bugs, sweeper attacks exploiting toolkit behavior):

1. **File a private security advisory** at <https://github.com/nirholas/atomic/security/advisories/new>. Do not file a public issue.
2. **Don't tweet the PoC.** Sweepers read public channels.
3. **Coordinate disclosure** with the maintainer per the timeline in [`../../SECURITY.md`](../../SECURITY.md).

For incidents that affect only your own operations: handle quietly, document internally for your own runbook, share lessons learned where they don't reveal exploitable patterns.

## Post-incident

Within 24 hours of any incident:

- **Write a short post-mortem** for yourself. What happened, why, what you did, what worked, what didn't.
- **Update keys and `.env`** as needed.
- **Tighten guardrails.** If a typo cost you, add a typo-guard. If a missing alert cost you, add the alert.
- **Don't blame**. Even with team-caused incidents, the goal is faster correction, not assignment.

## Related

- [`threat-model.md`](./threat-model.md) — the threats this responds to
- [`key-management.md`](./key-management.md) — preventive discipline
- [`../runbooks/leaked-key-response.md`](../runbooks/leaked-key-response.md) — concise on-call card
- [`../../SECURITY.md`](../../SECURITY.md) — disclosure policy
