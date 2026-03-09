export const ENTRYPOINT_CHAIN_ID = 'entrypoint';
export const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
export const DEFAULT_PFM_FEE = '0.100000000000000000';

export type IbcDenomTrace = Record<
  string,
  {
    path: string;
    baseDenom: string;
  }
>;

export type AvailableChannel = {
  destChain: string;
  destChannel: string;
  destPort: string;
};

export type SwapRoute = {
  route: Array<{ pool_id: string; token_out_denom: string }>;
  inToken: string;
  outToken: string;
};

export type SwapMetadata = {
  allChannelMappings: Record<string, AvailableChannel>;
  availableChannelsMap: Record<string, AvailableChannel>;
  pfmFees: Record<string, bigint>;
  osmosisDenomTraces: IbcDenomTrace;
  routeMap: SwapRoute[];
};

export type TokenTrace = {
  path: string;
  base_denom: string;
  origin_denom: string;
};

export type MatchResult = {
  match: boolean;
  chains: string[];
  routes: string[];
  fromToken: TokenTrace | null;
  toToken: { path: string; base_denom: string } | null;
};

export type RouteTraceBack = {
  chains: string[];
  routes: string[];
  counterRoutes: string[];
  paths: string[];
};

export type SwapCandidate = {
  route: Array<{ pool_id: string; token_out_denom: string }>;
  outToken: string;
  transferRoutes: string[];
  transferBackRoutes: string[];
  transferChains: string[];
};

export type SwapOptionToken = {
  token_id: string;
  token_name: string;
  token_logo: string | null;
};

export type SwapOptionsResponse = {
  from_chain_id: string;
  from_chain_name: string;
  to_chain_id: string;
  to_chain_name: string;
  to_tokens: SwapOptionToken[];
};

export type SwapEstimateRequest = {
  fromChainId: string;
  tokenInDenom: string;
  tokenInAmount: string;
  toChainId: string;
  tokenOutDenom: string;
};

export type SwapEstimateResponse = {
  message: string;
  tokenOutAmount: string;
  tokenOutTransferBackAmount: string;
  tokenSwapAmount: string;
  outToken: string | null;
  transferRoutes: string[];
  transferBackRoutes: string[];
  transferChains: string[];
};
