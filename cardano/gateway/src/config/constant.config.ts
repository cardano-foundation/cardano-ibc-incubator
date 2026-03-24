// Validity windows for unsigned txs (ms). Local bridge handshakes can spend multiple minutes waiting
// on Mithril certification and then on Kupo/Ogmios to observe freshly-produced inputs, so 2 minutes
// is too short. Keep the window below the devnet era forecast horizon used by Ogmios evaluation.
export const TRANSACTION_TIME_TO_LIVE = 240_000; // 4 minutes

// Target collateral (lovelace) used by Lucid during tx completion.
// This must be comfortably above the ledger-required collateral for Plutus scripts.
export const TRANSACTION_SET_COLLATERAL = 20_000_000n; // 20 ADA
