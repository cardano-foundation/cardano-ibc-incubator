function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

// Validity windows for unsigned txs (ms). The historical 2-minute default is too tight for
// remote/preprod flows where transaction completion, Hermes signing, and relay submission can
// consume a meaningful share of the window before the node even sees the final tx.
export const TRANSACTION_TIME_TO_LIVE = parsePositiveIntEnv(
  process.env.CARDANO_TRANSACTION_TTL_MS,
  600_000,
);

// How long submission confirmation may wait for the history/indexing backend.
export const TRANSACTION_CONFIRMATION_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.CARDANO_TRANSACTION_CONFIRMATION_TIMEOUT_MS,
  Math.max(900_000, TRANSACTION_TIME_TO_LIVE + 300_000),
);

// Target collateral (lovelace) used by Lucid during tx completion.
// This must be comfortably above the ledger-required collateral for Plutus scripts.
export const TRANSACTION_SET_COLLATERAL = 20_000_000n; // 20 ADA
