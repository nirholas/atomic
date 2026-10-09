// Creator-fee sweeps for the collect scripts (collect-jito, consolidate,
// distribute, watch-collect and examples 03 / 04).
//
// Since the October 2026 Pump upgrade the new trade instructions (Pump
// buy_v3 / sell_v3, PumpSwap buy_v2 / sell_v2, multi_hop_swap) no longer pay
// the creator fee out on every trade. They leave it waiting on the coin:
//   - Pump:     BondingCurve.creator_fee (lamports on the curve for SOL coins)
//   - PumpSwap: Pool.creator_fees (wrapped SOL in the pool's quote vault)
// The creator vault only receives it after the permissionless
// sweep_creator_fee instruction runs. A collect that skips the sweep still
// succeeds, it just leaves every fee from the new instructions behind, so the
// scripts put the sweeps first in the same transaction as the collect.
//
// Sweeps are per coin (the fee waits on the coin's curve and pool, not on the
// creator), which is why the collect scripts take the creator's coins in
// MINTS. These helpers only handle SOL-paired coins: collectCoinCreatorFee
// instructions in @pump-fun/pump-sdk 4 collect the SOL vaults only, so
// sweeping a token-paired coin's fee would move it into a vault these
// scripts never drain.

const { PublicKey } = require('@solana/web3.js');
const { NATIVE_MINT, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const {
  PUMP_SDK,
  bondingCurvePda,
  canonicalPumpPoolPdaWithQuote,
  normalizeQuoteMint,
} = require('@pump-fun/pump-sdk');

// PumpSwap Pool layout (pump_amm IDL): 8-byte discriminator, pool_bump u8,
// index u16, creator, base_mint, quote_mint, lp_mint, pool_base_token_account,
// pool_quote_token_account (6 pubkeys), lp_supply u64, coin_creator pubkey,
// is_mayhem_mode bool, is_cashback_coin bool, virtual_quote_reserves i128,
// creator_fee_bps u64, can_edit_creator_fee bool, is_holder_reward bool,
// protocol_fees u64, creator_fees u64. Pools written before an upgrade are
// shorter; a missing trailing field reads as zero.
const POOL_COIN_CREATOR_OFFSET = 211;
const POOL_CREATOR_FEES_OFFSET = 279;

// Compute budget per sweep instruction. A sweep moves lamports or does one
// token transfer and may top up rent on a pre-upgrade account; 40k leaves
// headroom over what simulation shows.
const SWEEP_COMPUTE_UNITS = 40_000;

/**
 * Parse a comma- or whitespace-separated list of base58 mints. Duplicates are
 * dropped; an invalid entry throws so a typo never silently skips a coin.
 * @param {string | undefined} raw
 * @returns {PublicKey[]}
 */
function parseMintList(raw) {
  const seen = new Set();
  const mints = [];
  for (const entry of String(raw ?? '').split(/[\s,]+/)) {
    if (!entry) continue;
    let mint;
    try {
      mint = new PublicKey(entry);
    } catch {
      throw new Error(`MINTS contains an invalid mint address: "${entry}".`);
    }
    if (seen.has(mint.toBase58())) continue;
    seen.add(mint.toBase58());
    mints.push(mint);
  }
  return mints;
}

/**
 * Read the creator-fee fields of a PumpSwap Pool account.
 * @param {Buffer} data raw account data, discriminator included
 * @returns {{ coinCreator: PublicKey, creatorFees: bigint } | null} null when
 *   the account is too short to be a pool.
 */
function readPoolCreatorBucket(data) {
  if (data.length < POOL_COIN_CREATOR_OFFSET) return null;
  const coinCreator = data.length >= POOL_COIN_CREATOR_OFFSET + 32
    ? new PublicKey(data.subarray(POOL_COIN_CREATOR_OFFSET, POOL_COIN_CREATOR_OFFSET + 32))
    : PublicKey.default;
  const creatorFees = data.length >= POOL_CREATOR_FEES_OFFSET + 8
    ? data.readBigUInt64LE(POOL_CREATOR_FEES_OFFSET)
    : 0n;
  return { coinCreator, creatorFees };
}

/**
 * Read the creator fees the new trade instructions left waiting on each coin.
 *
 * @param {{
 *   connection: import('@solana/web3.js').Connection,
 *   creator: PublicKey,
 *   mints: PublicKey[],
 * }} params
 * @returns {Promise<{
 *   coins: Array<{ mint: PublicKey, curveCreatorFee: bigint, poolCreatorFees: bigint, poolCoinCreator: PublicKey | null }>,
 *   skipped: Array<{ mint: PublicKey, reason: string }>,
 *   curveLamports: bigint,
 *   poolLamports: bigint,
 * }>}
 *   `curveLamports` lands in the Pump creator vault as lamports once swept;
 *   `poolLamports` lands in the PumpSwap creator vault as wrapped SOL.
 */
async function readPendingCreatorFees({ connection, creator, mints }) {
  const coins = [];
  const skipped = [];
  if (mints.length === 0) return { coins, skipped, curveLamports: 0n, poolLamports: 0n };

  const curveInfos = await connection.getMultipleAccountsInfo(mints.map((mint) => bondingCurvePda(mint)), 'confirmed');
  const eligible = [];
  mints.forEach((mint, i) => {
    const info = curveInfos[i];
    const curve = info ? PUMP_SDK.decodeBondingCurveNullable(info) : null;
    if (!curve) {
      skipped.push({ mint, reason: 'no pump.fun bonding curve for this mint' });
      return;
    }
    if (!normalizeQuoteMint(curve.quoteMint).equals(NATIVE_MINT)) {
      skipped.push({ mint, reason: `paired with ${normalizeQuoteMint(curve.quoteMint).toBase58()}, these scripts collect SOL fees only` });
      return;
    }
    if (!curve.creator.equals(creator)) {
      skipped.push({ mint, reason: `creator is ${curve.creator.toBase58()}, not this wallet` });
      return;
    }
    eligible.push({ mint, curveCreatorFee: BigInt(curve.creatorFee.toString()) });
  });

  const poolInfos = eligible.length === 0
    ? []
    : await connection.getMultipleAccountsInfo(eligible.map(({ mint }) => canonicalPumpPoolPdaWithQuote(mint, NATIVE_MINT)), 'confirmed');

  let curveLamports = 0n;
  let poolLamports = 0n;
  eligible.forEach(({ mint, curveCreatorFee }, i) => {
    const pool = poolInfos[i] ? readPoolCreatorBucket(Buffer.from(poolInfos[i].data)) : null;
    // The pool sweep pays pool.coin_creator's vault. collectCoinCreatorFee
    // drains the creator's own vault, so a pool whose coin creator was moved
    // elsewhere is left alone.
    const poolCreatorFees = pool && pool.coinCreator.equals(creator) ? pool.creatorFees : 0n;
    if (pool && pool.creatorFees > 0n && !pool.coinCreator.equals(creator)) {
      skipped.push({ mint, reason: `pool fees belong to coin creator ${pool.coinCreator.toBase58()}` });
    }
    curveLamports += curveCreatorFee;
    poolLamports += poolCreatorFees;
    coins.push({ mint, curveCreatorFee, poolCreatorFees, poolCoinCreator: pool ? pool.coinCreator : null });
  });

  return { coins, skipped, curveLamports, poolLamports };
}

/**
 * Build the sweep instructions for the coins with fees waiting. Put them
 * before collectCoinCreatorFeeInstructions in the same transaction.
 *
 * @param {{ payer: PublicKey, creator: PublicKey, coins: Awaited<ReturnType<typeof readPendingCreatorFees>>['coins'] }} params
 * @returns {Promise<import('@solana/web3.js').TransactionInstruction[]>}
 */
async function creatorFeeSweepInstructions({ payer, creator, coins }) {
  const instructions = [];
  for (const coin of coins) {
    const common = { payer, mint: coin.mint, quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID };
    if (coin.curveCreatorFee > 0n) {
      instructions.push(await PUMP_SDK.sweepCreatorFeeInstruction({ ...common, creator }));
    }
    if (coin.poolCreatorFees > 0n) {
      instructions.push(await PUMP_SDK.sweepPoolCreatorFeeInstruction({ ...common, coinCreator: creator }));
    }
  }
  return instructions;
}

/**
 * Print what readPendingCreatorFees found, so an operator can see why a coin
 * was or was not swept.
 * @param {Awaited<ReturnType<typeof readPendingCreatorFees>>} pending
 */
function logPendingCreatorFees(pending) {
  for (const coin of pending.coins) {
    console.log(
      `  ${coin.mint.toBase58()}: ${Number(coin.curveCreatorFee) / 1e9} SOL waiting on the curve, ` +
      `${Number(coin.poolCreatorFees) / 1e9} SOL waiting in the pool`,
    );
  }
  for (const { mint, reason } of pending.skipped) {
    console.log(`  ${mint.toBase58()}: not swept (${reason})`);
  }
}

module.exports = {
  SWEEP_COMPUTE_UNITS,
  parseMintList,
  readPoolCreatorBucket,
  readPendingCreatorFees,
  creatorFeeSweepInstructions,
  logPendingCreatorFees,
};
