export type TokenPresentation = {
  tokenId?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenDisplayName?: string;
  tokenTrace?: string;
  cardanoAssetStatus?:
    | 'native'
    | 'verified-voucher'
    | 'unresolved-voucher'
    | 'invalid';
  tokenDisabledReason?: string;
  tokenDescription?: string;
  tokenLogo?: string;
  tokenExponent?: number;
  balance?: string;
};
