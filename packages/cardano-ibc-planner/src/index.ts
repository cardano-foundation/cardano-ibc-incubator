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
  counterpartyChainId?: string;
  cardanoRestEndpoint?: string;
  localOsmosisRestEndpoint: string;
  routeDiscoveryTimeoutMs?: number;
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
const GATEWAY_CHANNELS_URL =
  '/api/channels?key=&offset=0&limit=200&countTotal=false&reverse=false';
const QUERY_SWAP_ROUTER_STATE =
  '/cosmwasm/wasm/v1/contract/SWAP_ROUTER_ADDRESS/state?pagination.limit=100000000';
const SWAP_ROUTING_TABLE_PREFIX = '\x00\rrouting_table\x00D';
const BIGINT_ZERO = BigInt(0);
export const DEFAULT_ROUTE_DISCOVERY_TIMEOUT_MS = 10_000;

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

type PlannerConfig = Omit<
  PlannerClientConfig,
  'counterpartyChainId' | 'fetchImpl' | 'routeDiscoveryTimeoutMs'
> & {
  counterpartyChainId: string;
  fetchImpl: typeof fetch;
  routeDiscoveryTimeoutMs: number;
};

export class RouteDiscoveryTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    const duration =
      timeoutMs % 1000 === 0
        ? `${timeoutMs / 1000} seconds`
        : `${timeoutMs} milliseconds`;
    super(`IBC route discovery timed out after ${duration}.`);
    this.name = 'RouteDiscoveryTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function normalizeRouteDiscoveryTimeoutMs(timeoutMs?: number): number {
  return typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
    ? timeoutMs
    : DEFAULT_ROUTE_DISCOVERY_TIMEOUT_MS;
}

async function withRouteDiscoveryTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutError = new RouteDiscoveryTimeoutError(timeoutMs);
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

export function createPlannerClient(config: PlannerClientConfig): PlannerClient {
  const resolvedConfig: PlannerConfig = {
    ...config,
    counterpartyChainId:
      config.counterpartyChainId?.trim() || LOCAL_OSMOSIS_CHAIN_ID,
    fetchImpl: config.fetchImpl || fetch,
    routeDiscoveryTimeoutMs: normalizeRouteDiscoveryTimeoutMs(
      config.routeDiscoveryTimeoutMs,
    ),
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

      const directPair = await withRouteDiscoveryTimeout(
        (signal) => fetchDirectOsmosisChannelPair(resolvedConfig, signal),
        resolvedConfig.routeDiscoveryTimeoutMs,
      );
      if (
        fromChainId === resolvedConfig.cardanoChainId &&
        toChainId === resolvedConfig.counterpartyChainId
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
        fromChainId === resolvedConfig.counterpartyChainId &&
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
  signal?: AbortSignal,
): Promise<DirectOsmosisChannelPair | null> {
  const fromCardano = await fetchDirectChannelPairFromCardano(config, signal);
  if (fromCardano) {
    return fromCardano;
  }
  const channels = await fetchOpenOsmosisChannels(config, signal);
  const selected = selectLatestChannel(channels);
  return selected
    ? {
        cardanoChannel: selected.counterparty.channel_id,
        osmosisChannel: selected.channel_id,
      }
    : null;
}

async function fetchDirectChannelPairFromCardano(
  config: PlannerConfig,
  signal?: AbortSignal,
): Promise<DirectOsmosisChannelPair | null> {
  if (!config.cardanoRestEndpoint) {
    return null;
  }
  const data = await fetchJson<{ channels?: QueryChannelResponse[] }>(
    `${config.cardanoRestEndpoint}${GATEWAY_CHANNELS_URL}`,
    config.fetchImpl,
    signal,
  ).catch(() => {
    throwIfAborted(signal);
    return { channels: [] as QueryChannelResponse[] };
  });
  const openChannels = (data.channels || []).filter(
    (channel) =>
      isOpenChannelState(channel.state) &&
      channel.port_id === 'transfer' &&
      channel.counterparty?.channel_id,
  );
  const selected = selectLatestChannel(openChannels);
  return selected
    ? {
        cardanoChannel: selected.channel_id,
        osmosisChannel: selected.counterparty.channel_id,
      }
    : null;
}

async function fetchOpenOsmosisChannels(
  config: PlannerConfig,
  signal?: AbortSignal,
): Promise<QueryChannelResponse[]> {
  const channels: QueryChannelResponse[] = [];
  let nextKey: string | undefined;

  do {
    throwIfAborted(signal);
    const url = nextKey
      ? `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}&pagination.key=${encodeURIComponent(nextKey)}`
      : `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}`;
    const data: {
      channels?: QueryChannelResponse[];
      pagination?: { next_key?: string };
    } = await fetchJson<{
      channels?: QueryChannelResponse[];
      pagination?: { next_key?: string };
    }>(url, config.fetchImpl, signal).catch(() => {
      throwIfAborted(signal);
      return { channels: [] };
    });

    for (const channel of data.channels || []) {
      throwIfAborted(signal);
      if (!isOpenChannelState(channel.state)) {
        continue;
      }
      const clientState = await fetchClientStateFromChannel(
        config.localOsmosisRestEndpoint,
        channel.channel_id,
        channel.port_id,
        config.fetchImpl,
        signal,
      ).catch(() => {
        throwIfAborted(signal);
        return null;
      });
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
  signal?: AbortSignal,
): Promise<QueryClientStateResponse> {
  return fetchJson<QueryClientStateResponse>(
    `${restUrl}${QUERY_CHANNELS_PREFIX_URL}/${channelId}/ports/${portId}/client_state`,
    fetchImpl,
    signal,
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
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const response = await fetchImpl(url, signal ? { signal } : undefined);
  throwIfAborted(signal);
  if (!response.ok) {
    throw new Error(
      `Request failed for ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as T;
  throwIfAborted(signal);
  return data;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  if (signal.reason instanceof Error) {
    throw signal.reason;
  }

  throw new Error('IBC route discovery was aborted.');
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
