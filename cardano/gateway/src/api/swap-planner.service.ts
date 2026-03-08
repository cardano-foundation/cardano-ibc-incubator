import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sha256 } from 'js-sha256';
import { DenomTraceService } from '~@/query/services/denom-trace.service';
import { LOVELACE } from '../constant';

const ENTRYPOINT_CHAIN_ID = 'entrypoint';
const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
const CARDANO_POLICY_ID_HEX_LENGTH = 56;
const LOVELACE_PACKET_DENOM_HEX = Buffer.from(LOVELACE, 'utf8').toString('hex');
const DEFAULT_PFM_FEE = '0.100000000000000000';
const METADATA_TTL_MS = 10_000;
const QUERY_ALL_DENOM_TRACES_URL = '/ibc/apps/transfer/v1/denom_traces';
const QUERY_CHANNELS_PREFIX_URL = '/ibc/core/channel/v1/channels';
const QUERY_ALL_CHANNELS_URL =
  `${QUERY_CHANNELS_PREFIX_URL}?pagination.count_total=true&pagination.limit=10000`;
const QUERY_PACKET_FORWARD_PARAMS_URL = '/ibc/apps/packetforward/v1/params';
const QUERY_SWAP_ROUTER_STATE =
  '/cosmwasm/wasm/v1/contract/SWAP_ROUTER_ADDRESS/state?pagination.limit=100000000';
const SWAP_ROUTING_TABLE_PREFIX = '\x00\rrouting_table\x00D';
const FEE_SCALE = 10n ** 18n;

type IbcDenomTrace = Record<
  string,
  {
    path: string;
    baseDenom: string;
  }
>;

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

type RawChannelMapping = {
  srcChain: string;
  srcChannel: string;
  srcPort: string;
  destChannel: string;
  destPort: string;
  destChain?: string;
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
  osmosisDenomTraces: IbcDenomTrace;
  routeMap: SwapRoute[];
};

type TokenTrace = {
  path: string;
  base_denom: string;
  origin_denom: string;
};

type MatchResult = {
  match: boolean;
  chains: string[];
  routes: string[];
  fromToken: TokenTrace | null;
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

@Injectable()
// This planner is intentionally scoped to the local Osmosis demo swap path.
// Generic ICS-20 transfers should not depend on pool/router-specific logic.
export class LocalOsmosisSwapPlannerService {
  private metadataCache?: {
    expiresAt: number;
    value: Promise<SwapMetadata>;
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly denomTraceService: DenomTraceService,
    private readonly logger: Logger,
  ) {}

  async getSwapOptions(): Promise<SwapOptionsResponse> {
    const metadata = await this.getMetadata();
    const toTokens = Array.from(
      new Set(metadata.routeMap.map((route) => route.outToken)),
    )
      .sort()
      .map((tokenId) => ({
        token_id: tokenId,
        token_name: this.formatSwapTokenName(tokenId, metadata.osmosisDenomTraces),
        token_logo: null,
      }));

    return {
      from_chain_id: this.cardanoIbcChainId,
      from_chain_name: 'Cardano',
      to_chain_id: LOCAL_OSMOSIS_CHAIN_ID,
      to_chain_name: 'Local Osmosis',
      to_tokens: toTokens,
    };
  }

  async estimateSwap(request: SwapEstimateRequest): Promise<SwapEstimateResponse> {
    if (!/^\d+$/.test(request.tokenInAmount) || BigInt(request.tokenInAmount) <= 0n) {
      return this.buildEmptyEstimate('Input amount must be a positive integer amount.');
    }

    const metadata = await this.getMetadata();
    return this.findRouteAndPools(request, metadata);
  }

  private get cardanoIbcChainId(): string {
    return this.configService.get<string>('cardanoChainId') || 'cardano-devnet';
  }

  private get entrypointRestEndpoint(): string {
    return this.requireConfig('entrypointRestEndpoint', 'ENTRYPOINT_REST_ENDPOINT');
  }

  private get localOsmosisRestEndpoint(): string {
    return this.requireConfig('localOsmosisRestEndpoint', 'LOCAL_OSMOSIS_REST_ENDPOINT');
  }

  private get swapRouterAddress(): string {
    return this.configService.get<string>('swapRouterAddress') || '';
  }

  private requireConfig(configKey: string, envKey: string): string {
    const value = this.configService.get<string>(configKey)?.trim();
    if (!value) {
      throw new Error(`${envKey} must be configured for Gateway swap planning APIs.`);
    }
    return value;
  }

  private async getMetadata(): Promise<SwapMetadata> {
    const now = Date.now();
    if (this.metadataCache && this.metadataCache.expiresAt > now) {
      return this.metadataCache.value;
    }

    const value = this.buildMetadata();
    this.metadataCache = {
      expiresAt: now + METADATA_TTL_MS,
      value,
    };

    try {
      return await value;
    } catch (error) {
      if (this.metadataCache?.value === value) {
        this.metadataCache = undefined;
      }
      throw error;
    }
  }

  private async buildMetadata(): Promise<SwapMetadata> {
    const [channels, pfmFees, osmosisDenomTraces, routeMap] = await Promise.all([
      this.fetchAllChannels(ENTRYPOINT_CHAIN_ID, this.entrypointRestEndpoint),
      this.fetchPfmFees(),
      this.fetchAllDenomTraces(this.localOsmosisRestEndpoint),
      this.fetchCrossChainSwapRouterState(),
    ]);

    return {
      allChannelMappings: channels.channelsMap,
      availableChannelsMap: channels.availableChannelsMap,
      pfmFees,
      osmosisDenomTraces,
      routeMap,
    };
  }

  private async fetchPfmFees(): Promise<Record<string, bigint>> {
    const endpoints = {
      [ENTRYPOINT_CHAIN_ID]: this.entrypointRestEndpoint,
      [LOCAL_OSMOSIS_CHAIN_ID]: this.localOsmosisRestEndpoint,
    };

    const fees = await Promise.all(
      Object.entries(endpoints).map(async ([chainId, restUrl]) => ({
        chainId,
        fee: chainId === LOCAL_OSMOSIS_CHAIN_ID
          ? this.parseScaledDecimal(DEFAULT_PFM_FEE)
          : await this.fetchPacketForwardFee(restUrl),
      })),
    );

    return fees.reduce<Record<string, bigint>>((acc, { chainId, fee }) => {
      acc[chainId] = fee;
      return acc;
    }, {});
  }

  private async fetchAllDenomTraces(restUrl: string): Promise<IbcDenomTrace> {
    const traces: IbcDenomTrace = {};
    const baseUrl = `${restUrl}${QUERY_ALL_DENOM_TRACES_URL}?pagination.limit=10000`;
    let nextKey: string | undefined;

    do {
      const url = nextKey ? `${baseUrl}&pagination.key=${encodeURIComponent(nextKey)}` : baseUrl;
      const data = await this.fetchJson<{
        denom_traces?: Array<{ path: string; base_denom: string }>;
        pagination?: { next_key?: string };
      }>(url);

      for (const trace of data.denom_traces || []) {
        const ibcHash = `ibc/${sha256(`${trace.path}/${trace.base_denom}`).toUpperCase()}`;
        traces[ibcHash] = {
          path: trace.path,
          baseDenom: trace.base_denom,
        };
      }

      nextKey = data.pagination?.next_key;
    } while (nextKey);

    return traces;
  }

  private async fetchAllChannels(
    chainId: string,
    restUrl: string,
  ): Promise<{
    channelsMap: Record<string, AvailableChannel>;
    availableChannelsMap: Record<string, AvailableChannel>;
  }> {
    const tmpData: RawChannelMapping[] = [];
    const maxSrcChannelId: Record<string, { channel: string; index: number }> = {};
    let nextKey: string | undefined;

    do {
      const url = nextKey
        ? `${restUrl}${QUERY_ALL_CHANNELS_URL}&pagination.key=${encodeURIComponent(nextKey)}`
        : `${restUrl}${QUERY_ALL_CHANNELS_URL}`;
      const data = await this.fetchJson<{
        channels?: QueryChannelResponse[];
        pagination?: { next_key?: string };
      }>(url);

      for (const channel of data.channels || []) {
        if (!this.isOpenChannelState(channel.state)) {
          continue;
        }
        tmpData.push({
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
      tmpData.map(async (channelPair, index) => {
        const clientState = await this.fetchClientStateFromChannel(
          restUrl,
          channelPair.srcChannel,
          channelPair.srcPort,
        );
        const destChain = clientState.identified_client_state?.client_state?.chain_id;
        tmpData[index].destChain = destChain;

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

        const lgChannel = this.getMaxChannelId(
          channelPair.srcChannel,
          maxSrcChannelId[destChain].channel,
        );
        maxSrcChannelId[destChain] = {
          index: lgChannel === channelPair.srcChannel ? index : maxSrcChannelId[destChain].index,
          channel: lgChannel,
        };
      }),
    );

    const bestChannel = Object.keys(maxSrcChannelId).map((chain) => {
      const { index } = maxSrcChannelId[chain];
      return tmpData[index];
    });

    const channelsMap = this.buildChannelMap(tmpData);
    const availableChannelsMap = this.buildChannelMap(bestChannel);

    return {
      channelsMap,
      availableChannelsMap,
    };
  }

  private buildChannelMap(channelPairs: RawChannelMapping[]): Record<string, AvailableChannel> {
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

  private async fetchClientStateFromChannel(
    restUrl: string,
    channelId: string,
    portId: string,
  ): Promise<QueryClientStateResponse> {
    const url = `${restUrl}${QUERY_CHANNELS_PREFIX_URL}/${channelId}/ports/${portId}/client_state`;
    return this.fetchJson<QueryClientStateResponse>(url);
  }

  private async fetchPacketForwardFee(restUrl: string): Promise<bigint> {
    const defaultFee = this.parseScaledDecimal(DEFAULT_PFM_FEE);

    try {
      const res = await fetch(`${restUrl}${QUERY_PACKET_FORWARD_PARAMS_URL}`);
      if (!res.ok) {
        return defaultFee;
      }

      const data = (await res.json()) as { params?: { fee_percentage?: string | number } };
      const feePercentage = data?.params?.fee_percentage;
      if (typeof feePercentage !== 'string' && typeof feePercentage !== 'number') {
        return defaultFee;
      }

      return this.parseScaledDecimal(String(feePercentage));
    } catch {
      return defaultFee;
    }
  }

  private async fetchCrossChainSwapRouterState(): Promise<SwapRoute[]> {
    if (!this.swapRouterAddress) {
      return [];
    }

    const url = `${this.localOsmosisRestEndpoint}${QUERY_SWAP_ROUTER_STATE.replace(
      'SWAP_ROUTER_ADDRESS',
      this.swapRouterAddress,
    )}`;
    const data = await this.fetchJson<{ models?: Array<{ key: string; value: string }> }>(url)
      .catch(() => ({ models: [] }));

    return (data.models || []).reduce<SwapRoute[]>((acc, model) => {
      let keyStr = this.hexToAscii(model.key);
      if (!keyStr.startsWith(SWAP_ROUTING_TABLE_PREFIX)) {
        return acc;
      }

      keyStr = keyStr.replace(SWAP_ROUTING_TABLE_PREFIX, '');
      const route = JSON.parse(Buffer.from(model.value, 'base64').toString('ascii')) as Array<{
        pool_id: string;
        token_out_denom: string;
      }>;
      const lastPool = route[route.length - 1];
      if (!lastPool?.token_out_denom) {
        return acc;
      }

      const outToken = lastPool.token_out_denom;
      const inToken = keyStr.replace(outToken, '');
      if (this.isValidTokenInPool(inToken) && this.isValidTokenInPool(outToken)) {
        acc.push({ route, inToken, outToken });
      }
      return acc;
    }, []);
  }

  private async findRouteAndPools(
    request: SwapEstimateRequest,
    metadata: SwapMetadata,
  ): Promise<SwapEstimateResponse> {
    const [tokenInTrace, tokenOutTrace] = await Promise.all([
      this.getTokenDenomTrace(request.fromChainId, request.tokenInDenom),
      this.getTokenDenomTrace(request.toChainId, request.tokenOutDenom),
    ]);

    const preFilterRoutes = metadata.routeMap.reduce<
      Array<
        SwapRoute & {
          token0PoolTrace: { path: string; base_denom: string };
          token1PoolTrace: { path: string; base_denom: string };
        }
      >
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
          ...route,
          token0PoolTrace,
          token1PoolTrace,
        });
      }
      return acc;
    }, []);

    const advancedFilter = preFilterRoutes.reduce<
      Array<
        SwapRoute & {
          in: MatchResult;
          out: MatchResult;
        }
      >
    >((acc, route) => {
      const token0PoolTraceWToken0 = this.tryMatchToken(
        request.fromChainId,
        tokenInTrace,
        route.token0PoolTrace,
        metadata.allChannelMappings,
      );
      const token1PoolTraceWToken1 = this.tryMatchToken(
        request.toChainId,
        tokenOutTrace,
        route.token1PoolTrace,
        metadata.allChannelMappings,
      );

      if (token0PoolTraceWToken0.match && token1PoolTraceWToken1.match) {
        acc.push({
          ...route,
          in: token0PoolTraceWToken0,
          out: token1PoolTraceWToken1,
        });
      }
      return acc;
    }, []);

    const transferCandidates = advancedFilter.reduce<SwapCandidate[]>((acc, route) => {
      const { chains, routes: arrayDestChannelPort } = route.in;
      const transferCheck = this.checkTransferRoute(
        chains,
        arrayDestChannelPort,
        metadata.availableChannelsMap,
      );
      if (!transferCheck.canTransfer) {
        return acc;
      }

      acc.push({
        route: route.route,
        outToken: route.outToken,
        transferRoutes: transferCheck.transferRoutes,
        transferBackRoutes: arrayDestChannelPort,
        transferChains: chains,
      });
      return acc;
    }, []);

    const poolsWithAmount = await Promise.all(
      transferCandidates.map(async (candidate) => {
        const netInputAmount = this.applyIntermediatePfmFees(
          BigInt(request.tokenInAmount),
          candidate.transferChains,
          metadata.pfmFees,
        );

        if (netInputAmount < 1n) {
          return {
            ...candidate,
            message: 'Input amount too small, not enough to swap, please increase!',
            tokenOutAmount: 0n,
            tokenSwapAmount: 0n,
            tokenOutTransferBackAmount: 0n,
          };
        }

        const estimatedSwap = await this.estimateSwapViaRest(
          netInputAmount.toString(),
          request.tokenInDenom,
          candidate.route,
        );

        const transferBackAmount = this.applyIntermediatePfmFees(
          estimatedSwap.tokenOutAmount,
          candidate.transferChains,
          metadata.pfmFees,
        );

        if (transferBackAmount < 1n) {
          return {
            ...candidate,
            message:
              'Input amount too small, cannot transfer back, please increase!',
            tokenOutAmount: 0n,
            tokenSwapAmount: estimatedSwap.tokenSwapAmount,
            tokenOutTransferBackAmount: 0n,
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
      a.tokenOutAmount === b.tokenOutAmount ? 0 : a.tokenOutAmount > b.tokenOutAmount ? -1 : 1,
    );

    if (!best) {
      return this.buildEmptyEstimate('Cannot find match pool, please select another pair');
    }

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
  }

  private async estimateSwapViaRest(
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
        tokenOutAmount: 0n,
        tokenSwapAmount: 0n,
      };
    }

    const url = new URL(
      `${this.localOsmosisRestEndpoint}/osmosis/poolmanager/v1beta1/${firstRoute.pool_id}/estimate/swap_exact_amount_in_with_primitive_types`,
    );
    url.searchParams.set('token_in', `${tokenInAmount}${tokenInDenom}`);
    for (const route of routes) {
      url.searchParams.append('routes_pool_id', route.pool_id);
      url.searchParams.append('routes_token_out_denom', route.token_out_denom);
    }

    try {
      const response = await this.fetchJson<{ token_out_amount?: string }>(url.toString());
      return {
        message: '',
        tokenOutAmount: BigInt(response.token_out_amount || '0'),
        tokenSwapAmount: BigInt(tokenInAmount),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to estimate swap output.';
      return {
        message,
        tokenOutAmount: 0n,
        tokenSwapAmount: BigInt(tokenInAmount),
      };
    }
  }

  private async getTokenDenomTrace(chainId: string, tokenString: string): Promise<TokenTrace> {
    if (!tokenString.startsWith('ibc/')) {
      if (chainId === this.cardanoIbcChainId) {
        const trace = await this.getCardanoAssetTrace(tokenString);
        if (trace) {
          return trace;
        }
      }

      return {
        path: '',
        base_denom:
          tokenString.toLowerCase() === LOVELACE ? LOVELACE_PACKET_DENOM_HEX : tokenString,
        origin_denom: tokenString,
      };
    }

    if (chainId === this.cardanoIbcChainId) {
      return {
        path: '',
        base_denom: tokenString.replace('ibc/', ''),
        origin_denom: tokenString,
      };
    }

    const restUrl = this.getRestEndpoint(chainId);
    const trace = await this.fetchJson<{
      denom_trace?: {
        path?: string;
        base_denom?: string;
      };
    }>(`${restUrl}${QUERY_ALL_DENOM_TRACES_URL}/${tokenString.replace('ibc/', '')}`).catch(
      () => ({
        denom_trace: {
          path: '',
          base_denom: tokenString.replace('ibc/', ''),
        },
      }),
    );

    return {
      path: trace.denom_trace?.path || '',
      base_denom: trace.denom_trace?.base_denom || tokenString.replace('ibc/', ''),
      origin_denom: tokenString,
    };
  }

  private async getCardanoAssetTrace(tokenString: string): Promise<TokenTrace | null> {
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

    const policyId = normalized.slice(0, CARDANO_POLICY_ID_HEX_LENGTH);
    const voucherTokenName = normalized.slice(CARDANO_POLICY_ID_HEX_LENGTH);
    const trace = await this.denomTraceService.findByHash(voucherTokenName);
    if (!trace || trace.voucher_policy_id?.toLowerCase() !== policyId) {
      return null;
    }

    return {
      path: trace.path,
      base_denom: trace.base_denom,
      origin_denom: tokenString,
    };
  }

  private tryMatchToken(
    tokenChainId: string,
    tokenTrace: TokenTrace,
    tokenInPoolTrace: { path: string; base_denom: string },
    allChannelMappings: Record<string, AvailableChannel>,
  ): MatchResult {
    if (tokenTrace.base_denom !== tokenInPoolTrace.base_denom) {
      return {
        match: false,
        chains: [],
        routes: [],
        fromToken: null,
        toToken: null,
      };
    }

    if (tokenChainId === LOCAL_OSMOSIS_CHAIN_ID && tokenTrace.path === tokenInPoolTrace.path) {
      return {
        match: true,
        chains: [LOCAL_OSMOSIS_CHAIN_ID],
        routes: [],
        fromToken: tokenTrace,
        toToken: tokenInPoolTrace,
      };
    }

    if (tokenTrace.path === '' && tokenInPoolTrace.path !== '') {
      const traceBack = this.traceBackRoutesFrom(
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
      const traceBack = this.traceBackRoutesFrom(
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

    const traceBackInPool = this.traceBackRoutesFrom(
      LOCAL_OSMOSIS_CHAIN_ID,
      tokenInPoolTrace,
      allChannelMappings,
    );
    const traceBackInput = this.traceBackRoutesFrom(
      tokenChainId,
      tokenTrace,
      allChannelMappings,
    );

    if (
      traceBackInPool.paths.length !== traceBackInPool.routes.length ||
      traceBackInput.paths.length !== traceBackInput.routes.length
    ) {
      return {
        match: false,
        chains: [],
        routes: [],
        fromToken: null,
        toToken: null,
      };
    }

    if (
      traceBackInPool.chains.length > 0 &&
      traceBackInput.chains.length > 0 &&
      traceBackInPool.chains[traceBackInPool.chains.length - 1] ===
        traceBackInput.chains[traceBackInput.chains.length - 1]
    ) {
      const reverseRoutesInPool = [...traceBackInPool.routes].reverse();
      const reverseRoutesInput = [...traceBackInput.routes].reverse();
      const minLength = Math.min(reverseRoutesInPool.length, reverseRoutesInput.length);
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

      if (chains[0] === tokenChainId && chains[chains.length - 1] === LOCAL_OSMOSIS_CHAIN_ID) {
        return {
          match: true,
          chains,
          routes,
          fromToken: tokenTrace,
          toToken: tokenInPoolTrace,
        };
      }
    }

    return {
      match: false,
      chains: [],
      routes: [],
      fromToken: null,
      toToken: null,
    };
  }

  private traceBackRoutesFrom(
    chainId: string,
    tokenInPoolTrace: { path: string },
    channelsMap: Record<string, AvailableChannel>,
  ): RouteTraceBack {
    const paths = this.getPathTrace(tokenInPoolTrace.path);
    let tmpChainId = chainId;
    const chains = [chainId];
    const routes: string[] = [];
    const counterRoutes: string[] = [];

    for (const path of paths) {
      const [port, channel] = path.split('/');
      const counterChannelPair = channelsMap[`${tmpChainId}_${port}_${channel}`];
      if (!counterChannelPair) {
        continue;
      }

      routes.push(`${port}/${channel}`);
      counterRoutes.push(`${counterChannelPair.destPort}/${counterChannelPair.destChannel}`);
      chains.push(counterChannelPair.destChain);
      tmpChainId = counterChannelPair.destChain;
    }

    return {
      chains,
      routes,
      counterRoutes,
      paths,
    };
  }

  private checkTransferRoute(
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
    for (const [index, pair] of arrayDestChannelPort.entries()) {
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

  private applyIntermediatePfmFees(
    amount: bigint,
    transferChains: string[],
    pfmFees: Record<string, bigint>,
  ): bigint {
    let currentAmount = amount;
    if (transferChains.length <= 2) {
      return currentAmount;
    }

    for (const chainId of transferChains.slice(1, transferChains.length - 1)) {
      const fee = pfmFees[chainId] ?? this.parseScaledDecimal(DEFAULT_PFM_FEE);
      currentAmount = this.deductScaledFee(currentAmount, fee);
    }

    return currentAmount;
  }

  private deductScaledFee(amount: bigint, feeScaled: bigint): bigint {
    const numerator = amount * feeScaled;
    let deducted = numerator / FEE_SCALE;
    if (numerator % FEE_SCALE !== 0n) {
      deducted += 1n;
    }
    return amount - deducted;
  }

  private parseScaledDecimal(value: string): bigint {
    const [whole = '0', fraction = ''] = value.trim().split('.');
    const normalizedFraction = fraction.padEnd(18, '0').slice(0, 18);
    return BigInt(whole || '0') * FEE_SCALE + BigInt(normalizedFraction || '0');
  }

  private getPathTrace(path: string): string[] {
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

  private isValidTokenInPool(tokenString: string): boolean {
    return tokenString.startsWith('ibc/') || !tokenString.includes('/');
  }

  private formatSwapTokenName(tokenId: string, traces: IbcDenomTrace): string {
    if (tokenId.startsWith('ibc/')) {
      return traces[tokenId]?.baseDenom || tokenId;
    }
    return tokenId;
  }

  private getRestEndpoint(chainId: string): string {
    if (chainId === ENTRYPOINT_CHAIN_ID) {
      return this.entrypointRestEndpoint;
    }
    if (chainId === LOCAL_OSMOSIS_CHAIN_ID) {
      return this.localOsmosisRestEndpoint;
    }
    throw new Error(`Unsupported swap chain id: ${chainId}`);
  }

  private isOpenChannelState(state: string | number): boolean {
    return state === 'STATE_OPEN' || state === 'OPEN' || state === 3 || state === '3';
  }

  private getMaxChannelId(channel1: string, channel2: string): string {
    const id1 = Number(channel1.split('-')[1] || 0);
    const id2 = Number(channel2.split('-')[1] || 0);
    return `channel-${Math.max(id1, id2)}`;
  }

  private hexToAscii(hexInput: string): string {
    let output = '';
    for (let index = 0; index < hexInput.length; index += 2) {
      output += String.fromCharCode(parseInt(hexInput.slice(index, index + 2), 16));
    }
    return output;
  }

  private buildEmptyEstimate(message: string): SwapEstimateResponse {
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

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}
