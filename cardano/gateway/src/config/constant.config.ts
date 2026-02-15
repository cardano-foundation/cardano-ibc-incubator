// Validity windows for unsigned txs (ms). Keep within the forecast safe-zone while allowing slow blocks on devnet.
export const TRANSACTION_TIME_TO_LIVE = 120_000; // 2 minutes

// Target collateral (lovelace) used by Lucid during tx completion.
// This must be comfortably above the ledger-required collateral for Plutus scripts.
export const TRANSACTION_SET_COLLATERAL = 20_000_000n; // 20 ADA
