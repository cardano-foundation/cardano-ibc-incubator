export const CARDANO_WALLET_STORAGE_KEY = 'cardano-wallet';

export const CARDANO_WALLET_LOCKED_MESSAGE =
  'Your Cardano wallet is locked. Open the wallet extension and unlock it, then retry the action in the dapp.';
export const CARDANO_WALLET_LOCKED_TOAST_ID = 'cardano-wallet-locked';

type CardanoWalletErrorDetails = {
  name?: string;
  message?: string;
  info?: string;
  code?: string;
};

type CardanoWalletErrorContext = {
  phase?: 'connect' | 'sign' | 'submit';
};

const getErrorDetails = (error: unknown): CardanoWalletErrorDetails => {
  if (typeof error === 'string') return { message: error };
  if (error instanceof Error) {
    const extra = error as Error & {
      info?: unknown;
      code?: unknown;
      cause?: unknown;
    };

    return {
      name: error.name,
      message: error.message,
      info:
        extra.info === undefined || extra.info === null
          ? undefined
          : String(extra.info),
      code:
        extra.code === undefined || extra.code === null
          ? undefined
          : String(extra.code),
    };
  }
  if (!error || typeof error !== 'object') return {};

  const maybeError = error as {
    name?: unknown;
    message?: unknown;
    info?: unknown;
    code?: unknown;
  };

  return {
    name:
      maybeError.name === undefined || maybeError.name === null
        ? undefined
        : String(maybeError.name),
    message:
      maybeError.message === undefined || maybeError.message === null
        ? undefined
        : String(maybeError.message),
    info:
      maybeError.info === undefined || maybeError.info === null
        ? undefined
        : String(maybeError.info),
    code:
      maybeError.code === undefined || maybeError.code === null
        ? undefined
        : String(maybeError.code),
  };
};

const getNestedErrorText = (error: unknown): string[] => {
  const details = getErrorDetails(error);
  return [details.message, details.info, details.name, details.code]
    .filter((value) => value !== undefined && value !== null)
    .map(String);
};

export const isCardanoWalletLockedError = (error: unknown): boolean =>
  getNestedErrorText(error).some((value) =>
    value.toLowerCase().includes('wallet is locked'),
  );

const isTxSignError = (details: CardanoWalletErrorDetails): boolean =>
  [details.name, details.message, details.info].some((value) =>
    value?.toLowerCase().includes('txsignerror'),
  );

const isTxSubmitError = (details: CardanoWalletErrorDetails): boolean =>
  [details.name, details.message, details.info].some((value) =>
    value?.toLowerCase().includes('txsubmiterror'),
  );

const isUserDeclinedError = (details: CardanoWalletErrorDetails): boolean =>
  [details.message, details.info, details.name].some((value) => {
    const normalized = value?.toLowerCase() || '';
    return (
      normalized.includes('user declined') ||
      normalized.includes('user rejected') ||
      normalized.includes('user denied') ||
      normalized.includes('cancelled') ||
      normalized.includes('canceled')
    );
  });

const walletErrorDetail = (
  details: CardanoWalletErrorDetails,
): string | undefined =>
  [details.message, details.info]
    .map((value) => value?.trim())
    .find((value) => value && value !== details.name);

export const getCardanoWalletErrorMessage = (
  error: unknown,
  context: CardanoWalletErrorContext = {},
): string => {
  if (isCardanoWalletLockedError(error)) {
    return CARDANO_WALLET_LOCKED_MESSAGE;
  }

  const details = getErrorDetails(error);
  const detail = walletErrorDetail(details);

  if (isUserDeclinedError(details)) {
    return 'Cardano wallet signing was cancelled in the wallet extension.';
  }

  if (context.phase === 'sign' || isTxSignError(details)) {
    return detail
      ? `Cardano wallet could not sign the transaction: ${detail}`
      : 'Cardano wallet could not sign the transaction. The wallet returned TxSignError without details; unlock the wallet, confirm it is on Cardano Preprod with the selected account, then retry.';
  }

  if (context.phase === 'submit' || isTxSubmitError(details)) {
    return detail
      ? `Cardano wallet could not submit the signed transaction: ${detail}`
      : 'Cardano wallet could not submit the signed transaction. The wallet returned TxSubmitError without details; retry and check the wallet extension for the rejection reason.';
  }

  const message = [details.message, details.info, details.name, details.code]
    .map((value) => value?.trim())
    .find(Boolean);
  return message || 'Cardano wallet request failed.';
};

export const forgetStoredCardanoWallet = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CARDANO_WALLET_STORAGE_KEY);
};
