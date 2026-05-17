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
    | 'no-route-found';
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

const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
const QUERY_CHANNELS_PREFIX_URL = '/ibc/core/channel/v1/channels';
const QUERY_ALL_CHANNELS_URL =
  `${QUERY_CHANNELS_PREFIX_URL}?pagination.count_total=true&pagination.limit=10000`;
const QUERY_SWAP_ROUTER_STATE =
  '/cosmwasm/wasm/v1/contract/SWAP_ROUTER_ADDRESS/state?pagination.limit=100000000';
const SWAP_ROUTING_TABLE_PREFIX = '\x00\rrouting_table\x00D';
const BIGINT_ZERO = BigInt(0);

type QueryChannelResponse = {
  channel_id: string;
  port_id: string;
  state: string | number;
  counterparty: {
    channel_id: string;
    port_id: string;
  };
};

type QueryClientStateResponse = {
  identified_client_state?: {
    client_state?: {
      chain_id?: string;
    };
  };
};

type DirectOsmosisChannelPair = {
  cardanoChannel: string;
  osmosisChannel: string;
};

type SwapRoute = {
  route: Array<{ pool_id: string; token_out_denom: string }>;
  inToken: string;
  outToken: string;
};

type PlannerConfig = PlannerClientConfig & {
  fetchImpl: typeof fetch;
};

export function createPlannerClient(config: PlannerClientConfig): PlannerClient {
  const resolvedConfig: PlannerConfig = {
    ...config,
    fetchImpl: config.fetchImpl || fetch,
  };

  return {
    async planTransferRoute(request) {
      const fromChainId = request.fromChainId.trim();
      const toChainId = request.toChainId.trim();
      const tokenDenom = request.tokenDenom.trim();

      if (!fromChainId || !toChainId || !tokenDenom) {
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

      if (fromChainId === toChainId) {
        return {
          foundRoute: true,
          mode: 'same-chain',
          chains: [fromChainId],
          routes: [],
          tokenTrace: {
            kind: 'native',
            path: '',
            baseDenom: tokenDenom,
            fullDenom: tokenDenom,
          },
        };
      }

      const directPair = await fetchDirectOsmosisChannelPair(resolvedConfig);
      if (
        fromChainId === resolvedConfig.cardanoChainId &&
        toChainId === LOCAL_OSMOSIS_CHAIN_ID
      ) {
        if (!directPair) {
          return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
        }
        return {
          foundRoute: true,
          mode: 'native-forward',
          chains: [fromChainId, toChainId],
          routes: [`transfer/${directPair.cardanoChannel}`],
          tokenTrace: {
            kind: 'native',
            path: '',
            baseDenom: tokenDenom,
            fullDenom: tokenDenom,
          },
        };
      }

      if (
        fromChainId === LOCAL_OSMOSIS_CHAIN_ID &&
        toChainId === resolvedConfig.cardanoChainId
      ) {
        if (!directPair) {
          return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
        }
        return {
          foundRoute: true,
          mode: 'native-forward',
          chains: [fromChainId, toChainId],
          routes: [`transfer/${directPair.osmosisChannel}`],
          tokenTrace: {
            kind: tokenDenom.startsWith('ibc/') ? 'ibc_voucher' : 'native',
            path: '',
            baseDenom: tokenDenom,
            fullDenom: tokenDenom,
          },
        };
      }

      return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
    },

    async getLocalOsmosisSwapOptions() {
      const routeMap = await fetchCrossChainSwapRouterState(resolvedConfig);
      const toTokens = Array.from(
        new Set(routeMap.map((route) => route.outToken)),
      )
        .sort()
        .map((tokenId) => ({
          token_id: tokenId,
          token_name: tokenId,
          token_logo: null,
        }));

      return {
        from_chain_id: resolvedConfig.cardanoChainId,
        from_chain_name: 'Cardano',
        to_chain_id: LOCAL_OSMOSIS_CHAIN_ID,
        to_chain_name: 'Local Osmosis',
        to_tokens: toTokens,
      };
    },

    async estimateLocalOsmosisSwap(request) {
      if (
        !/^\d+$/.test(request.tokenInAmount) ||
        BigInt(request.tokenInAmount) <= BIGINT_ZERO
      ) {
        return buildEmptyEstimate('Input amount must be a positive integer amount.');
      }

      const directPair = await fetchDirectOsmosisChannelPair(resolvedConfig);
      if (!directPair) {
        return buildEmptyEstimate(
          'No direct Cardano-to-Osmosis transfer channel is available.',
        );
      }

      const routeMap = await fetchCrossChainSwapRouterState(resolvedConfig);
      const route = routeMap.find((candidate) =>
        candidate.outToken === request.tokenOutDenom ||
        candidate.outToken.toLowerCase() === request.tokenOutDenom.toLowerCase()
      );
      if (!route) {
        return buildEmptyEstimate('Cannot find match pool, please select another pair');
      }

      const estimate = await estimateSwapViaRest(
        resolvedConfig,
        request.tokenInAmount,
        route.inToken,
        route.route,
      );

      return {
        message: estimate.message,
        tokenOutAmount: estimate.tokenOutAmount.toString(),
        tokenOutTransferBackAmount: estimate.tokenOutAmount.toString(),
        tokenSwapAmount: estimate.tokenSwapAmount.toString(),
        outToken: route.outToken,
        transferRoutes: [`transfer/${directPair.cardanoChannel}`],
        transferBackRoutes: [`transfer/${directPair.osmosisChannel}`],
        transferChains: [resolvedConfig.cardanoChainId, LOCAL_OSMOSIS_CHAIN_ID],
      };
    },
  };
}

function noDirectRoute(
  fromChainId: string,
  toChainId: string,
  expectedChainPath?: string[],
): TransferPlanResponse {
  return {
    foundRoute: false,
    mode: null,
    chains: [fromChainId, toChainId],
    routes: [],
    tokenTrace: null,
    failureCode: 'no-route-found',
    failureMessage: `No direct transfer route exists from ${fromChainId} to ${toChainId}.`,
    routeDiagnostics: {
      expectedChainPath: expectedChainPath || [fromChainId, toChainId],
      missingHops: [
        {
          fromChainId,
          toChainId,
          reason: 'no-channel-to-destination',
          availableDestChainIds: [],
        },
      ],
    },
  };
}

async function fetchDirectOsmosisChannelPair(
  config: PlannerConfig,
): Promise<DirectOsmosisChannelPair | null> {
  const channels = await fetchOpenOsmosisChannels(config);
  const selected = selectLatestChannel(channels);
  return selected
    ? {
        cardanoChannel: selected.counterparty.channel_id,
        osmosisChannel: selected.channel_id,
      }
    : null;
}

async function fetchOpenOsmosisChannels(
  config: PlannerConfig,
): Promise<QueryChannelResponse[]> {
  const channels: QueryChannelResponse[] = [];
  let nextKey: string | undefined;

  do {
    const url = nextKey
      ? `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}&pagination.key=${encodeURIComponent(nextKey)}`
      : `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}`;
    const data: {
      channels?: QueryChannelResponse[];
      pagination?: { next_key?: string };
    } = await fetchJson<{
      channels?: QueryChannelResponse[];
      pagination?: { next_key?: string };
    }>(url, config.fetchImpl).catch(() => ({ channels: [] }));

    for (const channel of data.channels || []) {
      if (!isOpenChannelState(channel.state)) {
        continue;
      }
      const clientState = await fetchClientStateFromChannel(
        config.localOsmosisRestEndpoint,
        channel.channel_id,
        channel.port_id,
        config.fetchImpl,
      ).catch(() => null);
      if (
        clientState?.identified_client_state?.client_state?.chain_id ===
        config.cardanoChainId
      ) {
        channels.push(channel);
      }
    }

    nextKey = data.pagination?.next_key;
  } while (nextKey);

  return channels;
}

async function fetchClientStateFromChannel(
  restUrl: string,
  channelId: string,
  portId: string,
  fetchImpl: typeof fetch,
): Promise<QueryClientStateResponse> {
  return fetchJson<QueryClientStateResponse>(
    `${restUrl}${QUERY_CHANNELS_PREFIX_URL}/${channelId}/ports/${portId}/client_state`,
    fetchImpl,
  );
}

function selectLatestChannel(
  channels: QueryChannelResponse[],
): QueryChannelResponse | undefined {
  return channels.reduce<QueryChannelResponse | undefined>((selected, channel) => {
    if (!selected) return channel;
    return compareChannelId(channel.channel_id, selected.channel_id) > 0
      ? channel
      : selected;
  }, undefined);
}

function compareChannelId(a: string, b: string): number {
  const aSequence = parseChannelSequence(a);
  const bSequence = parseChannelSequence(b);
  if (aSequence !== undefined && bSequence !== undefined) {
    return aSequence === bSequence ? 0 : aSequence > bSequence ? 1 : -1;
  }
  return a.localeCompare(b);
}

function parseChannelSequence(channelId: string): bigint | undefined {
  const match = /^channel-(\d+)$/.exec(channelId);
  return match ? BigInt(match[1]) : undefined;
}

async function fetchCrossChainSwapRouterState(
  config: PlannerConfig,
): Promise<SwapRoute[]> {
  if (!config.swapRouterAddress) {
    return [];
  }

  const url = `${config.localOsmosisRestEndpoint}${QUERY_SWAP_ROUTER_STATE.replace(
    'SWAP_ROUTER_ADDRESS',
    config.swapRouterAddress,
  )}`;
  const data = await fetchJson<{ models?: Array<{ key: string; value: string }> }>(
    url,
    config.fetchImpl,
  ).catch(() => ({ models: [] }));

  const routes: SwapRoute[] = [];
  for (const model of data.models || []) {
    let keyText = hexToAscii(model.key);
    if (!keyText.startsWith(SWAP_ROUTING_TABLE_PREFIX)) {
      continue;
    }

    keyText = keyText.replace(SWAP_ROUTING_TABLE_PREFIX, '');
    const route = decodeBase64Json(model.value) as Array<{
      pool_id: string;
      token_out_denom: string;
    }>;
    const lastPool = route[route.length - 1];
    if (!lastPool?.token_out_denom) {
      continue;
    }

    const outToken = lastPool.token_out_denom;
    const inToken = keyText.replace(outToken, '');
    if (inToken) {
      routes.push({ route, inToken, outToken });
    }
  }

  return routes;
}

async function estimateSwapViaRest(
  config: PlannerConfig,
  tokenInAmount: string,
  tokenInDenom: string,
  routes: Array<{ pool_id: string; token_out_denom: string }>,
): Promise<{
  message: string;
  tokenOutAmount: bigint;
  tokenSwapAmount: bigint;
}> {
  const [firstRoute] = routes;
  if (!firstRoute) {
    return {
      message: 'Cannot find swap route for the selected token pair.',
      tokenOutAmount: BIGINT_ZERO,
      tokenSwapAmount: BIGINT_ZERO,
    };
  }

  const url = new URL(
    `${config.localOsmosisRestEndpoint}/osmosis/poolmanager/v1beta1/${firstRoute.pool_id}/estimate/swap_exact_amount_in_with_primitive_types`,
  );
  url.searchParams.set('token_in', `${tokenInAmount}${tokenInDenom}`);
  for (const route of routes) {
    url.searchParams.append('routes_pool_id', route.pool_id);
    url.searchParams.append('routes_token_out_denom', route.token_out_denom);
  }

  try {
    const response = await fetchJson<{ token_out_amount?: string }>(
      url.toString(),
      config.fetchImpl,
    );
    return {
      message: '',
      tokenOutAmount: BigInt(response.token_out_amount || '0'),
      tokenSwapAmount: BigInt(tokenInAmount),
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : 'Failed to estimate swap output.',
      tokenOutAmount: BIGINT_ZERO,
      tokenSwapAmount: BigInt(tokenInAmount),
    };
  }
}

function buildEmptyEstimate(message: string): SwapEstimateResponse {
  return {
    message,
    tokenOutAmount: '0',
    tokenOutTransferBackAmount: '0',
    tokenSwapAmount: '0',
    outToken: null,
    transferRoutes: [],
    transferBackRoutes: [],
    transferChains: [],
  };
}

function isOpenChannelState(state: string | number | undefined): boolean {
  return state === 'STATE_OPEN' || state === 'OPEN' || state === 'Open' || state === 3 || state === '3';
}

async function fetchJson<T>(
  url: string,
  fetchImpl: typeof fetch,
): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Request failed for ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

function hexToAscii(hexInput: string): string {
  let output = '';
  for (let index = 0; index < hexInput.length; index += 2) {
    output += String.fromCharCode(
      Number.parseInt(hexInput.slice(index, index + 2), 16),
    );
  }
  return output;
}

function decodeBase64Json(value: string): unknown {
  if (typeof atob === 'function') {
    return JSON.parse(atob(value));
  }

  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
}
