import { NetworkItemProps } from '@/components/NetworkItem/NetworkItem';
import type { TokenPresentation } from './token';

export type SwapTokenType = TokenPresentation & {
  tokenId: string;
  tokenName: string;
  tokenLogo: string;
  swapAmount?: string;
  network: NetworkItemProps;
};

export type SwapDataType = {
  fromToken: SwapTokenType;
  toToken: SwapTokenType;
  receiveAdrress?: string;
  slippageTolerance?: string;
};
