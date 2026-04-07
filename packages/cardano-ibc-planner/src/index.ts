const ENTRYPOINT_CHAIN_ID = 'entrypoint';
const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
const DEFAULT_PFM_FEE = '0.100000000000000000';
const LOVELACE = 'lovelace';
const CARDANO_POLICY_ID_HEX_LENGTH = 56;
const QUERY_CHANNELS_PREFIX_URL = '/ibc/core/channel/v1/channels';
const QUERY_ALL_CHANNELS_URL =
  `${QUERY_CHANNELS_PREFIX_URL}?pagination.count_total=true&pagination.limit=10000`;
const QUERY_ALL_DENOMS_URL = '/ibc/apps/transfer/v1/denoms';
const QUERY_PACKET_FORWARD_PARAMS_URL = '/ibc/apps/packetforward/v1/params';
const QUERY_SWAP_ROUTER_STATE =
  '/cosmwasm/wasm/v1/contract/SWAP_ROUTER_ADDRESS/state?pagination.limit=100000000';
const SWAP_ROUTING_TABLE_PREFIX = '\x00\rrouting_table\x00D';
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const FEE_SCALE = BigInt('1000000000000000000');
const LOVELACE_PACKET_DENOM_HEX = textToHex(LOVELACE);
const METADATA_TTL_MS = 10_000;

export type ResolvedCardanoAssetTrace = {
  path: string;
  baseDenom: string;
  fullDenom: string;
};

export type TransferPlanRequest = {
  fromChainId: string;
  toChainId: string;
  tokenDenom: string;
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
  entrypointRestEndpoint: string;
  localOsmosisRestEndpoint: string;
  swapRouterAddress?: string;
  resolveCardanoAssetDenomTrace?: (
    assetId: string,
  ) => Promise<ResolvedCardanoAssetTrace | null>;
  fetchImpl?: typeof fetch;
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

type OpenChannel = {
  srcChain: string;
  srcPort: string;
  srcChannel: string;
  destChain: string;
  destPort: string;
  destChannel: string;
};

type TokenTrace = {
  kind: 'native' | 'ibc_voucher';
  path: string;
  baseDenom: string;
  fullDenom: string;
};

type IbcDenomTraceMap = Record<string, { path: string; baseDenom: string }>;

type PlannerMetadata = {
  adjacency: Record<string, Record<string, OpenChannel[]>>;
  channelByRoute: Record<string, OpenChannel>;
  denomTracesByChain: Record<string, IbcDenomTraceMap>;
};

type AvailableChannel = {
  destChain: string;
  destChannel: string;
  destPort: string;
};

type SwapRoute = {
  route: Array<{ pool_id: string; token_out_denom: string }>;
  inToken: string;
  outToken: string;
};

type SwapMetadata = {
  allChannelMappings: Record<string, AvailableChannel>;
  availableChannelsMap: Record<string, AvailableChannel>;
  pfmFees: Record<string, bigint>;
  osmosisDenomTraces: IbcDenomTraceMap;
  routeMap: SwapRoute[];
};

type SwapTrace = {
  path: string;
  base_denom: string;
  origin_denom: string;
};

type MatchResult = {
  match: boolean;
  chains: string[];
  routes: string[];
  fromToken: SwapTrace | null;
  toToken: { path: string; base_denom: string } | null;
};

type RouteTraceBack = {
  chains: string[];
  routes: string[];
  counterRoutes: string[];
  paths: string[];
};

type SwapCandidate = {
  route: Array<{ pool_id: string; token_out_denom: string }>;
  outToken: string;
  transferRoutes: string[];
  transferBackRoutes: string[];
  transferChains: string[];
};

type RawChannelMapping = {
  srcChain: string;
  srcChannel: string;
  srcPort: string;
  destChannel: string;
  destPort: string;
  destChain?: string;
};

type PlannerConfig = PlannerClientConfig & {
  fetchImpl: typeof fetch;
  resolveCardanoAssetDenomTrace: (
    assetId: string,
  ) => Promise<ResolvedCardanoAssetTrace | null>;
};

export function createPlannerClient(
  config: PlannerClientConfig,
): PlannerClient {
  const resolvedConfig: PlannerConfig = {
    ...config,
    fetchImpl: config.fetchImpl || fetch,
    resolveCardanoAssetDenomTrace:
      config.resolveCardanoAssetDenomTrace ||
      (async () => null),
  };

  let swapMetadataCache:
    | {
        expiresAt: number;
        value: Promise<SwapMetadata>;
      }
    | undefined;

  const getPlannerMetadata = async (): Promise<PlannerMetadata> => {
    const [channels, entrypointDenomTraces, localOsmosisDenomTraces] =
      await Promise.all([
        fetchAllChannels(
          ENTRYPOINT_CHAIN_ID,
          resolvedConfig.entrypointRestEndpoint,
          resolvedConfig.fetchImpl,
        ),
        fetchAllDenomTraces(
          resolvedConfig.entrypointRestEndpoint,
          resolvedConfig.fetchImpl,
        ),
        fetchAllDenomTraces(
          resolvedConfig.localOsmosisRestEndpoint,
          resolvedConfig.fetchImpl,
        ),
      ]);

    return {
      adjacency: channels.adjacency,
      channelByRoute: channels.channelByRoute,
      denomTracesByChain: {
        [ENTRYPOINT_CHAIN_ID]: entrypointDenomTraces,
        [LOCAL_OSMOSIS_CHAIN_ID]: localOsmosisDenomTraces,
      },
    };
  };

  const getSwapMetadata = async (): Promise<SwapMetadata> => {
    const now = Date.now();
    if (swapMetadataCache && swapMetadataCache.expiresAt > now) {
      return swapMetadataCache.value;
    }

    const value = buildSwapMetadata(resolvedConfig);
    swapMetadataCache = {
      expiresAt: now + METADATA_TTL_MS,
      value,
    };

    try {
      return await value;
    } catch (error) {
      if (swapMetadataCache?.value === value) {
        swapMetadataCache = undefined;
      }
      throw error;
    }
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
          chains: fromChainId ? [fromChainId] : [],
          routes: [],
          tokenTrace: null,
          failureCode: 'invalid-request',
          failureMessage:
            'fromChainId, toChainId, and tokenDenom are required.',
        };
      }

      if (fromChainId === toChainId) {
        const tokenTrace = await resolveTransferTokenTrace(
          fromChainId,
          tokenDenom,
          { adjacency: {}, channelByRoute: {}, denomTracesByChain: {} },
          resolvedConfig,
        );

        return {
          foundRoute: true,
          mode: 'same-chain',
          chains: [fromChainId],
          routes: [],
          tokenTrace,
        };
      }

      const metadata = await getPlannerMetadata();
      const tokenTrace = await resolveTransferTokenTrace(
        fromChainId,
        tokenDenom,
        metadata,
        resolvedConfig,
      );

      const unwind = resolveUnwindFirstRoute(
        fromChainId,
        toChainId,
        tokenTrace,
        metadata,
      );

      if (unwind.finished || unwind.failure) {
        return {
          foundRoute: !unwind.failure,
          mode: unwind.failure ? null : unwind.mode,
          chains: unwind.chains,
          routes: unwind.routes,
          tokenTrace,
          failureCode: unwind.failure?.code,
          failureMessage: unwind.failure?.message,
        };
      }

      const nativeForward = resolveUniqueForwardRoute(
        unwind.currentChain,
        toChainId,
        metadata,
        new Set(unwind.chains),
      );

      if (nativeForward.failure) {
        return {
          foundRoute: false,
          mode: null,
          chains: unwind.chains,
          routes: unwind.routes,
          tokenTrace,
          failureCode: nativeForward.failure.code,
          failureMessage: nativeForward.failure.message,
        };
      }

      return {
        foundRoute: true,
        mode:
          unwind.routes.length > 0 ? 'unwind-then-forward' : 'native-forward',
        chains: [...unwind.chains, ...nativeForward.chains.slice(1)],
        routes: [...unwind.routes, ...nativeForward.routes],
        tokenTrace,
      };
    },

    async getLocalOsmosisSwapOptions() {
      const metadata = await getSwapMetadata();
      const toTokens = Array.from(
        new Set(metadata.routeMap.map((route) => route.outToken)),
      )
        .sort()
        .map((tokenId) => ({
          token_id: tokenId,
          token_name: formatSwapTokenName(
            tokenId,
            metadata.osmosisDenomTraces,
          ),
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
        return buildEmptyEstimate(
          'Input amount must be a positive integer amount.',
        );
      }

      const metadata = await getSwapMetadata();
      const transferCandidates = await resolveSwapCandidates(
        request,
        metadata,
        resolvedConfig,
      );

      if (transferCandidates.length === 0) {
        return buildEmptyEstimate(
          'Cannot find match pool, please select another pair',
        );
      }

      const poolsWithAmount = await Promise.all(
        transferCandidates.map(async (candidate) => {
          const netInputAmount = applyIntermediatePfmFees(
            BigInt(request.tokenInAmount),
            candidate.transferChains,
            metadata.pfmFees,
          );

          if (netInputAmount < BIGINT_ONE) {
            return {
              ...candidate,
              message:
                'Input amount too small, not enough to swap, please increase!',
              tokenOutAmount: BIGINT_ZERO,
              tokenSwapAmount: BIGINT_ZERO,
              tokenOutTransferBackAmount: BIGINT_ZERO,
            };
          }

          const estimatedSwap = await estimateSwapViaRest(
            resolvedConfig,
            netInputAmount.toString(),
            request.tokenInDenom,
            candidate.route,
          );

          const transferBackAmount = applyIntermediatePfmFees(
            estimatedSwap.tokenOutAmount,
            candidate.transferChains,
            metadata.pfmFees,
          );

          if (transferBackAmount < BIGINT_ONE) {
            return {
              ...candidate,
              message:
                'Input amount too small, cannot transfer back, please increase!',
              tokenOutAmount: BIGINT_ZERO,
              tokenSwapAmount: estimatedSwap.tokenSwapAmount,
              tokenOutTransferBackAmount: BIGINT_ZERO,
            };
          }

          return {
            ...candidate,
            message: estimatedSwap.message,
            tokenOutAmount: estimatedSwap.tokenOutAmount,
            tokenSwapAmount: estimatedSwap.tokenSwapAmount,
            tokenOutTransferBackAmount: transferBackAmount,
          };
        }),
      );

      const [best] = poolsWithAmount.sort((a, b) =>
        a.tokenOutAmount === b.tokenOutAmount
          ? 0
          : a.tokenOutAmount > b.tokenOutAmount
            ? -1
            : 1,
      );

      return {
        message: best.message || '',
        tokenOutAmount: best.tokenOutAmount.toString(),
        tokenOutTransferBackAmount: best.tokenOutTransferBackAmount.toString(),
        tokenSwapAmount: best.tokenSwapAmount.toString(),
        outToken: best.outToken,
        transferRoutes: best.transferRoutes,
        transferBackRoutes: best.transferBackRoutes,
        transferChains: best.transferChains,
      };
    },
  };
}

async function resolveTransferTokenTrace(
  chainId: string,
  tokenDenom: string,
  metadata: PlannerMetadata,
  config: PlannerConfig,
): Promise<TokenTrace> {
  if (chainId === config.cardanoChainId) {
    return resolveCardanoTransferTokenTrace(tokenDenom, config);
  }

  if (!tokenDenom.startsWith('ibc/')) {
    return {
      kind: 'native',
      path: '',
      baseDenom: tokenDenom,
      fullDenom: tokenDenom,
    };
  }

  const trace = metadata.denomTracesByChain[chainId]?.[tokenDenom];
  if (!trace) {
    throw new Error(
      `Could not resolve denom trace for ${tokenDenom} on chain ${chainId}.`,
    );
  }

  return {
    kind: 'ibc_voucher',
    path: trace.path,
    baseDenom: trace.baseDenom,
    fullDenom: trace.path ? `${trace.path}/${trace.baseDenom}` : trace.baseDenom,
  };
}

async function resolveCardanoTransferTokenTrace(
  tokenDenom: string,
  config: PlannerConfig,
): Promise<TokenTrace> {
  const normalized = tokenDenom.trim().toLowerCase();
  if (normalized === LOVELACE) {
    return {
      kind: 'native',
      path: '',
      baseDenom: LOVELACE,
      fullDenom: LOVELACE,
    };
  }

  if (
    /^[0-9a-f]+$/i.test(normalized) &&
    normalized.length >= CARDANO_POLICY_ID_HEX_LENGTH
  ) {
    const trace = await config.resolveCardanoAssetDenomTrace(normalized);
    if (trace) {
      return {
        kind: 'ibc_voucher',
        path: trace.path,
        baseDenom: trace.baseDenom,
        fullDenom: trace.fullDenom,
      };
    }
  }

  return {
    kind: 'native',
    path: '',
    baseDenom: tokenDenom,
    fullDenom: tokenDenom,
  };
}

function resolveUnwindFirstRoute(
  fromChainId: string,
  toChainId: string,
  tokenTrace: TokenTrace,
  metadata: PlannerMetadata,
): {
  currentChain: string;
  chains: string[];
  routes: string[];
  finished: boolean;
  mode: TransferPlanResponse['mode'];
  failure?: { code: TransferPlanResponse['failureCode']; message: string };
} {
  const hops = parseHops(tokenTrace.path);
  const chains = [fromChainId];
  const routes: string[] = [];
  let currentChain = fromChainId;

  if (hops.length === 0) {
    return {
      currentChain,
      chains,
      routes,
      finished: false,
      mode: null,
    };
  }

  for (const hop of hops) {
    const exactRoutes = Object.values(metadata.adjacency[currentChain] || {})
      .flat()
      .filter(
        (route) =>
          route.destPort === hop.port && route.destChannel === hop.channel,
      );

    if (exactRoutes.length === 0) {
      return {
        currentChain,
        chains,
        routes,
        finished: false,
        mode: null,
        failure: {
          code: 'missing-unwind-hop',
          message: `Voucher ${tokenTrace.fullDenom} must unwind via ${hop.port}/${hop.channel} on ${currentChain}, but that hop is not currently available.`,
        },
      };
    }

    if (exactRoutes.length > 1) {
      return {
        currentChain,
        chains,
        routes,
        finished: false,
        mode: null,
        failure: {
          code: 'ambiguous-unwind-hop',
          message: `Voucher ${tokenTrace.fullDenom} can unwind through multiple local channels matching ${hop.port}/${hop.channel} on ${currentChain}; refusing to guess.`,
        },
      };
    }

    const exactRoute = exactRoutes[0];
    routes.push(`${exactRoute.srcPort}/${exactRoute.srcChannel}`);
    currentChain = exactRoute.destChain;
    chains.push(currentChain);

    if (currentChain === toChainId) {
      return {
        currentChain,
        chains,
        routes,
        finished: true,
        mode: 'unwind',
      };
    }
  }

  return {
    currentChain,
    chains,
    routes,
    finished: currentChain === toChainId,
    mode: currentChain === toChainId ? 'unwind' : null,
  };
}

function resolveUniqueForwardRoute(
  fromChainId: string,
  toChainId: string,
  metadata: PlannerMetadata,
  initialVisited: Set<string>,
): {
  chains: string[];
  routes: string[];
  failure?: { code: TransferPlanResponse['failureCode']; message: string };
} {
  if (fromChainId === toChainId) {
    return { chains: [fromChainId], routes: [] };
  }

  const foundPaths: string[][] = [];
  const queue: string[][] = [[fromChainId]];
  let shortestLength: number | null = null;

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (shortestLength !== null && path.length > shortestLength) {
      continue;
    }

    const current = path[path.length - 1];
    if (current === toChainId) {
      shortestLength = path.length;
      foundPaths.push(path);
      continue;
    }

    const nextChains = Object.keys(metadata.adjacency[current] || {}).filter(
      (candidate) => !path.includes(candidate) && !initialVisited.has(candidate),
    );
    nextChains.forEach((candidate) => queue.push([...path, candidate]));
  }

  if (foundPaths.length === 0) {
    return {
      chains: [fromChainId],
      routes: [],
      failure: {
        code: 'no-forward-route',
        message: `No canonical transfer route exists from ${fromChainId} to ${toChainId}.`,
      },
    };
  }

  if (foundPaths.length > 1) {
    return {
      chains: [fromChainId],
      routes: [],
      failure: {
        code: 'ambiguous-forward-route',
        message: `Multiple distinct forward routes exist from ${fromChainId} to ${toChainId}; refusing to guess.`,
      },
    };
  }

  const chains = foundPaths[0];
  const routes: string[] = [];

  for (let index = 0; index < chains.length - 1; index += 1) {
    const current = chains[index];
    const next = chains[index + 1];
    const channels = metadata.adjacency[current]?.[next] || [];
    if (channels.length !== 1) {
      return {
        chains: chains.slice(0, index + 1),
        routes,
        failure: {
          code: 'ambiguous-forward-hop',
          message: `Found ${channels.length} open transfer channels from ${current} to ${next}; refusing to guess.`,
        },
      };
    }

    routes.push(`${channels[0].srcPort}/${channels[0].srcChannel}`);
  }

  return { chains, routes };
}

function parseHops(path: string): Array<{ port: string; channel: string }> {
  if (!path) {
    return [];
  }

  const segments = path.split('/').filter(Boolean);
  if (segments.length % 2 !== 0) {
    throw new Error(`Invalid ICS-20 path ${path}`);
  }

  const hops: Array<{ port: string; channel: string }> = [];
  for (let index = 0; index < segments.length; index += 2) {
    hops.push({
      port: segments[index],
      channel: segments[index + 1],
    });
  }

  return hops;
}

async function fetchAllDenomTraces(
  restUrl: string,
  fetchImpl: typeof fetch,
): Promise<IbcDenomTraceMap> {
  const traces: IbcDenomTraceMap = {};
  const baseUrl = `${restUrl}${QUERY_ALL_DENOMS_URL}?pagination.limit=10000`;
  let nextKey: string | undefined;

  do {
    const url = nextKey
      ? `${baseUrl}&pagination.key=${encodeURIComponent(nextKey)}`
      : baseUrl;
    const data = await fetchJson<{
      denoms?: Array<{
        base: string;
        trace?: Array<{ port_id: string; channel_id: string }>;
      }>;
      pagination?: { next_key?: string };
    }>(url, fetchImpl);

    for (const denom of data.denoms || []) {
      const path = stringifyTrace(denom.trace || []);
      const fullDenom = path ? `${path}/${denom.base}` : denom.base;
      const ibcHash = await hashIbcDenom(fullDenom);
      traces[ibcHash] = {
        path,
        baseDenom: denom.base,
      };
    }

    nextKey = data.pagination?.next_key;
  } while (nextKey);

  return traces;
}

function stringifyTrace(
  trace: Array<{ port_id: string; channel_id: string }>,
): string {
  return trace.flatMap((hop) => [hop.port_id, hop.channel_id]).join('/');
}

async function fetchAllChannels(
  chainId: string,
  restUrl: string,
  fetchImpl: typeof fetch,
): Promise<Pick<PlannerMetadata, 'adjacency' | 'channelByRoute'>> {
  const openChannels: OpenChannel[] = [];
  let nextKey: string | undefined;

  do {
    const url = nextKey
      ? `${restUrl}${QUERY_ALL_CHANNELS_URL}&pagination.key=${encodeURIComponent(nextKey)}`
      : `${restUrl}${QUERY_ALL_CHANNELS_URL}`;
    const data = await fetchJson<{
      channels?: QueryChannelResponse[];
      pagination?: { next_key?: string };
    }>(url, fetchImpl);

    for (const channel of data.channels || []) {
      if (!isOpenChannelState(channel.state)) {
        continue;
      }

      const clientState = await fetchClientStateFromChannel(
        restUrl,
        channel.channel_id,
        channel.port_id,
        fetchImpl,
      );
      const destChain = clientState.identified_client_state?.client_state?.chain_id;
      if (!destChain) {
        continue;
      }

      openChannels.push({
        srcChain: chainId,
        srcPort: channel.port_id,
        srcChannel: channel.channel_id,
        destChain,
        destPort: channel.counterparty.port_id,
        destChannel: channel.counterparty.channel_id,
      });
    }

    nextKey = data.pagination?.next_key;
  } while (nextKey);

  const adjacency: PlannerMetadata['adjacency'] = {};
  const channelByRoute: PlannerMetadata['channelByRoute'] = {};

  const insert = (channel: OpenChannel) => {
    adjacency[channel.srcChain] ||= {};
    adjacency[channel.srcChain][channel.destChain] ||= [];
    adjacency[channel.srcChain][channel.destChain].push(channel);
    channelByRoute[`${channel.srcChain}_${channel.srcPort}_${channel.srcChannel}`] =
      channel;
  };

  for (const channel of openChannels) {
    insert(channel);
    insert({
      srcChain: channel.destChain,
      srcPort: channel.destPort,
      srcChannel: channel.destChannel,
      destChain: channel.srcChain,
      destPort: channel.srcPort,
      destChannel: channel.srcChannel,
    });
  }

  return { adjacency, channelByRoute };
}

async function fetchClientStateFromChannel(
  restUrl: string,
  channelId: string,
  portId: string,
  fetchImpl: typeof fetch,
): Promise<QueryClientStateResponse> {
  const url = `${restUrl}${QUERY_CHANNELS_PREFIX_URL}/${channelId}/ports/${portId}/client_state`;
  return fetchJson<QueryClientStateResponse>(url, fetchImpl);
}

async function buildSwapMetadata(config: PlannerConfig): Promise<SwapMetadata> {
  const [channels, pfmFees, osmosisDenomTraces, routeMap] = await Promise.all([
    fetchSwapChannels(ENTRYPOINT_CHAIN_ID, config.entrypointRestEndpoint, config.fetchImpl),
    fetchPfmFees(config),
    fetchAllDenomTraces(config.localOsmosisRestEndpoint, config.fetchImpl),
    fetchCrossChainSwapRouterState(config),
  ]);

  return {
    allChannelMappings: channels.channelsMap,
    availableChannelsMap: channels.availableChannelsMap,
    pfmFees,
    osmosisDenomTraces,
    routeMap,
  };
}

async function fetchPfmFees(
  config: PlannerConfig,
): Promise<Record<string, bigint>> {
  const endpoints = {
    [ENTRYPOINT_CHAIN_ID]: config.entrypointRestEndpoint,
    [LOCAL_OSMOSIS_CHAIN_ID]: config.localOsmosisRestEndpoint,
  };

  const fees = await Promise.all(
    Object.entries(endpoints).map(async ([chainId, restUrl]) => ({
      chainId,
      fee:
        chainId === LOCAL_OSMOSIS_CHAIN_ID
          ? parseScaledDecimal(DEFAULT_PFM_FEE)
          : await fetchPacketForwardFee(restUrl, config.fetchImpl),
    })),
  );

  return fees.reduce<Record<string, bigint>>((acc, { chainId, fee }) => {
    acc[chainId] = fee;
    return acc;
  }, {});
}

async function fetchSwapChannels(
  chainId: string,
  restUrl: string,
  fetchImpl: typeof fetch,
): Promise<{
  channelsMap: Record<string, AvailableChannel>;
  availableChannelsMap: Record<string, AvailableChannel>;
}> {
  const channelPairs: RawChannelMapping[] = [];
  const maxSrcChannelId: Record<string, { channel: string; index: number }> =
    {};
  let nextKey: string | undefined;

  do {
    const url = nextKey
      ? `${restUrl}${QUERY_ALL_CHANNELS_URL}&pagination.key=${encodeURIComponent(nextKey)}`
      : `${restUrl}${QUERY_ALL_CHANNELS_URL}`;
    const data = await fetchJson<{
      channels?: QueryChannelResponse[];
      pagination?: { next_key?: string };
    }>(url, fetchImpl);

    for (const channel of data.channels || []) {
      if (!isOpenChannelState(channel.state)) {
        continue;
      }

      channelPairs.push({
        srcChain: chainId,
        srcChannel: channel.channel_id,
        srcPort: channel.port_id,
        destChannel: channel.counterparty.channel_id,
        destPort: channel.counterparty.port_id,
      });
    }

    nextKey = data.pagination?.next_key;
  } while (nextKey);

  await Promise.all(
    channelPairs.map(async (channelPair, index) => {
      const clientState = await fetchClientStateFromChannel(
        restUrl,
        channelPair.srcChannel,
        channelPair.srcPort,
        fetchImpl,
      );
      const destChain = clientState.identified_client_state?.client_state?.chain_id;
      channelPairs[index].destChain = destChain;

      if (!destChain) {
        return;
      }

      if (!maxSrcChannelId[destChain]) {
        maxSrcChannelId[destChain] = {
          index,
          channel: channelPair.srcChannel,
        };
        return;
      }

      const largerChannel = getMaxChannelId(
        channelPair.srcChannel,
        maxSrcChannelId[destChain].channel,
      );
      maxSrcChannelId[destChain] = {
        index:
          largerChannel === channelPair.srcChannel
            ? index
            : maxSrcChannelId[destChain].index,
        channel: largerChannel,
      };
    }),
  );

  const bestChannels = Object.keys(maxSrcChannelId).map((chain) => {
    const { index } = maxSrcChannelId[chain];
    return channelPairs[index];
  });

  return {
    channelsMap: buildChannelMap(channelPairs),
    availableChannelsMap: buildChannelMap(bestChannels),
  };
}

function buildChannelMap(
  channelPairs: RawChannelMapping[],
): Record<string, AvailableChannel> {
  const map: Record<string, AvailableChannel> = {};

  for (const channelPair of channelPairs) {
    const {
      srcChain,
      srcChannel,
      srcPort,
      destChannel,
      destPort,
      destChain,
    } = channelPair;

    if (!destChain) {
      continue;
    }

    map[`${srcChain}_${srcPort}_${srcChannel}`] = {
      destChain,
      destChannel,
      destPort,
    };
    map[`${destChain}_${destPort}_${destChannel}`] = {
      destChain: srcChain,
      destChannel: srcChannel,
      destPort: srcPort,
    };
  }

  return map;
}

async function fetchPacketForwardFee(
  restUrl: string,
  fetchImpl: typeof fetch,
): Promise<bigint> {
  const defaultFee = parseScaledDecimal(DEFAULT_PFM_FEE);

  try {
    const response = await fetchImpl(`${restUrl}${QUERY_PACKET_FORWARD_PARAMS_URL}`);
    if (!response.ok) {
      return defaultFee;
    }

    const data = (await response.json()) as {
      params?: { fee_percentage?: string | number };
    };
    const feePercentage = data?.params?.fee_percentage;
    if (typeof feePercentage !== 'string' && typeof feePercentage !== 'number') {
      return defaultFee;
    }

    return parseScaledDecimal(String(feePercentage));
  } catch {
    return defaultFee;
  }
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
    const route = (await decodeBase64Json(model.value)) as Array<{
      pool_id: string;
      token_out_denom: string;
    }>;
    const lastPool = route[route.length - 1];
    if (!lastPool?.token_out_denom) {
      continue;
    }

    const outToken = lastPool.token_out_denom;
    const inToken = keyText.replace(outToken, '');
    if (isValidTokenInPool(inToken) && isValidTokenInPool(outToken)) {
      routes.push({ route, inToken, outToken });
    }
  }

  return routes;
}

function isValidTokenInPool(tokenString: string): boolean {
  return tokenString.startsWith('ibc/') || !tokenString.includes('/');
}

function formatSwapTokenName(
  tokenId: string,
  traces: IbcDenomTraceMap,
): string {
  if (tokenId.startsWith('ibc/')) {
    return traces[tokenId]?.baseDenom || tokenId;
  }
  return tokenId;
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

async function resolveSwapCandidates(
  request: SwapEstimateRequest,
  metadata: SwapMetadata,
  config: PlannerConfig,
): Promise<SwapCandidate[]> {
  const [tokenInTrace, tokenOutTrace] = await Promise.all([
    getSwapTokenDenomTrace(
      request.fromChainId,
      request.tokenInDenom,
      metadata.osmosisDenomTraces,
      config,
    ),
    getSwapTokenDenomTrace(
      request.toChainId,
      request.tokenOutDenom,
      metadata.osmosisDenomTraces,
      config,
    ),
  ]);

  const preFilterRoutes = metadata.routeMap.reduce<
    Array<{
      route: Array<{ pool_id: string; token_out_denom: string }>;
      outToken: string;
      token0PoolTrace: { path: string; base_denom: string };
      token1PoolTrace: { path: string; base_denom: string };
    }>
  >((acc, route) => {
    const token0PoolTrace = route.inToken.startsWith('ibc/')
      ? {
          path: metadata.osmosisDenomTraces[route.inToken]?.path || '',
          base_denom: metadata.osmosisDenomTraces[route.inToken]?.baseDenom || '',
        }
      : {
          path: '',
          base_denom: route.inToken,
        };

    const token1PoolTrace = route.outToken.startsWith('ibc/')
      ? {
          path: metadata.osmosisDenomTraces[route.outToken]?.path || '',
          base_denom: metadata.osmosisDenomTraces[route.outToken]?.baseDenom || '',
        }
      : {
          path: '',
          base_denom: route.outToken,
        };

    if (
      token0PoolTrace.base_denom &&
      token1PoolTrace.base_denom &&
      token0PoolTrace.base_denom === tokenInTrace.base_denom &&
      token1PoolTrace.base_denom === tokenOutTrace.base_denom
    ) {
      acc.push({
        route: route.route,
        outToken: route.outToken,
        token0PoolTrace,
        token1PoolTrace,
      });
    }

    return acc;
  }, []);

  return preFilterRoutes.reduce<SwapCandidate[]>((acc, route) => {
    const tokenInMatch = tryMatchToken(
      request.fromChainId,
      tokenInTrace,
      route.token0PoolTrace,
      metadata.allChannelMappings,
    );
    const tokenOutMatch = tryMatchToken(
      request.toChainId,
      tokenOutTrace,
      route.token1PoolTrace,
      metadata.allChannelMappings,
    );

    if (!tokenInMatch.match || !tokenOutMatch.match) {
      return acc;
    }

    const transferCheck = checkTransferRoute(
      tokenInMatch.chains,
      tokenInMatch.routes,
      metadata.availableChannelsMap,
    );
    if (!transferCheck.canTransfer) {
      return acc;
    }

    acc.push({
      route: route.route,
      outToken: route.outToken,
      transferRoutes: transferCheck.transferRoutes,
      transferBackRoutes: tokenInMatch.routes,
      transferChains: tokenInMatch.chains,
    });

    return acc;
  }, []);
}

async function getSwapTokenDenomTrace(
  chainId: string,
  tokenString: string,
  osmosisDenomTraces: IbcDenomTraceMap,
  config: PlannerConfig,
): Promise<SwapTrace> {
  if (!tokenString.startsWith('ibc/')) {
    if (chainId === config.cardanoChainId) {
      const trace = await getCardanoAssetTrace(tokenString, config);
      if (trace) {
        return trace;
      }
    }

    return {
      path: '',
      base_denom:
        tokenString.toLowerCase() === LOVELACE
          ? LOVELACE_PACKET_DENOM_HEX
          : tokenString,
      origin_denom: tokenString,
    };
  }

  if (chainId === config.cardanoChainId) {
    return {
      path: '',
      base_denom: tokenString.replace('ibc/', ''),
      origin_denom: tokenString,
    };
  }

  const trace = osmosisDenomTraces[tokenString];
  return {
    path: trace?.path || '',
    base_denom: trace?.baseDenom || tokenString.replace('ibc/', ''),
    origin_denom: tokenString,
  };
}

async function getCardanoAssetTrace(
  tokenString: string,
  config: PlannerConfig,
): Promise<SwapTrace | null> {
  if (tokenString.trim().toLowerCase() === LOVELACE) {
    return {
      path: '',
      base_denom: LOVELACE_PACKET_DENOM_HEX,
      origin_denom: tokenString,
    };
  }

  const normalized = tokenString.trim().toLowerCase();
  if (
    normalized.length <= CARDANO_POLICY_ID_HEX_LENGTH ||
    !/^[0-9a-f]+$/i.test(normalized)
  ) {
    return null;
  }

  const trace = await config.resolveCardanoAssetDenomTrace(normalized);
  if (!trace) {
    return null;
  }

  return {
    path: trace.path,
    base_denom: trace.baseDenom,
    origin_denom: tokenString,
  };
}

function tryMatchToken(
  tokenChainId: string,
  tokenTrace: SwapTrace,
  tokenInPoolTrace: { path: string; base_denom: string },
  allChannelMappings: Record<string, AvailableChannel>,
): MatchResult {
  if (tokenTrace.base_denom !== tokenInPoolTrace.base_denom) {
    return emptyMatch();
  }

  if (
    tokenChainId === LOCAL_OSMOSIS_CHAIN_ID &&
    tokenTrace.path === tokenInPoolTrace.path
  ) {
    return {
      match: true,
      chains: [LOCAL_OSMOSIS_CHAIN_ID],
      routes: [],
      fromToken: tokenTrace,
      toToken: tokenInPoolTrace,
    };
  }

  if (tokenTrace.path === '' && tokenInPoolTrace.path !== '') {
    const traceBack = traceBackRoutesFrom(
      LOCAL_OSMOSIS_CHAIN_ID,
      tokenInPoolTrace,
      allChannelMappings,
    );
    if (
      traceBack.paths.length === traceBack.routes.length &&
      traceBack.chains[traceBack.chains.length - 1] === tokenChainId
    ) {
      return {
        match: true,
        chains: traceBack.chains.reverse(),
        routes: traceBack.routes.reverse(),
        fromToken: tokenTrace,
        toToken: tokenInPoolTrace,
      };
    }
  }

  if (tokenTrace.path !== '' && tokenInPoolTrace.path === '') {
    const traceBack = traceBackRoutesFrom(
      tokenChainId,
      tokenTrace,
      allChannelMappings,
    );
    if (
      traceBack.paths.length === traceBack.routes.length &&
      traceBack.chains[traceBack.chains.length - 1] === LOCAL_OSMOSIS_CHAIN_ID
    ) {
      return {
        match: true,
        chains: traceBack.chains,
        routes: traceBack.counterRoutes,
        fromToken: tokenTrace,
        toToken: tokenInPoolTrace,
      };
    }
  }

  const traceBackInPool = traceBackRoutesFrom(
    LOCAL_OSMOSIS_CHAIN_ID,
    tokenInPoolTrace,
    allChannelMappings,
  );
  const traceBackInput = traceBackRoutesFrom(
    tokenChainId,
    tokenTrace,
    allChannelMappings,
  );

  if (
    traceBackInPool.paths.length !== traceBackInPool.routes.length ||
    traceBackInput.paths.length !== traceBackInput.routes.length
  ) {
    return emptyMatch();
  }

  if (
    traceBackInPool.chains.length > 0 &&
    traceBackInput.chains.length > 0 &&
    traceBackInPool.chains[traceBackInPool.chains.length - 1] ===
      traceBackInput.chains[traceBackInput.chains.length - 1]
  ) {
    const reverseRoutesInPool = [...traceBackInPool.routes].reverse();
    const reverseRoutesInput = [...traceBackInput.routes].reverse();
    const minLength = Math.min(
      reverseRoutesInPool.length,
      reverseRoutesInput.length,
    );
    let bestMatchIntersectIndex = -1;

    while (bestMatchIntersectIndex < minLength) {
      if (
        reverseRoutesInPool[bestMatchIntersectIndex + 1] !==
        reverseRoutesInput[bestMatchIntersectIndex + 1]
      ) {
        break;
      }
      bestMatchIntersectIndex += 1;
    }

    const chainStep1 = traceBackInput.chains.slice(
      0,
      traceBackInput.chains.length - 1 - bestMatchIntersectIndex,
    );
    const routesStep1 = traceBackInput.counterRoutes.slice(
      0,
      traceBackInput.counterRoutes.length - 1 - bestMatchIntersectIndex,
    );
    const chainStep2 = traceBackInPool.chains
      .slice(0, traceBackInPool.chains.length - 2 - bestMatchIntersectIndex)
      .reverse();
    const routesStep2 = traceBackInPool.routes
      .slice(0, traceBackInPool.routes.length - 1 - bestMatchIntersectIndex)
      .reverse();
    const chains = ([] as string[]).concat(chainStep1, chainStep2);
    const routes = ([] as string[]).concat(routesStep1, routesStep2);

    if (
      chains[0] === tokenChainId &&
      chains[chains.length - 1] === LOCAL_OSMOSIS_CHAIN_ID
    ) {
      return {
        match: true,
        chains,
        routes,
        fromToken: tokenTrace,
        toToken: tokenInPoolTrace,
      };
    }
  }

  return emptyMatch();
}

function emptyMatch(): MatchResult {
  return {
    match: false,
    chains: [],
    routes: [],
    fromToken: null,
    toToken: null,
  };
}

function traceBackRoutesFrom(
  chainId: string,
  tokenInPoolTrace: { path: string },
  channelsMap: Record<string, AvailableChannel>,
): RouteTraceBack {
  const paths = getPathTrace(tokenInPoolTrace.path);
  let currentChainId = chainId;
  const chains = [chainId];
  const routes: string[] = [];
  const counterRoutes: string[] = [];

  for (const path of paths) {
    const [port, channel] = path.split('/');
    const counterChannelPair = channelsMap[`${currentChainId}_${port}_${channel}`];
    if (!counterChannelPair) {
      continue;
    }

    routes.push(`${port}/${channel}`);
    counterRoutes.push(
      `${counterChannelPair.destPort}/${counterChannelPair.destChannel}`,
    );
    chains.push(counterChannelPair.destChain);
    currentChainId = counterChannelPair.destChain;
  }

  return {
    chains,
    routes,
    counterRoutes,
    paths,
  };
}

function checkTransferRoute(
  chains: string[],
  arrayDestChannelPort: string[],
  availableChannelsMap: Record<string, AvailableChannel>,
): { canTransfer: boolean; transferRoutes: string[] } {
  if (chains.length <= 1) {
    return {
      canTransfer: chains.length === 1,
      transferRoutes: [],
    };
  }

  if (chains.length !== arrayDestChannelPort.length + 1) {
    return {
      canTransfer: false,
      transferRoutes: [],
    };
  }

  let canTransfer = true;
  const transferRoutes: string[] = [];
  for (let index = 0; index < arrayDestChannelPort.length; index += 1) {
    const pair = arrayDestChannelPort[index];
    const [destPort, destChannel] = pair.split('/');
    const srcChain = chains[index];
    const destChain = chains[index + 1];
    const mapping = availableChannelsMap[`${destChain}_${destPort}_${destChannel}`];
    if (!mapping || mapping.destChain !== srcChain) {
      canTransfer = false;
      continue;
    }
    transferRoutes.push(`${mapping.destPort}/${mapping.destChannel}`);
  }

  return {
    canTransfer,
    transferRoutes,
  };
}

function getPathTrace(path: string): string[] {
  if (!path) {
    return [];
  }

  const parts = path.split('/');
  const result: string[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    if (parts[index + 1]) {
      result.push(`${parts[index]}/${parts[index + 1]}`);
    }
  }
  return result;
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

function applyIntermediatePfmFees(
  amount: bigint,
  transferChains: string[],
  pfmFees: Record<string, bigint>,
): bigint {
  let currentAmount = amount;
  if (transferChains.length <= 2) {
    return currentAmount;
  }

  for (const chainId of transferChains.slice(1, transferChains.length - 1)) {
    const fee = pfmFees[chainId] ?? parseScaledDecimal(DEFAULT_PFM_FEE);
    currentAmount = deductScaledFee(currentAmount, fee);
  }

  return currentAmount;
}

function deductScaledFee(amount: bigint, feeScaled: bigint): bigint {
  const numerator = amount * feeScaled;
  let deducted = numerator / FEE_SCALE;
  if (numerator % FEE_SCALE !== BIGINT_ZERO) {
    deducted += BIGINT_ONE;
  }
  return amount - deducted;
}

function parseScaledDecimal(value: string): bigint {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  const normalizedFraction = fraction.padEnd(18, '0').slice(0, 18);
  return BigInt(whole || '0') * FEE_SCALE + BigInt(normalizedFraction || '0');
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

function getMaxChannelId(channel1: string, channel2: string): string {
  const id1 = Number(channel1.split('-')[1] || 0);
  const id2 = Number(channel2.split('-')[1] || 0);
  return `channel-${Math.max(id1, id2)}`;
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

function textToHex(value: string): string {
  return Array.from(new TextEncoder().encode(value))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function hashIbcDenom(fullDenom: string): Promise<string> {
  const bytes = new TextEncoder().encode(fullDenom);
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is unavailable for IBC denom hashing.');
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  return `ibc/${hex}`;
}

async function decodeBase64Json(value: string): Promise<unknown> {
  const rawText = await base64ToText(value);
  return JSON.parse(rawText);
}

async function base64ToText(value: string): Promise<string> {
  if (typeof atob === 'function') {
    return atob(value);
  }

  const bufferModule = await import('buffer');
  return bufferModule.Buffer.from(value, 'base64').toString('utf8');
}
