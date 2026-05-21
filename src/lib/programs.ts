/**
 * Pump.fun program constants used by funding-source detection.
 *
 * Only the subset of constants needed for `detectSeededByPump` lives here.
 * Add more if/when new lib code requires them.
 */

/** PumpFun fee recipient account (legacy — pre-April-28 2025 upgrade) */
export const PUMPFUN_FEE_ACCOUNT = 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJ5GEFDM97zC';

/**
 * Pump fee recipients added in the April 28 2025 program upgrade.
 * Buy/sell instructions now include one of these at the end of the accounts list
 * (bonding curve: after bonding-curve-v2; AMM: two accounts after pool-v2).
 */
export const PUMP_FEE_RECIPIENTS = [
  '5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD',
  '9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7',
  'GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL',
  '3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR',
  '5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6',
  'EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL',
  '5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD',
  'A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW',
] as const;

/** Set of all pump fee recipients for O(1) membership checks */
export const PUMP_FEE_RECIPIENT_SET = new Set<string>([
  PUMPFUN_FEE_ACCOUNT,
  ...PUMP_FEE_RECIPIENTS,
]);

/** PumpFun migration authority */
export const PUMPFUN_MIGRATION_AUTHORITY =
  '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
