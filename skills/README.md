# Claude Code skills

Per-flow [Claude Code](https://github.com/anthropics/claude-code) skills covering the operational surface of this repo. Each skill has its own `SKILL.md` with frontmatter; Claude Code's skill resolver picks one based on the user's request.

| Skill | When Claude should invoke it | Backing scripts |
|---|---|---|
| [atomic-launch](launch/SKILL.md) | "launch a pump coin", "create pump.fun token", separate funder vs creator | `metadata.js`, `fire-jito.js`, `fire-atomic-create.js` |
| [atomic-collect](collect/SKILL.md) | "collect creator fees", "drain pump vault", protect against same-key sweepers | `collect-jito.js`, `watch-collect.js`, `consolidate.js` |
| [atomic-buy](buy/SKILL.md) | "buy a pump coin", "Jupiter buy via Jito", pump-sdk drift workaround | `buy-jito.js` |
| [atomic-rescue](rescue/SKILL.md) | "rescue tokens", drain leaked wallet, Token-2022 sweeper protection | `rescue-tokens.js` |
| [atomic-distribute](distribute/SKILL.md) | "distribute rewards", sqrt-weighted USDC payouts, EMERGENCY sweep | `distribute.js` |
| [atomic-audit](audit/SKILL.md) | "did pump.fun seed this wallet", funding-source provenance | `tools/check-pump-funding.ts` |

The root [SKILL.md](../SKILL.md) is a catch-all overview; the per-flow skills above have tighter trigger descriptions so the resolver can pick the right one for a specific request without loading the full toolkit context.

## Layout

```
skills/
  launch/SKILL.md       — pump.fun coin creation
  collect/SKILL.md      — creator-fee withdrawal
  buy/SKILL.md          — Jupiter-via-Jito token purchase
  rescue/SKILL.md       — SPL / Token-2022 atomic transfer
  distribute/SKILL.md   — sqrt-weighted USDC payouts to holders
  audit/SKILL.md        — wallet funding-source provenance
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
3. Body sections: **When to invoke**, **Script(s)**, **Setup**, **Flow**, **Env vars**, **Gotchas**, **Security**. Cross-link related skills with `[[skill-name]]`.
4. Add a row to the table above.
5. One skill per commit (`docs(skills): add atomic-<name> SKILL.md`).
