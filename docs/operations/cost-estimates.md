# Cost estimates

Per-script SOL cost breakdown, derived from the defaults baked into
each file in [`src/`](../../src/). Every cost is expressed as a sum of:

- **Base tx fee** — 5,000 lamports per signature
- **Priority fee** — `PRIORITY` (µlamports / CU) × CU actually consumed
- **Jito tip** — `JITO_TIP` SOL, transferred to a Jito tip account
- **Rent transfers / on-chain rent** — funds moved between wallets or escrowed by programs

This page is the deeper version of the *How much does a launch cost?*
entry in [`FAQ.md`](../../FAQ.md).

## Reference numbers

| Quantity | Value | Source |
|---|---:|---|
| Base tx fee per signature | 5,000 lamports | Solana runtime constant |
| 1 µlamport | 10⁻⁶ lamport | priority-fee unit |
| Rent-exempt minimum (system account) | 890,880 lamports ≈ 0.00089 SOL | `BUFFER_LAMPORTS` default in `src/collect-jito.js` |
| Default Jito tip | 0.005 SOL | `JITO_TIP` default everywhere |
| pump.fun `createV2` rent | ~0.022 SOL | FAQ; observed on mainnet |
| Typical createV2 CU consumed | 60K–120K | `simulateTransaction` |
| Typical collect-jito CU consumed | 40K–80K | `simulateTransaction` |

All scripts default `RPC_URL=https://api.mainnet-beta.solana.com`,
which has no SOL cost but is rate-limited; see
[`rpc-budget.md`](rpc-budget.md) for endpoint sizing.

## `fire-jito.js` — two-tx Jito-bundle launch

Tx1 (funder) and Tx2 (creator) share a blockhash and execute atomically.

| Component | Tx1 (funder) | Tx2 (creator) |
|---|---:|---:|
| Signatures | 1 (funder) | 2 (creator + mint) |
| Base fee | 5,000 lam | 10,000 lam |
| CU limit | 1,000 | 300,000 |
| CU typical | ~600 | ~80,000 |
| Priority (default 2M µlam/CU) | ~1,200 lam | ~160,000 lam |
| Rent transfer (funder → creator) | `RENT_SOL` × 1e9 (default 35,000,000 lam) | — |
| Jito tip (funder → tip account) | `JITO_TIP` × 1e9 (default 5,000,000 lam) | — |
| pump.fun create rent (Tx2 consumes) | — | ~22,000,000 lam |
| **Cost paid by this tx's fee payer** | ~5,006,200 lam ≈ **0.00500 SOL** | ~170,000 lam ≈ **0.00017 SOL** |

The creator only pays Tx2's base fee + priority — its rent is funded
by Tx1's transfer. The funder's `RENT_SOL` covers Tx2's pump.fun rent
(~0.022 SOL) plus a small surplus to leave the creator with the
system-account rent-exempt minimum.

**Total funder outlay:** `RENT_SOL + JITO_TIP + Tx1 fee` ≈
**0.0401 SOL** with defaults (0.035 + 0.005 + 0.0001).

**Total creator outlay:** Tx2 base + priority ≈ **0.00017 SOL**
(consumed from the rent transfer; the creator wallet ends Tx2 holding
the system rent floor).

A `DEV_BUY_SOL > 0` adds that amount to the funder side and inflates
Tx2 CU usage by ~20K.

## `fire-atomic-create.js` — single-tx create-only launch

No Jito; one tx, two signers (funder + creator + mint = 3 signatures
since funder is fee payer). Funder transfers `RENT_SOL` to creator in
the same tx and then runs `createV2`.

| Component | Value |
|---|---:|
| Signatures | 3 (funder + creator + mint) |
| Base fee | 15,000 lam |
| CU limit | 300,000 (`CU_LIMIT`) |
| Priority (3M µlam/CU × ~80K CU) | ~240,000 lam |
| Rent transfer (funder → creator, in-tx) | `RENT_SOL` × 1e9 |
| pump.fun create rent | ~22,000,000 lam |
| Jito tip | 0 (no Jito) |
| **Total funder outlay** | `RENT_SOL` + ~0.00026 SOL |

With defaults: **~0.03526 SOL**. Cheaper than `fire-jito` because no
Jito tip — at the cost of the creator wallet *not* being the create
tx's fee payer (Solscan "from" will show the funder).

## `collect-jito.js` — atomic creator-fee collection

One tx in a Jito bundle: funder pays fee + tip; creator signs the
collect ix(s) + the drain transfer.

| Component | Value |
|---|---:|
| Signatures | 2 (funder + creator) |
| Base fee | 10,000 lam |
| CU limit | 100,000 |
| Priority (3M µlam/CU × ~60K CU) | ~180,000 lam |
| Jito tip | `JITO_TIP` × 1e9 (default 5,000,000 lam) |
| ATA rent (if vault ATAs new) | ~0 (cached by pump) |
| **Funder outlay** | ~5,190,000 lam ≈ **0.00519 SOL** |
| **Creator outlay** | 0 (creator wallet drained in-tx; reset to `BUFFER_LAMPORTS`) |

Vault size doesn't change the cost — collecting 0.01 SOL or 10 SOL
both cost the funder ~0.005 SOL. Below ~0.005 SOL of accrued fees,
collecting is a net loss; the script aborts below 0.001 SOL.

## `watch-collect.js` — long-running poller

No direct SOL cost — it spawns `collect-jito.js` when the vault
crosses `MIN_COLLECT_SOL`. Cost per day = (collects per day) ×
(per-collect cost).

Examples:
- High-volume coin, vault crosses 0.05 SOL every 4 hours → 6 collects/day → **~0.030 SOL/day** in funder spend.
- Low-volume coin, vault crosses 0.05 SOL every 3 days → ~0.33 collects/day → **~0.0017 SOL/day**.

If `MIN_COLLECT_SOL` is set too low (e.g. 0.005), each collect costs
the same as the threshold — the script aborts internally below 0.001
SOL of accrued fees, but cost-effectiveness drops to nothing.
**Practical floor:** `MIN_COLLECT_SOL ≥ 5 × JITO_TIP` (so collects
keep ≥80% of the harvested SOL).

## `consolidate.js` — one-shot drain of vault + both wallets

One bundle tx: collect vault into creator, drain creator → destination
(less rent buffer), drain funder → destination (less small buffer).

| Component | Value |
|---|---:|
| Signatures | 2 (funder + creator) |
| Base fee | 10,000 lam |
| Priority (2M µlam/CU × ~80K CU) | ~160,000 lam |
| Jito tip | 5,000,000 lam |
| **Funder outlay** | ~5,170,000 lam ≈ **0.00517 SOL** (then the entire remaining funder balance also moves to destination, less ~0.005 SOL buffer) |
| **Creator outlay** | Same as collect — wallet ends at rent floor |
| Net SOL delivered to destination | funder_balance + creator_balance + vault_balance − (~0.011 SOL of fees, tips, and buffers) |

Use this once per coin lifecycle.

## `buy-jito.js` — Jupiter-routed buy via Jito bundle

Two-tx bundle: funder transfers `BUY_SOL` to buyer + tip; buyer runs
Jupiter swap.

| Component | Value |
|---|---:|
| Tx1 (funder) signatures | 1 |
| Tx2 (buyer) signatures | 1 |
| Base fees | 10,000 lam total |
| Priority (across both txs) | ~250,000 lam combined |
| Jupiter platform fee | 0–25 bps depending on route (set in Jupiter quote) |
| Slippage cost | ≤ `SLIPPAGE_BPS` of `BUY_SOL` (default 500 bps = 5%) |
| Jito tip | 5,000,000 lam |
| **Total funder outlay** | `BUY_SOL × 1e9 + JITO_TIP × 1e9 + ~0.00026 SOL` |
| **Buyer net token outlay** | `BUY_SOL` minus Jupiter fees, slippage, and Solana fees |

With defaults (`BUY_SOL=0.01`, `JITO_TIP=0.005`): funder spends
~**0.01526 SOL**, of which 0.01 lands on `TARGET_MINT` (modulo
slippage).

## `rescue-tokens.js` — atomic SPL/Token-2022 transfer

One bundle tx: funder pays fee + tip + (if needed) destination ATA
rent; source wallet signs the token transfer.

| Component | Value |
|---|---:|
| Signatures | 2 (funder + source) |
| Base fee | 10,000 lam |
| Priority | ~150,000 lam |
| Destination ATA rent (only if ATA is new) | ~2,039,280 lam ≈ 0.00204 SOL |
| Jito tip | 5,000,000 lam |
| **Funder outlay (new ATA)** | ~7,200,000 lam ≈ **0.0072 SOL** |
| **Funder outlay (existing ATA)** | ~5,160,000 lam ≈ **0.00516 SOL** |
| **Source wallet outlay** | 0 |

## `distribute.js` — USDC rewards airdrop

Largest cost surface; lots of moving parts. Order of operations:

1. **Collect** creator vault → creator wallet
   - 1 tx, paid by creator; ~10,000 lam fee + 100,000 µlam/CU priority × ~60K CU ≈ **~16,000 lam**
2. **Jupiter swap** SOL → USDC for `REWARD_PERCENT` of newly collected SOL
   - 1 tx, paid by creator; Jupiter sets priority (100,000 µlam/CU); ~10,000 lam fee + ~50,000 lam priority ≈ **~60,000 lam**
   - Slippage cost ≤ `SLIPPAGE_BPS` (default 100 bps = 1%)
3. **Airdrop** in batches of 8 USDC transfers per tx
   - Each batch tx: 1 signature × 5,000 lam + 8 × `createTransferCheckedInstruction` ≈ 100K CU × 100K µlam/CU ≈ **~15,000 lam per batch**
   - For N holders: ⌈N / 8⌉ batches

**Worked example:** 240 eligible holders, 1 SOL collected, 80% rewarded.
- Collect: 0.000016 SOL
- Swap (0.8 SOL → ~$X USDC): 0.00006 SOL + ~1% slippage on 0.8 SOL ≈ 0.008 SOL
- Airdrop: 30 batches × 0.000015 SOL = 0.00045 SOL
- **Total SOL spend:** ~0.0085 SOL (mostly slippage)
- USDC airdropped: ~99% of swap output

`DRY_RUN=1` prints the plan without sending any tx.

## `grind.js` — vanity-address grinder

Zero on-chain cost — pure CPU. Power consumption is the only meter.
Expected attempts for an N-character prefix: ~58ᴺ. With 8 worker
threads on a modern CPU (~3M attempts/sec total): a 5-character
prefix takes ~3 minutes; 6 characters takes ~3 hours.

## Sensitivity

The defaults assume a quiet mainnet. Two knobs dominate cost in
contested markets:

- **`JITO_TIP`.** The default 0.005 SOL is the published floor.
  During heavy launch periods, bumping to **0.01–0.02 SOL** is what
  separates a landed bundle from `Invalid`. This roughly doubles or
  quadruples the per-operation cost of any `*-jito.js` script.
- **`PRIORITY`.** At 2M–3M µlamports/CU the priority fee is ~0.0002
  SOL/tx with typical CU usage. Raising 10× to 30M µlam/CU brings
  it to ~0.002 SOL/tx — still small relative to the tip, but
  visible if you're running `watch-collect.js` at high frequency.

## Total operating cost — sample profiles

| Profile | Cost/month |
|---|---:|
| One launch + abandon | ~0.04 SOL one-time |
| Launch + low-volume coin (1 collect/week) | ~0.04 SOL + 4 × 0.005 ≈ 0.06 SOL/mo |
| Launch + high-volume coin (4 collects/day) | ~0.04 SOL + 120 × 0.005 ≈ 0.64 SOL/mo |
| Distribute weekly to 200 holders, 0.5 SOL/run | ~4 × 0.005 ≈ 0.02 SOL/mo + ~4 × ~0.5% slippage |
| Full lifecycle (launch → 30 days watch → consolidate) | ~0.04 + watch costs + 0.005 ≈ 0.05–0.7 SOL |

At 100–250 USD/SOL, the upper-bound watch-collect month is the line
item most worth tuning — raise `MIN_COLLECT_SOL` to amortize.

## See also

- [`docs/operations/rpc-budget.md`](rpc-budget.md) — RPC call count
  per script and endpoint-plan sizing.
- [`docs/setup.md`](../setup.md) — picking values for `JITO_TIP` and
  `PRIORITY` in live conditions.
- [`docs/architecture.md`](../architecture.md) — why the bundle
  layouts split costs the way they do.
- [`TROUBLESHOOTING.md`](../../TROUBLESHOOTING.md) — what to do when
  a tip-floor change makes your bundles drop.
