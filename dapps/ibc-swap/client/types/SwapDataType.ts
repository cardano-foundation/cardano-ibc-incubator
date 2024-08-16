import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';

export type SwapTokenType = {
  tokenId: string;
  tokenName: string;
  tokenLogo: string;
  balance?: string;
  tokenExponent?: number;
  swapAmount?: string;
  network: NetworkItemProps;
};

export type SwapDataType = {
  fromToken: SwapTokenType;
  toToken: SwapTokenType;
  receiveAdrress?: string;
  slippageTolerance?: string;
};
