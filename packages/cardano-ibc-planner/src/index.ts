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

export type TransferRouteAvailabilityRequest = {
  fromChainId: string;
  toChainId: string;
  signal?: AbortSignal;
};

export type TransferRouteAvailabilityResponse = {
  status: 'available' | 'unavailable' | 'unknown';
  chains: string[];
  routes: string[];
  failureCode?:
    | 'invalid-request'
    | 'unsupported-route'
    | 'no-open-channel'
    | 'discovery-timeout'
    | 'discovery-failed'
    | 'discovery-aborted';
  failureMessage?: string;
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
  counterpartyChainId?: string;
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
  checkTransferRouteAvailability: (
    request: TransferRouteAvailabilityRequest,
  ) => Promise<TransferRouteAvailabilityResponse>;
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
const QUERY_CARDANO_CHANNELS_URL =
  '/api/channels?key=&offset=0&limit=10000&countTotal=true&reverse=false';
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

type CounterpartyChannelResponse = {
  state: string | number;
  counterparty: {
    channel_id: string;
    port_id: string;
  };
};

type DirectChannelPair = {
  cardanoChannel: string;
  counterpartyChannel: string;
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

class RouteDiscoveryHttpError extends Error {
  readonly status: number;

  constructor(url: string, response: Response) {
    super(
      `Request failed for ${url}: ${response.status} ${response.statusText}`,
    );
    this.name = 'RouteDiscoveryHttpError';
    this.status = response.status;
  }
}

class RouteDiscoveryResponseError extends Error {
  constructor(url: string, detail: string) {
    super(`Invalid route discovery response from ${url}: ${detail}`);
    this.name = 'RouteDiscoveryResponseError';
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
  externalSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeExternalAbortListener: (() => void) | undefined;
  const timeoutError = new RouteDiscoveryTimeoutError(timeoutMs);
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });
  const operations: Promise<T | never>[] = [
    Promise.resolve().then(() => operation(controller.signal)),
    timeout,
  ];

  if (externalSignal) {
    operations.push(
      new Promise<never>((_, reject) => {
        const abort = () => {
          const abortError = new Error('IBC route discovery was cancelled.');
          abortError.name = 'RouteDiscoveryAbortedError';
          controller.abort(abortError);
          reject(abortError);
        };

        if (externalSignal.aborted) {
          abort();
          return;
        }

        externalSignal.addEventListener('abort', abort, { once: true });
        removeExternalAbortListener = () =>
          externalSignal.removeEventListener('abort', abort);
      }),
    );
  }

  try {
    return await Promise.race(operations);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    removeExternalAbortListener?.();
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
    async checkTransferRouteAvailability(request) {
      const fromChainId = request.fromChainId.trim();
      const toChainId = request.toChainId.trim();
      const chains = [fromChainId, toChainId].filter(Boolean);

      if (!fromChainId || !toChainId) {
        return {
          status: 'unknown',
          chains,
          routes: [],
          failureCode: 'invalid-request',
          failureMessage: 'fromChainId and toChainId are required.',
        };
      }

      if (fromChainId === toChainId) {
        return {
          status: 'available',
          chains: [fromChainId],
          routes: [],
        };
      }

      const isCardanoToCounterparty =
        fromChainId === resolvedConfig.cardanoChainId &&
        toChainId === resolvedConfig.counterpartyChainId;
      const isCounterpartyToCardano =
        fromChainId === resolvedConfig.counterpartyChainId &&
        toChainId === resolvedConfig.cardanoChainId;

      if (!isCardanoToCounterparty && !isCounterpartyToCardano) {
        return {
          status: 'unavailable',
          chains,
          routes: [],
          failureCode: 'unsupported-route',
          failureMessage: `No configured direct transfer route exists from ${fromChainId} to ${toChainId}.`,
        };
      }

      if (!resolvedConfig.cardanoRestEndpoint?.trim()) {
        return {
          status: 'unknown',
          chains,
          routes: [],
          failureCode: 'discovery-failed',
          failureMessage:
            'A Cardano channel endpoint is required to verify both ends of the IBC channel pair.',
        };
      }

      try {
        const directPair = await withRouteDiscoveryTimeout(
          (signal) => fetchDirectChannelPair(resolvedConfig, signal),
          resolvedConfig.routeDiscoveryTimeoutMs,
          request.signal,
        );
        if (!directPair) {
          return {
            status: 'unavailable',
            chains,
            routes: [],
            failureCode: 'no-open-channel',
            failureMessage: `No mutually open IBC transfer channel pair exists from ${fromChainId} to ${toChainId}.`,
          };
        }

        return {
          status: 'available',
          chains,
          routes: [
            `transfer/${
              isCardanoToCounterparty
                ? directPair.cardanoChannel
                : directPair.counterpartyChannel
            }`,
          ],
        };
      } catch (error) {
        const failureCode =
          error instanceof RouteDiscoveryTimeoutError
            ? 'discovery-timeout'
            : error instanceof Error &&
              error.name === 'RouteDiscoveryAbortedError'
            ? 'discovery-aborted'
            : 'discovery-failed';
        const detail =
          error instanceof Error && error.message.trim()
            ? error.message
            : 'The route discovery endpoints did not return a usable response.';
        return {
          status: 'unknown',
          chains,
          routes: [],
          failureCode,
          failureMessage:
            failureCode === 'discovery-timeout' ||
            failureCode === 'discovery-aborted'
              ? detail
              : `Unable to verify IBC route availability. ${detail}`,
        };
      }
    },

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

      const isCardanoToCounterparty =
        fromChainId === resolvedConfig.cardanoChainId &&
        toChainId === resolvedConfig.counterpartyChainId;
      const isCounterpartyToCardano =
        fromChainId === resolvedConfig.counterpartyChainId &&
        toChainId === resolvedConfig.cardanoChainId;

      if (!isCardanoToCounterparty && !isCounterpartyToCardano) {
        return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
      }

      const directPair = await withRouteDiscoveryTimeout(
        (signal) => fetchDirectChannelPair(resolvedConfig, signal),
        resolvedConfig.routeDiscoveryTimeoutMs,
      );
      if (isCardanoToCounterparty) {
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

      if (isCounterpartyToCardano) {
        if (!directPair) {
          return noDirectRoute(fromChainId, toChainId, request.expectedChainPath);
        }
        return {
          foundRoute: true,
          mode: 'native-forward',
          chains: [fromChainId, toChainId],
          routes: [`transfer/${directPair.counterpartyChannel}`],
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

      let directPair: DirectChannelPair | null;
      try {
        directPair = await withRouteDiscoveryTimeout(
          (signal) => fetchDirectChannelPair(resolvedConfig, signal),
          resolvedConfig.routeDiscoveryTimeoutMs,
        );
      } catch (error) {
        return buildEmptyEstimate(
          error instanceof Error
            ? `Unable to verify the Cardano-to-Osmosis transfer channel. ${error.message}`
            : 'Unable to verify the Cardano-to-Osmosis transfer channel.',
        );
      }
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
        transferBackRoutes: [`transfer/${directPair.counterpartyChannel}`],
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

async function fetchDirectChannelPair(
  config: PlannerConfig,
  signal?: AbortSignal,
): Promise<DirectChannelPair | null> {
  if (config.cardanoRestEndpoint?.trim()) {
    const channels = await fetchOpenCardanoChannels(config, signal);
    const candidates = [...channels].sort((a, b) =>
      compareChannelId(b.channel_id, a.channel_id),
    );
    let firstQueryError: unknown;
    for (const candidate of candidates) {
      throwIfAborted(signal);
      try {
        if (await isMatchingOpenCounterpartyChannel(config, candidate, signal)) {
          return {
            cardanoChannel: candidate.channel_id,
            counterpartyChannel: candidate.counterparty.channel_id,
          };
        }
      } catch (error) {
        throwIfAborted(signal);
        firstQueryError ??= error;
      }
    }
    if (firstQueryError) {
      throw firstQueryError;
    }
    return null;
  }

  const channels = await fetchOpenCounterpartyChannels(config, signal);
  const selected = selectLatestChannel(channels);
  return selected
    ? {
        cardanoChannel: selected.counterparty.channel_id,
        counterpartyChannel: selected.channel_id,
      }
    : null;
}

async function fetchOpenCardanoChannels(
  config: PlannerConfig,
  signal?: AbortSignal,
): Promise<QueryChannelResponse[]> {
  throwIfAborted(signal);
  const restEndpoint = config.cardanoRestEndpoint!.trim().replace(/\/+$/, '');
  const url = `${restEndpoint}${QUERY_CARDANO_CHANNELS_URL}`;
  const data = await fetchJson<{ channels?: unknown }>(
    url,
    config.fetchImpl,
    signal,
  );
  return parseChannelList(data.channels, url).filter(isOpenTransferChannel);
}

async function isMatchingOpenCounterpartyChannel(
  config: PlannerConfig,
  cardanoChannel: QueryChannelResponse,
  signal?: AbortSignal,
): Promise<boolean> {
  const restEndpoint = config.localOsmosisRestEndpoint.trim().replace(/\/+$/, '');
  const channelId = encodeURIComponent(cardanoChannel.counterparty.channel_id);
  const portId = encodeURIComponent(cardanoChannel.counterparty.port_id);
  const url = `${restEndpoint}${QUERY_CHANNELS_PREFIX_URL}/${channelId}/ports/${portId}`;
  let data: { channel?: unknown };
  try {
    data = await fetchJson<{ channel?: unknown }>(
      url,
      config.fetchImpl,
      signal,
    );
  } catch (error) {
    throwIfAborted(signal);
    if (error instanceof RouteDiscoveryHttpError && error.status === 404) {
      return false;
    }
    throw error;
  }
  const channel = parseCounterpartyChannel(data.channel, url);
  return Boolean(
    isOpenChannelState(channel.state) &&
      channel.counterparty.channel_id === cardanoChannel.channel_id &&
      channel.counterparty.port_id === cardanoChannel.port_id,
  );
}

async function fetchOpenCounterpartyChannels(
  config: PlannerConfig,
  signal?: AbortSignal,
): Promise<QueryChannelResponse[]> {
  const channels: QueryChannelResponse[] = [];
  let firstQueryError: unknown;
  let nextKey: string | undefined;

  do {
    throwIfAborted(signal);
    const url = nextKey
      ? `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}&pagination.key=${encodeURIComponent(nextKey)}`
      : `${config.localOsmosisRestEndpoint}${QUERY_ALL_CHANNELS_URL}`;
    const data: {
      channels?: unknown;
      pagination?: { next_key?: string };
    } = await fetchJson<{
      channels?: unknown;
      pagination?: { next_key?: string };
    }>(url, config.fetchImpl, signal);

    for (const channel of parseChannelList(data.channels, url)) {
      throwIfAborted(signal);
      if (!isOpenTransferChannel(channel)) {
        continue;
      }
      try {
        const clientState = await fetchClientStateFromChannel(
          config.localOsmosisRestEndpoint,
          channel.channel_id,
          channel.port_id,
          config.fetchImpl,
          signal,
        );
        const clientChainId =
          clientState?.identified_client_state?.client_state?.chain_id;
        if (!clientChainId) {
          throw new RouteDiscoveryResponseError(
            `${config.localOsmosisRestEndpoint}${QUERY_CHANNELS_PREFIX_URL}/${channel.channel_id}/ports/${channel.port_id}/client_state`,
            'identified client chain_id is required.',
          );
        }
        if (clientChainId === config.cardanoChainId) {
          channels.push(channel);
        }
      } catch (error) {
        throwIfAborted(signal);
        firstQueryError ??= error;
      }
    }

    nextKey = data.pagination?.next_key;
  } while (nextKey);

  if (channels.length === 0 && firstQueryError) {
    throw firstQueryError;
  }

  return channels;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseChannelList(
  value: unknown,
  url: string,
): QueryChannelResponse[] {
  if (!Array.isArray(value)) {
    throw new RouteDiscoveryResponseError(url, 'channels must be an array.');
  }

  return value.map((candidate, index) => {
    const counterparty = isRecord(candidate) ? candidate.counterparty : null;
    const state = isRecord(candidate) ? candidate.state : undefined;
    if (
      !isRecord(candidate) ||
      typeof candidate.channel_id !== 'string' ||
      typeof candidate.port_id !== 'string' ||
      (typeof state !== 'string' && typeof state !== 'number') ||
      !isRecord(counterparty) ||
      typeof counterparty.channel_id !== 'string' ||
      typeof counterparty.port_id !== 'string'
    ) {
      throw new RouteDiscoveryResponseError(
        url,
        `channels[${index}] is missing a channel id, port, state, or counterparty.`,
      );
    }

    return {
      channel_id: candidate.channel_id,
      port_id: candidate.port_id,
      state,
      counterparty: {
        channel_id: counterparty.channel_id,
        port_id: counterparty.port_id,
      },
    };
  });
}

function parseCounterpartyChannel(
  value: unknown,
  url: string,
): CounterpartyChannelResponse {
  const counterparty = isRecord(value) ? value.counterparty : null;
  const state = isRecord(value) ? value.state : undefined;
  if (
    !isRecord(value) ||
    (typeof state !== 'string' && typeof state !== 'number') ||
    !isRecord(counterparty) ||
    typeof counterparty.channel_id !== 'string' ||
    typeof counterparty.port_id !== 'string'
  ) {
    throw new RouteDiscoveryResponseError(
      url,
      'channel state and counterparty channel/port ids are required.',
    );
  }

  return {
    state,
    counterparty: {
      channel_id: counterparty.channel_id,
      port_id: counterparty.port_id,
    },
  };
}

function isOpenTransferChannel(channel: QueryChannelResponse): boolean {
  return (
    isOpenChannelState(channel.state) &&
    channel.port_id === 'transfer' &&
    channel.counterparty?.port_id === 'transfer' &&
    /^channel-\d+$/.test(channel.channel_id) &&
    /^channel-\d+$/.test(channel.counterparty.channel_id)
  );
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
    throw new RouteDiscoveryHttpError(url, response);
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
