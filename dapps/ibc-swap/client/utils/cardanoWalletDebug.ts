type DebugDetails = Record<string, unknown>;

const PREFIX = '[cardano-wallet-debug]';

export const shortValue = (value: unknown, visibleCharacters = 10): unknown => {
  if (typeof value !== 'string') return value;
  if (value.length <= visibleCharacters * 2 + 8) return value;
  return `${value.slice(0, visibleCharacters)}...${value.slice(
    -visibleCharacters,
  )} (${value.length} chars)`;
};

export const describeCardanoWalletError = (error: unknown): DebugDetails => {
  if (typeof error === 'string') return { message: error };
  if (!error || typeof error !== 'object') return { value: String(error) };

  const candidate = error as {
    name?: unknown;
    message?: unknown;
    info?: unknown;
    code?: unknown;
    stack?: unknown;
  };

  return {
    name: candidate.name,
    message: candidate.message,
    info: candidate.info,
    code: candidate.code,
  };
};

const sanitizeDetails = (details: DebugDetails): DebugDetails =>
  Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, shortValue(value)]),
  );

export const logCardanoWalletDebug = (
  step: string,
  details: DebugDetails = {},
) => {
  if (typeof window === 'undefined') return;
  console.info(PREFIX, step, sanitizeDetails(details));
};

export const logCardanoWalletError = (
  step: string,
  error: unknown,
  details: DebugDetails = {},
) => {
  if (typeof window === 'undefined') return;
  console.error(PREFIX, step, {
    ...sanitizeDetails(details),
    error: describeCardanoWalletError(error),
  });
};
