# Claude Code skills

[Claude Code](https://github.com/anthropics/claude-code) skills covering the operational surface of this repo. Each skill has its own `SKILL.md` with frontmatter; the skill resolver picks one based on the user's request.

The skills fall into two layers:

- **Per-script skills** wrap a single script with the right env vars and gotchas — invoked when the user names a specific flow.
- **Workflow / decision skills** orchestrate multiple scripts, encode threat models, or guide migrations — invoked when the user describes a *situation* rather than a script.

## Per-script skills

| Skill | When Claude should invoke it | Backing scripts |
|---|---|---|
| [atomic-launch](launch/SKILL.md) | "launch a pump coin", "create pump.fun token", separate funder vs creator | `metadata.js`, `fire-jito.js`, `fire-atomic-create.js` |
| [atomic-metadata](metadata/SKILL.md) | "upload pump.fun metadata", "get IPFS URI for a coin" | `metadata.js` |
| [atomic-collect](collect/SKILL.md) | "collect creator fees", one-shot drain of the creator vault | `collect-jito.js` |
| [atomic-watch](watch/SKILL.md) | "auto-collect", long-running creator-fee poller | `watch-collect.js` |
| [atomic-consolidate](consolidate/SKILL.md) | "drain everything", vault + creator + funder → safe wallet | `consolidate.js` |
| [atomic-buy](buy/SKILL.md) | "buy a pump coin", Jupiter-via-Jito, pump-sdk drift workaround | `buy-jito.js` |
| [atomic-rescue](rescue/SKILL.md) | "rescue tokens", drain leaked wallet, Token-2022 sweeper protection | `rescue-tokens.js` |
| [atomic-distribute](distribute/SKILL.md) | "distribute rewards", sqrt-weighted USDC payouts, EMERGENCY sweep | `distribute.js` |
| [atomic-grind](grind/SKILL.md) | "grind a vanity wallet", prefix-based wallet generation | `grind.js` |
| [atomic-audit](audit/SKILL.md) | "did pump.fun seed this wallet", funding-source provenance | `tools/check-pump-funding.ts` |
| [atomic-funding-source](funding-source/SKILL.md) | Programmatic `detectSeededByPump` use from other code | `src/lib/funding-source.ts` |

## Workflow / decision skills

These don't map 1:1 to scripts; they encode operational sequences, threat models, and decision frameworks.

| Skill | When Claude should invoke it | Key value |
|---|---|---|
| [atomic-leaked-key-response](leaked-key-response/SKILL.md) | "key leaked", "wallet compromised", incident response | Orchestrates collect → consolidate → rescue → audit in the right order with the right tips |
| [atomic-sniper-launch](sniper-launch/SKILL.md) | "launch with dev-buy", "sniper-protect my launch", MEV-protected coin creation | Combines launch + dev-buy in one Jito bundle; tip strategy + dev-buy sizing |
| [atomic-bundle-debug](bundle-debug/SKILL.md) | "bundle didn't land", "Invalid", "Jito error", "stuck pending" | Symptom → diagnosis → action table; regional endpoint advice |
| [atomic-mev-protection](mev-protection/SKILL.md) | "MEV", "sweeper", "front-run", "sandwich" — threat-model questions | Threat taxonomy + which countermeasure in this repo addresses which threat |
| [atomic-fee-economics](fee-economics/SKILL.md) | "is it worth collecting", "what threshold", "break-even on tips" | Cost/benefit math for creator-fee collection; decision flow by accrual rate |
| [atomic-holder-analysis](holder-analysis/SKILL.md) | "holder distribution", "Gini", "Sybil signals", "pre-distribute check" | `tools/analyze-holders.ts` + interpretation guide |
| [atomic-v2-migration](v2-migration/SKILL.md) | "V2 USDC", "pump V2", "migration from V1" | Index for `docs/v2-usdc-rollout/`; symptom → fix table |

The root [SKILL.md](../SKILL.md) is a catch-all overview; the workflow skills have tighter trigger descriptions so the resolver can pick the right one for a specific situation.

## Layout

```
skills/
  # per-script
  launch/SKILL.md            — pump.fun coin creation
  metadata/SKILL.md          — IPFS metadata upload
  collect/SKILL.md           — single creator-fee withdrawal
  watch/SKILL.md             — long-running fee poller
  consolidate/SKILL.md       — drain creator + funder + vault
  buy/SKILL.md               — Jupiter-via-Jito token purchase
  rescue/SKILL.md            — SPL / Token-2022 atomic transfer
  distribute/SKILL.md        — sqrt-weighted USDC payouts to holders
  grind/SKILL.md             — vanity wallet generation
  audit/SKILL.md             — wallet provenance check
  funding-source/SKILL.md    — programmatic provenance helper

  # workflow / decision
  leaked-key-response/SKILL.md  — incident playbook
  sniper-launch/SKILL.md        — atomic launch + dev-buy
  bundle-debug/SKILL.md         — Jito bundle failure diagnosis
  mev-protection/SKILL.md       — threat model + countermeasure picker
  fee-economics/SKILL.md        — creator-fee cost/benefit math
  holder-analysis/SKILL.md      — distribution & Sybil analysis
  v2-migration/SKILL.md         — V1 → V2 USDC migration assistant
```

## Adding a new skill

1. Pick a name with the `atomic-` prefix (e.g. `atomic-snipe`).
2. Create `skills/<name-without-prefix>/SKILL.md` with frontmatter:
   ```yaml
   ---
   name: atomic-<name>
   description: <one-line trigger description — start with "Use when..."; be specific about what user requests should invoke it>
   ---
   ```
3. Choose body structure by skill type:
   - **Per-script skill**: When to invoke, Script(s), Setup, Flow, Env vars, Gotchas, Security.
   - **Workflow skill**: Decision flow, Symptom → action table, Operational substance (numbers, tips, anti-patterns), Related.
4. Cross-link related skills with `[[skill-name]]` and full paths in the Related section.
5. Add a row to the appropriate table above.
6. One skill per commit (`docs(skills): add atomic-<name> SKILL.md`).
