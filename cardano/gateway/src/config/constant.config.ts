// Validity windows for unsigned txs (ms). Keep within the forecast safe-zone while allowing slow blocks on devnet.
export const TRANSACTION_TIME_TO_LIVE = 120_000; // 2 minutes

// Collateral floor used by Lucid, below Hermes's default 10 ADA loss limit.
// Lucid raises this when the ledger-required fee percentage is higher.
export const TRANSACTION_SET_COLLATERAL = 5_000_000n; // 5 ADA
