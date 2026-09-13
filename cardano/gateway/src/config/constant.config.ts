// Validity windows for unsigned txs (ms). Keep within the forecast safe-zone while allowing slow blocks on devnet.
export const TRANSACTION_TIME_TO_LIVE = 120_000; // 2 minutes

// Lucid's normal target stays within Hermes' 10 ADA collateral limit.
// Lucid still raises this when the ledger-required percentage of fees is higher.
export const TRANSACTION_SET_COLLATERAL = 5_000_000n; // 5 ADA
