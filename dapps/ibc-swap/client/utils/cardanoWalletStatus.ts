export const CARDANO_WALLET_STORAGE_KEY = 'cardano-wallet';

export const CARDANO_WALLET_LOCKED_MESSAGE =
  'Your Cardano wallet is locked. Unlock it in the wallet extension, then reconnect the Cardano wallet.';
export const CARDANO_WALLET_LOCKED_TOAST_ID = 'cardano-wallet-locked';

const getNestedErrorText = (error: unknown): string[] => {
  if (typeof error === 'string') return [error];
  if (error instanceof Error) return [error.name, error.message];
  if (!error || typeof error !== 'object') return [];

  const maybeError = error as {
    name?: unknown;
    message?: unknown;
    info?: unknown;
    code?: unknown;
  };

  return [maybeError.name, maybeError.message, maybeError.info, maybeError.code]
    .filter((value) => value !== undefined && value !== null)
    .map(String);
};

export const isCardanoWalletLockedError = (error: unknown): boolean =>
  getNestedErrorText(error).some((value) =>
    value.toLowerCase().includes('wallet is locked'),
  );

export const getCardanoWalletErrorMessage = (error: unknown): string => {
  if (isCardanoWalletLockedError(error)) {
    return CARDANO_WALLET_LOCKED_MESSAGE;
  }

  const message = getNestedErrorText(error).find((value) => value.trim());
  return message || 'Cardano wallet request failed.';
};

export const forgetStoredCardanoWallet = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CARDANO_WALLET_STORAGE_KEY);
};
