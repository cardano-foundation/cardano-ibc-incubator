// Validity windows for unsigned txs (ms). Keep within the forecast safe-zone while allowing slow blocks on devnet.
export const TRANSACTION_TIME_TO_LIVE = 120_000; // 2 minutes

// Reserve enough collateral for staged finalization, including reference-script
// fees and the final collateral-return encoding. Lucid 0.4 estimates its automatic
// collateral before those final bytes; a 5 ADA floor underfunded a live update.
// This remains below Hermes's default 10 ADA loss limit.
export const TRANSACTION_SET_COLLATERAL = 8_000_000n; // 8 ADA
