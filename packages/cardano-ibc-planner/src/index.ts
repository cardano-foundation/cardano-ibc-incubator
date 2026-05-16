export type ResolvedCardanoAssetTrace = {
  path: string;
  baseDenom: string;
  fullDenom: string;
};

export type TransferPlanRequest = {
  fromChainId: string;
  toChainId: string;
  tokenDenom: string;
  expectedChainPath?: string[];
};

export type MissingTransferRouteHop = {
  fromChainId: string;
  toChainId: string;
  reason:
    | 'no-outbound-channel'
    | 'no-channel-to-destination'
    | 'blocked-by-visited-chain';
  availableDestChainIds: string[];
};

export type TransferRouteDiagnostics = {
  expectedChainPath: string[];
  missingHops: MissingTransferRouteHop[];
};

export type TransferPlanResponse = {
  foundRoute: boolean;
  mode: 'same-chain' | 'native-forward' | 'unwind' | 'unwind-then-forward' | null;
  chains: string[];
  routes: string[];
  tokenTrace: {
    kind: 'native' | 'ibc_voucher';
    path: string;
    baseDenom: string;
    fullDenom: string;
  } | null;
  failureCode?:
    | 'invalid-request'
    | 'missing-unwind-hop'
    | 'ambiguous-unwind-hop'
    | 'no-forward-route'
    | 'ambiguous-forward-route'
    | 'ambiguous-forward-hop'
    | 'channels-not-loaded'
    | 'source-chain-unavailable'
    | 'destination-chain-unavailable'
    | 'no-outbound-channels'
    | 'no-route-found'
    | 'direct-route-unsupported';
  failureMessage?: string;
  routeDiagnostics?: TransferRouteDiagnostics;
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

export type PlannerClientConfig = {
  cardanoChainId: string;
  cardanoRestEndpoint?: string;
  localOsmosisRestEndpoint: string;
  swapRouterAddress?: string;
  preferredChannels?: PreferredChannel[];
  resolveCardanoAssetDenomTrace?: (
    assetId: string,
  ) => Promise<ResolvedCardanoAssetTrace | null>;
  fetchImpl?: typeof fetch;
};

export type PreferredChannel = {
  fromChainId: string;
  toChainId: string;
  srcPort: string;
  srcChannel: string;
};

export type PlannerClient = {
  planTransferRoute: (
    request: TransferPlanRequest,
  ) => Promise<TransferPlanResponse>;
  getLocalOsmosisSwapOptions: () => Promise<SwapOptionsResponse>;
  estimateLocalOsmosisSwap: (
    request: SwapEstimateRequest,
  ) => Promise<SwapEstimateResponse>;
};

const DIRECT_ROUTE_UNSUPPORTED =
  'Direct Cardano-to-target IBC routes are not implemented yet.';

export function createPlannerClient(config: PlannerClientConfig): PlannerClient {
  return {
    async planTransferRoute(request) {
      if (!request.fromChainId || !request.toChainId || !request.tokenDenom) {
        return {
          foundRoute: false,
          mode: null,
          chains: [],
          routes: [],
          tokenTrace: null,
          failureCode: 'invalid-request',
          failureMessage: 'fromChainId, toChainId, and tokenDenom are required.',
        };
      }

      if (request.fromChainId === request.toChainId) {
        return {
          foundRoute: true,
          mode: 'same-chain',
          chains: [request.fromChainId],
          routes: [],
          tokenTrace: {
            kind: 'native',
            path: '',
            baseDenom: request.tokenDenom,
            fullDenom: request.tokenDenom,
          },
        };
      }

      return {
        foundRoute: false,
        mode: null,
        chains: [request.fromChainId, request.toChainId],
        routes: [],
        tokenTrace: null,
        failureCode: 'direct-route-unsupported',
        failureMessage: `${DIRECT_ROUTE_UNSUPPORTED} The former intermediary-chain route has been phased out.`,
        routeDiagnostics: {
          expectedChainPath: request.expectedChainPath || [
            request.fromChainId,
            request.toChainId,
          ],
          missingHops: [
            {
              fromChainId: request.fromChainId,
              toChainId: request.toChainId,
              reason: 'no-channel-to-destination',
              availableDestChainIds: [],
            },
          ],
        },
      };
    },

    async getLocalOsmosisSwapOptions() {
      return {
        from_chain_id: config.cardanoChainId,
        from_chain_name: 'Cardano',
        to_chain_id: 'localosmosis',
        to_chain_name: 'Local Osmosis',
        to_tokens: [],
      };
    },

    async estimateLocalOsmosisSwap() {
      return {
        message: `${DIRECT_ROUTE_UNSUPPORTED} Swap estimation is disabled until direct routes exist.`,
        tokenOutAmount: '0',
        tokenOutTransferBackAmount: '0',
        tokenSwapAmount: '0',
        outToken: null,
        transferRoutes: [],
        transferBackRoutes: [],
        transferChains: [],
      };
    },
  };
}
