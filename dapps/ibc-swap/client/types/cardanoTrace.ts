export interface CardanoAssetDenomTrace {
  assetId: string;
  kind: 'native' | 'ibc_voucher';
  path: string;
  baseDenom: string;
  fullDenom: string;
  voucherTokenName: string | null;
  voucherPolicyId: string | null;
  ibcDenomHash: string | null;
  displayName: string;
  displaySymbol: string;
  displayDescription: string;
}
