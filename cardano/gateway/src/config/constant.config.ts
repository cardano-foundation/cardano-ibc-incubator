// Validity windows for unsigned txs (ms). Local devnet keeps a short window
// within its forecast safe-zone; public networks can go minutes between blocks.
export const TRANSACTION_TIME_TO_LIVE = 120_000; // 2 minutes
export const PUBLIC_NETWORK_TRANSACTION_TIME_TO_LIVE = 5 * 60_000;

export function isPublicCardanoNetwork(network: string | undefined): boolean {
  return network === 'Preview' || network === 'Preprod' || network === 'Mainnet';
}

export function transactionTimeToLive(network: string | undefined): number {
  return isPublicCardanoNetwork(network) ? PUBLIC_NETWORK_TRANSACTION_TIME_TO_LIVE : TRANSACTION_TIME_TO_LIVE;
}

// Reserve enough collateral for staged finalization, including reference-script
// fees and the final collateral-return encoding. Lucid 0.4 estimates its automatic
// collateral before those final bytes; a 5 ADA floor underfunded a live update.
// This remains below Hermes's default 10 ADA loss limit.
export const TRANSACTION_SET_COLLATERAL = 8_000_000n; // 8 ADA
