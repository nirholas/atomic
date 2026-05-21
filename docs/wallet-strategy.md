# Wallet strategy

How to organize Solana wallets when operating this toolkit. The
scripts give you primitives — *funder*, *creator*, *destination*,
*buyer*, *source* — but it's up to you to decide which physical
keypairs play which role. This page lays out the operating profiles
we've seen work, the tradeoffs each one accepts, and the failure
modes each one is designed against.

Companion: [`SECURITY.md`](../SECURITY.md) for the key-handling
rules; [`docs/architecture.md`](architecture.md) for why funder vs
creator is separated in the first place.

## Roles defined

The toolkit uses these named roles. Every wallet in your operation
maps to one (or more) of them.

| Role | Holds SOL? | Holds tokens? | Signs what? | Exposure |
|---|---|---|---|---|
| **Funder** | yes (working capital) | no | tx fee + Jito tip; the rent transfer to creator | high — touches the internet every collect |
| **Creator** | rent floor only | curve allocation, if any | `createV2`; later `collectCoinCreatorFee` | medium-to-high — pubkey is public on Solscan |
| **Destination** | accumulating | accumulating | nothing (it's a receive-only address) | low — should never sign anything |
| **Buyer** (buy-jito) | dust | the bought token, briefly | Jupiter swap | high — race with sweepers if key is shared |
| **Source** (rescue-tokens) | dust | the asset being rescued | the token transfer | usually compromised already |
| **Emergency** (distribute) | dust | recipient of swept USDC | nothing | low |

The defining design move of the toolkit is to make **funder ≠
creator ≠ destination**, so a compromise of any single key has a
bounded blast radius.

## Why separate roles

Each separation defends against a specific threat.

### Funder ≠ Creator

- **Failure prevented:** a leaked creator key drains the funder's
  ongoing budget.
- **Why it works:** creator only ever holds rent-floor SOL (collects
  drain it immediately); the funder is the only wallet with
  operating capital. Leaking the creator key leaks future fee
  collections, not the launch budget.
- **Realized in:** every `*-jito.js` script that takes both
  `FUNDER_SECRET` and `CREATOR_SECRET`.

### Creator ≠ Destination

- **Failure prevented:** a leaked creator key drains the entire fee
  history.
- **Why it works:** collect drains creator → destination atomically;
  the creator wallet never holds enough fees to make sweeping it
  worthwhile, and the destination never signs anything online.
- **Realized in:** `collect-jito.js`, `consolidate.js` —
  `DESTINATION` is a pubkey, not a keypair, in every env file.

### Funder ≠ Destination

- **Failure prevented:** a funder-key compromise reaches the
  long-term accumulated rewards.
- **Why it works:** funder holds only working capital sized for the
  next ~week of collects. Destination is in a cold wallet that
  signs nothing on the same host.
- **Realized in:** `consolidate.js` drains funder → destination in
  the same bundle as collect + creator drain.

### Buyer ≠ Holder

- **Failure prevented:** sweeper bots watching a leaked buyer key
  steal the tokens before the buyer wallet can move them.
- **Why it works:** `buy-jito.js` should be paired with an in-bundle
  transfer to a private holder wallet — the warning in the file
  header calls this out. If you skip the transfer, the buyer wallet
  is the holder, and you've inherited its exposure.

## Operating profiles

Four common modes. Pick the closest match and adapt.

### Profile A — One-shot launcher

You're launching one coin, holding short-term, maybe collecting once
or twice.

```
┌─ funder.json (hot, ~0.05 SOL)
│   pays launch + 1–2 collects
│
├─ creator.json (hot during launch, sweepable after)
│   appears on Solscan as creator
│
└─ destination = cold wallet pubkey
    receives collected SOL; signs nothing
```

- **Wallets to provision:** 2 hot (funder, creator) + 1 cold pubkey
  (destination).
- **Operational discipline:** sweep funder + creator after the
  short-term hold via `consolidate.js`. Treat both as burned.
- **Failure budget:** ≤0.05 SOL working capital + the value of
  whatever fees haven't been collected yet.

### Profile B — Long-running fee farmer

You're running `watch-collect.js` 24/7 against one coin.

```
┌─ funder.json (hot, 0.5–1 SOL working capital)
│   pays ongoing collect cadence; topped up monthly
│
├─ creator.json (hot)
│   signs every collect
│
└─ destination = cold pubkey (or low-frequency hot reshuffle wallet)
    accumulates the harvested SOL
```

- **Wallets to provision:** 2 hot + 1 cold pubkey.
- **Operational discipline:** rotate funder + creator on a fixed
  cadence (every N weeks or M collects, whichever comes first).
  Sweep the old keypair on rotation via `consolidate.js`.
- **Failure budget:** working capital × rotation interval + 1
  collect's worth of unswept fees.
- **Where this profile fails:** if the watcher host is compromised
  the attacker gets both hot keys and starts collecting to *their*
  destination. Mitigation: alert on any collect that doesn't drain
  to your `DESTINATION` (see
  [`docs/operations/running-as-a-service.md`](operations/running-as-a-service.md)
  on log-line patterns).

### Profile C — Multi-coin operator

Multiple coins, multiple watchers, possibly one host.

```
                  ┌────────────── destination = cold pubkey
                  │                (single sink for all coins)
                  │
        ┌─────────┴─────────────────────────────┐
        │                                       │
┌─ funder-A.json ──┬─ creator-A.json ──> coin A vault
│                  │
├─ funder-B.json ──┼─ creator-B.json ──> coin B vault
│                  │
└─ funder-C.json ──┴─ creator-C.json ──> coin C vault
```

- **Wallets to provision:** 2 hot × N coins + 1 cold pubkey.
- **Operational discipline:** never share a funder across coins. A
  funder shared between two watchers can be drained by one's
  collect during the other's bundle window, leading to bundle
  failures and missed collects.
- **Failure budget:** linear in N — losing one coin's keys doesn't
  touch the others.
- **Where this profile fails:** the destination becomes a
  fingerprint linking all your coins. Mitigation: use a different
  destination per coin (rotating across a small cold-wallet set),
  or terminate at a known mixer/exchange deposit address.

### Profile D — Distribution-only operator

You don't launch — someone else does — but you run `distribute.js`
to airdrop USDC rewards to holders on a coin you operate.

```
┌─ creator.json (hot, holds USDC reward pot)
│   collects fees, swaps SOL→USDC, signs every airdrop tx
│
├─ funder.json (optional)
│   only if you also run watch-collect; otherwise unused
│
└─ destination (optional, for residual sweep)
    where leftover SOL goes after distribute completes
```

- **Wallets to provision:** 1 hot creator at minimum.
- **Why this is risky:** unlike collect, `distribute.js` keeps USDC
  on the creator wallet between the swap and the airdrop batches.
  An attacker compromising the creator key between the swap and
  the first airdrop batch (a window of seconds, but real) can
  redirect the entire pot.
- **Operational discipline:** run `distribute.js` from a fresh
  shell on a host where nothing else has touched the key. After
  the run, rotate the creator key on the next collect cycle.
- **Failure budget:** the swap pot, mid-airdrop.

## Cold-wallet handling

The destination is a pubkey, not a keypair. But you have to derive
that pubkey from *something*, and that something needs to be cold.

Tradeoffs:

- **Hardware wallet (Ledger, etc.).** Best. Pubkey is derived
  on-device; signing requires physical confirmation. Use this for
  the destination in every profile above.
- **Paper / seed in a vault.** Works but requires a recovery
  ceremony to spend — fine for "accumulate, withdraw quarterly,"
  bad for "rebalance weekly."
- **Cold laptop without internet.** Same security as a hardware
  wallet if you're disciplined about airgaps, much worse if you
  ever sync it.
- **Another hot wallet that signs on a different host.** Not cold;
  treat as another hot key under a different blast radius.

## Funding the funder

The funder needs SOL to start. Two patterns:

1. **CEX → funder direct.** Fastest. Exchange-attributable funding
   in the funder's history — fine for most operations, undesirable
   if you want to obscure your launch identity.
2. **CEX → cold staging → funder.** One hop. Breaks the direct CEX
   linkage at the cost of one extra tx. Reasonable for any operator
   who cares about identity unlinkability.

`tools/check-pump-funding.ts` will tell you (and any future
investigator) the *first* sender of SOL into a wallet. If you care
about not being attributable, your first funder of any operating
wallet should not be a labeled CEX or pump.fun source — see
[`docs/scripts/check-pump-funding.md`](scripts/check-pump-funding.md)
for the reverse perspective.

## Rotation cadence

A working rotation policy:

| Wallet | Rotate after |
|---|---|
| Funder | every 100 collects, or 30 days, whichever first |
| Creator | only when compromised — pubkey rotation = new coin |
| Destination | yearly, more often if linked across many coins |
| Buyer (buy-jito) | every buy — fresh keypair each time, then `rescue-tokens` to permanent holder |

Creator rotation is the expensive one — you'd be launching a new
coin. Don't rotate proactively; rotate only on confirmed leakage.

## Wallets you should **not** create

A few combinations look tempting and produce bad outcomes:

- **One wallet for funder + creator + destination.** Loses the
  separation that justifies the toolkit existing in the first place.
  A leak of this single key drains everything.
- **Destination signed by the same key as the funder.** Looks
  separate on Solscan but isn't — your safe wallet is now a
  hot wallet by transitivity.
- **Creator key reused across launches.** First, pump.fun's vault
  derivation includes the creator key, so per-coin destinations
  still work — but on-chain your creator history is now a graph of
  every coin you've ever made, easy to subpoena.
- **Funder = "main" wallet you also use for unrelated activity.**
  The funder's tx history will be cross-correlatable with every
  collect on every coin you run — destroys plausible deniability.

## See also

- [`SECURITY.md`](../SECURITY.md) — the key-handling rules these
  profiles are built on.
- [`docs/architecture.md`](architecture.md) — why the funder/creator
  split is required, not just nice-to-have.
- [`docs/operations/cost-estimates.md`](operations/cost-estimates.md)
  — sizing the working-capital balance for the funder.
- [`docs/runbooks/leaked-key-response.md`](runbooks/leaked-key-response.md)
  — what to do when a wallet from any of these profiles is
  compromised.
- [`docs/scripts/check-pump-funding.md`](scripts/check-pump-funding.md)
  — verifying the "first funder" of any wallet you set up.
