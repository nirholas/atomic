---
name: atomic-mev-protection
description: Use when the user is reasoning about MEV (Maximal Extractable Value), sweeper bots, sniper bots, sandwich attacks, or front-running risk on Solana — and wants to pick the right countermeasure from this toolkit. Triggers on "MEV protection", "sweeper bots", "sniper bot", "front-running", "sandwich attack", "atomic", "Jito bundle", "how do I prevent X from racing me", "same-block insertion", or any threat-model question about adversarial actors at the Solana tx level. Decision skill — points at the right flow rather than implementing a new one.
---

# atomic-mev-protection — MEV threat model & countermeasure picker

This entire toolkit is built around a small set of MEV/front-running threats. This skill names each threat, explains the mechanism, and routes the operator to the existing countermeasure. The countermeasures all rely on Jito bundles for same-block atomicity — there is no other mechanism on Solana that gives you "these N txs land together or not at all" with the same guarantee.

## Threat landscape

### T1 — Same-key sweepers
**Mechanism:** Adversary holds the same private key the operator does (leaked, shared, or sold). Adversary's bot watches the address and races to drain any SOL or token balance, or to call any state-changing instruction (like `collectCoinCreatorFee`) the moment it accrues value.

**Time horizon:** 1–3 seconds for SOL, 2–4 seconds for Token-2022 (sweepers fetch mint extension data first).

**Why standard wallets fail:** Naive flows leave money resting on the leaked wallet between operations. Even a 200ms gap is enough for a sweeper running on a colocated node.

**Countermeasures in this toolkit:**
- [atomic-collect](../collect/SKILL.md) — atomic `collectCoinCreatorFee` + transfer in one tx. Zero window.
- [atomic-consolidate](../consolidate/SKILL.md) — one Jito bundle that drains vault + creator + funder simultaneously.
- [atomic-rescue](../rescue/SKILL.md) — atomic SPL / Token-2022 transfer with bundle-level no-insert.
- [atomic-leaked-key-response](../leaked-key-response/SKILL.md) — orchestrates the full multi-step response.

### T2 — Launch-time snipers
**Mechanism:** Bots subscribe to pump.fun program logs and fire a buy bundle the moment a `create` instruction appears. They aim to be first into the bonding curve at the lowest price.

**Time horizon:** Their bundle is built and submitted within ~50ms of the `create` log. They will outpay you on tip if they want the trade more than you do.

**Why standard launches fail:** A `create` tx followed by a separate buy tx — even from the same operator — gives the sniper one slot to insert their buy at a lower price. You then buy after them, paying more.

**Countermeasures:**
- [atomic-sniper-launch](../sniper-launch/SKILL.md) — bundle `create` + dev-buy in the same Jito bundle so no sniper can land between them.

### T3 — pump-sdk version drift
**Mechanism:** pump.fun upgrades the on-chain program (e.g. adds a required `BuybackFeeRecipient` account to `buy`). Local pump-sdk versions lag. Code that built the `buy` ix against the old IDL submits txs that the program rejects.

**Time horizon:** Drift can persist for hours to weeks depending on how fast SDK maintainers ship updates.

**Why this is an MEV-adjacent issue:** A failed buy tx is a missed entry. While you debug, sniper bots (who route via Jupiter or have up-to-date SDKs) are buying at the price you wanted.

**Countermeasures:**
- [atomic-buy](../buy/SKILL.md) routes via Jupiter aggregator, which is always synchronized with live program state because it reads on-chain pool data rather than building from a stale IDL.

### T4 — Token-2022 sweepers on leaked / shared wallets
**Mechanism:** A specialization of T1. Bots watch known-leaked addresses for incoming Token-2022 deposits, then race to transfer the tokens out using the leaked key. Transfer-hook accounts are pre-computed by the bot so its tx is ready to submit the instant the deposit lands.

**Time horizon:** 2–4 seconds typically; some bots are < 1 second.

**Why this is hard:** Standard `await connection.sendTransaction(transferIx)` leaves a window. The sweeper's tx and yours both reach the leader; whoever's bundle pays more tip wins.

**Countermeasures:**
- [atomic-rescue](../rescue/SKILL.md) — Jito bundle wraps the transfer so the bundle is selected as a unit, not racing one tx at a time.
- Best practice: don't deposit tokens to a leaked / shared wallet at all. Buy directly to a clean wallet via [atomic-buy](../buy/SKILL.md) with `FUNDER_SECRET` set to the clean wallet.

### T5 — Sandwich attacks on large buys
**Mechanism:** Adversary detects your large pending buy, sells before you (front-run), lets your buy push the price up, then buys back after you (back-run). You eat both legs of the slippage.

**Time horizon:** Slot-level; sandwich bots typically operate inside one slot or across two adjacent slots.

**Why standard buys are vulnerable:** A `buy` tx broadcast to a public RPC is visible to anyone watching the mempool (which Solana doesn't formally have, but leader nodes accept incoming txs in roughly the order they receive them).

**Countermeasures:**
- Jito bundles with **non-zero tip** + tight slippage — the bundle either lands at your price or doesn't.
- For large positions, split into multiple smaller bundles across many slots. Predictable cadence is bad; random cadence is better.

This repo doesn't have a dedicated "anti-sandwich" script, but the Jito-bundle pattern in [atomic-buy](../buy/SKILL.md) provides the substrate.

### T6 — Jito tip auctions and tip-account drift
**Mechanism:** Not adversarial per se, but operationally MEV-adjacent. Jito's block engine picks bundles by tip; rotation of the tip-account list means stale clients submit to dead accounts and get rejected, while up-to-date clients land.

**Countermeasures:**
- [tools/check-tip-accounts.ts](../../tools/check-tip-accounts.ts) — diff hardcoded against live list.
- [atomic-bundle-debug](../bundle-debug/SKILL.md) — diagnoses the failure modes.

## Picking the right tool

```
What is the operator trying to protect against?
│
├─ A key I share with others / leaked → atomic-leaked-key-response
│   ├─ Collect creator vault → atomic-collect
│   ├─ Drain everything → atomic-consolidate
│   └─ Rescue tokens   → atomic-rescue
│
├─ Snipers on my launch → atomic-sniper-launch (launch + dev-buy in one bundle)
│
├─ pump-sdk out of date / buy ix fails → atomic-buy (Jupiter route)
│
├─ Sandwich on a normal buy → atomic-buy with high JITO_TIP + tight SLIPPAGE_BPS
│
├─ Tokens accidentally sent to a known-watched wallet → atomic-rescue immediately
│
└─ Bundles failing operationally → atomic-bundle-debug
```

## Operational hardening (not specific to one script)

Beyond running the right script for the right threat, these practices reduce your MEV exposure across the board:

1. **Treat funder wallets as hot wallets.** Keep balances small (just enough for ~10 operations of tips and rent). If the funder leaks, you lose less.
2. **Don't reuse a wallet across roles.** Creator wallet, funder wallet, holder wallet, destination wallet — keep them distinct. Cross-role reuse leaks information to chain analysts and clusters sweeper attention.
3. **Generate keys on clean hosts.** A wallet generated on a host that has ever run an unverified `curl | bash` script is suspect.
4. **Use a paid RPC.** Public mainnet RPCs are slower and more rate-limited, which costs you slots in time-sensitive flows. Helius / Triton / QuickNode.
5. **Pre-compute everything you can.** ATA addresses, PDAs, tip accounts — derive once and cache. Every getAccountInfo call you make at submission time is latency a competing bot doesn't have.
6. **Tip-up early, not late.** A bundle that fails at `JITO_TIP=0.005` and then re-runs at `0.01` wastes a slot. If you suspect competition, start at 0.01 the first time.
7. **Don't paste secrets in chat.** Including this one. (You know who you are.)

## What MEV protection this toolkit does NOT provide

- **No mempool privacy.** Solana doesn't have a real mempool, but tx contents are visible to the leader once submitted. Jito bundles are visible to Jito but not to other searchers — better than naked RPC submission, not perfect.
- **No protection from validator-level censorship.** A validator that doesn't want your tx in their block can drop it. Switch block-engine regions if you hit this consistently.
- **No protection from off-chain compromise.** If the operator's host is compromised, every key on it is compromised. Atomicity is a chain-level guarantee, not an OS-level one.
- **No protection from "social MEV"** (someone reading your launch announcement and front-running by buying separately). That's not bot-driven, it's just being public.

## Reference: which countermeasure exists for which threat

| Threat | This-toolkit countermeasure | Skill |
|---|---|---|
| Same-key sweeper on creator vault | Atomic collect + transfer | [atomic-collect](../collect/SKILL.md) |
| Same-key sweeper on entire wallet | One-bundle consolidate | [atomic-consolidate](../consolidate/SKILL.md) |
| Same-key sweeper on tokens | Atomic SPL/Token-2022 transfer | [atomic-rescue](../rescue/SKILL.md) |
| Launch-time sniper | Bundle create + dev-buy | [atomic-sniper-launch](../sniper-launch/SKILL.md) |
| pump-sdk drift on buy | Jupiter route inside bundle | [atomic-buy](../buy/SKILL.md) |
| Sandwich on buy | Bundle + tip + tight slippage | [atomic-buy](../buy/SKILL.md) |
| Jito tip-account drift | Drift check tool | [atomic-bundle-debug](../bundle-debug/SKILL.md) |
| Mass incident response | Orchestrated playbook | [atomic-leaked-key-response](../leaked-key-response/SKILL.md) |

## Related

- [SECURITY.md](../../SECURITY.md) — top-level threat model
- [docs/runbooks/leaked-key-response.md](../../docs/runbooks/leaked-key-response.md) — operational sequence
- All per-flow skills under [skills/](../README.md)
