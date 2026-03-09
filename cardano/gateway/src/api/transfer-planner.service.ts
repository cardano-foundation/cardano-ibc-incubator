import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DenomTraceService } from '~@/query/services/denom-trace.service';
import { LOVELACE } from '../constant';

const ENTRYPOINT_CHAIN_ID = 'entrypoint';
const LOCAL_OSMOSIS_CHAIN_ID = 'localosmosis';
const QUERY_CHANNELS_PREFIX_URL = '/ibc/core/channel/v1/channels';
const QUERY_ALL_CHANNELS_URL =
  `${QUERY_CHANNELS_PREFIX_URL}?pagination.count_total=true&pagination.limit=10000`;
const QUERY_ALL_DENOM_TRACES_URL = '/ibc/apps/transfer/v1/denom_traces';
const CARDANO_POLICY_ID_HEX_LENGTH = 56;

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
  failureCode?: string;
  failureMessage?: string;
};

@Injectable()
export class TransferPlannerService {
  constructor(
    private readonly configService: ConfigService,
    private readonly denomTraceService: DenomTraceService,
    private readonly logger: Logger,
  ) {}

  async planTransferRoute(request: TransferPlanRequest): Promise<TransferPlanResponse> {
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
        failureMessage: 'fromChainId, toChainId, and tokenDenom are required.',
      };
    }

    if (fromChainId === toChainId) {
      const tokenTrace = await this.resolveTokenTrace(fromChainId, tokenDenom, {
        adjacency: {},
        channelByRoute: {},
        denomTracesByChain: {},
      });
      return {
        foundRoute: true,
        mode: 'same-chain',
        chains: [fromChainId],
        routes: [],
        tokenTrace,
      };
    }

    const metadata = await this.getMetadata();
    const tokenTrace = await this.resolveTokenTrace(fromChainId, tokenDenom, metadata);

    const unwind = this.resolveUnwindFirstRoute(fromChainId, toChainId, tokenTrace, metadata);
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

    const nativeForward = this.resolveUniqueForwardRoute(
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
      mode: unwind.routes.length > 0 ? 'unwind-then-forward' : 'native-forward',
      chains: [...unwind.chains, ...nativeForward.chains.slice(1)],
      routes: [...unwind.routes, ...nativeForward.routes],
      tokenTrace,
    };
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

  private requireConfig(configKey: string, envKey: string): string {
    const value = this.configService.get<string>(configKey)?.trim();
    if (!value) {
      throw new Error(`${envKey} must be configured for Gateway transfer planning APIs.`);
    }
    return value;
  }

  private async getMetadata(): Promise<PlannerMetadata> {
    const [channels, entrypointDenomTraces, localOsmosisDenomTraces] = await Promise.all([
      this.fetchAllChannels(ENTRYPOINT_CHAIN_ID, this.entrypointRestEndpoint),
      this.fetchAllDenomTraces(this.entrypointRestEndpoint),
      this.fetchAllDenomTraces(this.localOsmosisRestEndpoint),
    ]);

    return {
      adjacency: channels.adjacency,
      channelByRoute: channels.channelByRoute,
      denomTracesByChain: {
        [ENTRYPOINT_CHAIN_ID]: entrypointDenomTraces,
        [LOCAL_OSMOSIS_CHAIN_ID]: localOsmosisDenomTraces,
      },
    };
  }

  private async resolveTokenTrace(
    chainId: string,
    tokenDenom: string,
    metadata: PlannerMetadata,
  ): Promise<TokenTrace> {
    if (chainId === this.cardanoIbcChainId) {
      return this.resolveCardanoTokenTrace(tokenDenom);
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
      throw new Error(`Could not resolve denom trace for ${tokenDenom} on chain ${chainId}.`);
    }

    return {
      kind: 'ibc_voucher',
      path: trace.path,
      baseDenom: trace.baseDenom,
      fullDenom: trace.path ? `${trace.path}/${trace.baseDenom}` : trace.baseDenom,
    };
  }

  private async resolveCardanoTokenTrace(tokenDenom: string): Promise<TokenTrace> {
    const normalized = tokenDenom.trim().toLowerCase();
    if (normalized === LOVELACE) {
      return {
        kind: 'native',
        path: '',
        baseDenom: LOVELACE,
        fullDenom: LOVELACE,
      };
    }

    if (/^[0-9a-f]+$/i.test(normalized) && normalized.length >= CARDANO_POLICY_ID_HEX_LENGTH) {
      const policyId = normalized.slice(0, CARDANO_POLICY_ID_HEX_LENGTH);
      const tokenName = normalized.slice(CARDANO_POLICY_ID_HEX_LENGTH);
      const trace = await this.denomTraceService.findByHash(tokenName);
      if (trace && trace.voucher_policy_id?.toLowerCase() === policyId) {
        return {
          kind: 'ibc_voucher',
          path: trace.path,
          baseDenom: trace.base_denom,
          fullDenom: trace.path ? `${trace.path}/${trace.base_denom}` : trace.base_denom,
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

  private resolveUnwindFirstRoute(
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
    failure?: { code: string; message: string };
  } {
    const hops = this.parseHops(tokenTrace.path);
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
          (route) => route.destPort === hop.port && route.destChannel === hop.channel,
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

  private resolveUniqueForwardRoute(
    fromChainId: string,
    toChainId: string,
    metadata: PlannerMetadata,
    initialVisited: Set<string>,
  ): {
    chains: string[];
    routes: string[];
    failure?: { code: string; message: string };
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

    for (let i = 0; i < chains.length - 1; i += 1) {
      const current = chains[i];
      const next = chains[i + 1];
      const channels = metadata.adjacency[current]?.[next] || [];
      if (channels.length !== 1) {
        return {
          chains: chains.slice(0, i + 1),
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

  private parseHops(path: string): Array<{ port: string; channel: string }> {
    if (!path) {
      return [];
    }

    const segments = path.split('/').filter(Boolean);
    if (segments.length % 2 !== 0) {
      throw new Error(`Invalid ICS-20 path ${path}`);
    }

    const hops: Array<{ port: string; channel: string }> = [];
    for (let i = 0; i < segments.length; i += 2) {
      hops.push({
        port: segments[i],
        channel: segments[i + 1],
      });
    }

    return hops;
  }

  private async fetchAllDenomTraces(restUrl: string): Promise<IbcDenomTraceMap> {
    const traces: IbcDenomTraceMap = {};
    const baseUrl = `${restUrl}${QUERY_ALL_DENOM_TRACES_URL}?pagination.limit=10000`;
    let nextKey: string | undefined;

    do {
      const url = nextKey ? `${baseUrl}&pagination.key=${encodeURIComponent(nextKey)}` : baseUrl;
      const data = await this.fetchJson<{
        denom_traces?: Array<{ path: string; base_denom: string }>;
        pagination?: { next_key?: string };
      }>(url);

      for (const trace of data.denom_traces || []) {
        const ibcHash = this.hashIbcDenom(`${trace.path}/${trace.base_denom}`);
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
  ): Promise<Pick<PlannerMetadata, 'adjacency' | 'channelByRoute'>> {
    const openChannels: OpenChannel[] = [];
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

        const clientState = await this.fetchClientStateFromChannel(
          restUrl,
          channel.channel_id,
          channel.port_id,
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
      channelByRoute[`${channel.srcChain}_${channel.srcPort}_${channel.srcChannel}`] = channel;
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

  private async fetchClientStateFromChannel(
    restUrl: string,
    channelId: string,
    portId: string,
  ): Promise<QueryClientStateResponse> {
    const url = `${restUrl}${QUERY_CHANNELS_PREFIX_URL}/${channelId}/ports/${portId}/client_state`;
    return this.fetchJson<QueryClientStateResponse>(url);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }

  private isOpenChannelState(state: string | number | undefined): boolean {
    return state === 'STATE_OPEN' || state === 'Open' || state === 3;
  }

  private hashIbcDenom(fullDenom: string): string {
    const { createHash } = require('crypto') as typeof import('crypto');
    return `ibc/${createHash('sha256').update(fullDenom).digest('hex').toUpperCase()}`;
  }
}
