// Launch-mode options shared by the pump.fun launchers (fire-jito.js,
// fire-atomic-create.js).
//
// Pump program rules these options follow (@pump-fun/pump-sdk 4):
//   - create_v2 rejects new cashback coins (Pump error 6082). The SDK's
//     createV2Instruction encodes the flag as given and only the
//     create-and-buy builders throw CashbackDeprecatedError, so this module
//     refuses CASHBACK=true itself before any bundle is built.
//   - holder-reward coins route the creator fee to holderRewardsPda(mint)
//     instead of the creator wallet, and create_v2 rejects them with 6084
//     while Global.isHolderRewardEnabled is false.
//
// Env:
//   HOLDER_REWARD  true|false (default false). Launch a holder-reward coin.
//   CASHBACK       rejected when truthy. Kept only to fail loudly for old configs.

const { holderRewardsPda } = require('@pump-fun/pump-sdk');

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['', '0', 'false', 'no', 'off']);

/**
 * Parse a boolean env flag. Unset or empty is false; anything outside the
 * recognized spellings throws, so a typo never silently picks a launch mode.
 * @param {string} name
 * @param {string | undefined} raw
 * @returns {boolean}
 */
function parseBooleanFlag(name, raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  throw new Error(`${name} must be true or false, got "${raw}".`);
}

/**
 * Resolve launch-mode options from the environment.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ holderReward: boolean }}
 */
function resolveLaunchOptions(env = process.env) {
  if (parseBooleanFlag('CASHBACK', env.CASHBACK)) {
    throw new Error(
      'CASHBACK=true is no longer supported: the Pump program 2.0 rejects new cashback coins ' +
      '(create_v2 error 6082). Remove CASHBACK, or set HOLDER_REWARD=true to route creator fees ' +
      'to the coin\'s holders instead.',
    );
  }
  return { holderReward: parseBooleanFlag('HOLDER_REWARD', env.HOLDER_REWARD) };
}

/**
 * Refuse a holder-reward launch while the Pump program has it disabled, so the
 * scripts stop before spending a Jito tip or a fee on a create_v2 that fails
 * on-chain with 6084.
 * @param {{ holderReward: boolean }} options
 * @param {{ isHolderRewardEnabled?: boolean }} global Pump Global account
 */
function assertLaunchOptionsAllowed(options, global) {
  if (options.holderReward && !global.isHolderRewardEnabled) {
    throw new Error(
      'HOLDER_REWARD=true, but holder-reward coin creation is disabled in the Pump Global account ' +
      '(create_v2 would fail with 6084). Launch without HOLDER_REWARD, or retry once pump.fun enables it.',
    );
  }
}

/**
 * Describe where the coin's creator fees will accrue, for the launch log.
 * @param {{ holderReward: boolean }} options
 * @param {import('@solana/web3.js').PublicKey} mint
 * @param {import('@solana/web3.js').PublicKey} creator
 * @returns {string}
 */
function describeFeeRecipient(options, mint, creator) {
  if (options.holderReward) {
    return `holder rewards PDA ${holderRewardsPda(mint).toBase58()} (paid out to holders by pump.fun, not collectable by the creator)`;
  }
  return `creator ${creator.toBase58()}`;
}

module.exports = {
  parseBooleanFlag,
  resolveLaunchOptions,
  assertLaunchOptionsAllowed,
  describeFeeRecipient,
};
