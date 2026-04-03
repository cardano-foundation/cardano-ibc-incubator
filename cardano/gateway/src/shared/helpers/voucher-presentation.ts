export type VoucherPresentation = {
  displayName: string;
  displaySymbol: string;
  displayDescription: string;
};

export function deriveVoucherPresentation(fullDenom: string, baseDenom: string): VoucherPresentation {
  const trimmedBaseDenom = baseDenom.trim();
  const baseLabel = trimmedBaseDenom.includes('/')
    ? trimmedBaseDenom.split('/').filter(Boolean).at(-1) ?? trimmedBaseDenom
    : trimmedBaseDenom;

  const normalizedSymbol = normalizeDisplaySymbol(baseLabel);
  return {
    displayName: `${normalizedSymbol} (IBC)`,
    displaySymbol: normalizedSymbol,
    displayDescription: `IBC voucher for ${fullDenom}`,
  };
}

function normalizeDisplaySymbol(baseLabel: string): string {
  if (!baseLabel) {
    return 'IBC';
  }

  if (/^u[a-z0-9]+$/i.test(baseLabel) && baseLabel.length > 1) {
    return baseLabel.slice(1).toUpperCase();
  }

  return baseLabel.toUpperCase();
}
