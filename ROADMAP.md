# Roadmap

Direction-of-travel for the `atomic` toolkit. This is a living document — items move between sections as priorities shift. Cross-check `git log` and the issue tracker for current state.

## Now (in flight)

- **V2 USDC rollout reference + executor prompts.** Reference docs landed in [`docs/v2-usdc-rollout/`](./docs/v2-usdc-rollout/). Five standalone executor prompts in [`prompts/v2-usdc-rollout/`](./prompts/v2-usdc-rollout/) for the downstream nirholas-owned repos (`pump-fun-sdk`, `pump-swap-sdk`, `pumpfun-claims-bot`, `pumpfun-creator-rewards`, `three.ws`).
- **Doc + skill expansion.** Filling out `docs/concepts/`, `docs/security/`, `docs/operations/`, additional skills, examples, tutorials.

## Next (queued)

- **Adopt V2 USDC builders in `src/buy-jito.js`.** Once `@nirholas/pump-sdk@1.33.0` ships, plumb `quoteMint` through the Jupiter route metadata so USDC-paired coins are buyable directly (Jupiter routes work, but knowing the underlying pair lets us pick optimal routing).
- **V2 USDC support in `src/distribute.js`.** USDC reward distribution becomes simpler when the coin itself is USDC-paired — no SOL→USDC swap intermediate.
- **Wallet provenance graph.** Extend `tools/check-pump-funding.ts` to walk N hops back, building a graph of funding sources. Useful for cluster analysis of related wallets.
- **`tools/check-bundle-status.ts`.** CLI wrapper around Jito's `getBundleStatuses` RPC for post-hoc verification.

## Later (low priority)

- **AMM-pair buy path.** `src/buy-jito.js` currently routes through Jupiter even when the coin has graduated and a direct PumpSwap AMM call would be cheaper. Add an automatic fork.
- **Token-2022 launch.** pump.fun coins are SPL Token by default. The protocol supports Token-2022; the toolkit doesn't yet expose it in `fire-jito.js`.
- **Multi-shareholder fee-sharing configurator.** A `src/setup-fee-sharing.js` script that builds a `create_fee_sharing_config` ix with N shareholders and verifies BPS sum to 10,000.
- **Webhook bridge.** Long-running observability (`watch-collect.js`) sending Telegram / Discord / Slack notifications on collect events.

## Not on the roadmap (out of scope)

These are explicitly out of scope. PRs proposing them will be closed:

- **A "rug" tool.** Pulling liquidity from a graduated pool is supported by upstream protocols and doesn't need bespoke automation here. Anything that automates defrauding holders is a hard no.
- **A "snipe" tool.** Detecting brand-new launches and front-running buys is gray-area at best. The toolkit's atomic *defensive* patterns are deliberately distinct from MEV-extractive ones.
- **Cross-chain bridges.** This repo is Solana-only. EVM/SVM bridging belongs in other repos.
- **A token launchpad UI.** The Node scripts are the surface area. Anyone is free to build a UI on top, but not here.

## Stable interfaces

These won't change without a major version bump (date-tagged with a `BREAKING:` annotation in CHANGELOG):

- Env var names (`FUNDER_SECRET`, `CREATOR_SECRET`, `DESTINATION`, `JITO_TIP`, etc.).
- `npm run <name>` script entries.
- The CLI surface of `tools/check-*.ts` (positional args + flags).
- The exported function signatures of `src/lib/funding-source.ts` and `src/lib/programs.ts`.

## Unstable interfaces (may change at any time)

- The internal helper functions inside each `src/*.js`. Treat them as private even though they're exported.
- The `docs/v2-usdc-rollout/` reference set will evolve as pump.fun's V2 docs evolve. The discriminator table and event layouts are stable; commentary may shift.
- Log line formats. Don't grep-parse them; the structured logs (when added) are the contract.

## How to influence the roadmap

1. **Open an issue.** Describe the use case, not the implementation. "I have N pump coins and want to consolidate creator fees weekly" is better than "build me a cron tool".
2. **Propose a PR.** Doc / tutorial / skill PRs land fastest. Script PRs require manual tx verification (see [`CONTRIBUTING.md`](./CONTRIBUTING.md)).
3. **Reference your use case in the V2 USDC docs.** If V2 broke something you depended on, file a `docs/v2-usdc-rollout/` issue with the specific Solscan tx that demonstrates the problem.

## Release cadence

Date-tagged releases on `main` once a meaningful batch lands. No fixed cadence. Track via `git tag -l` and the GitHub Releases page.
