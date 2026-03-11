import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sha256 } from 'js-sha256';
import {
  AvailableChannel,
  DEFAULT_PFM_FEE,
  ENTRYPOINT_CHAIN_ID,
  IbcDenomTrace,
  LOCAL_OSMOSIS_CHAIN_ID,
  SwapMetadata,
  SwapRoute,
} from './local-osmosis-swap.types';

const QUERY_ALL_DENOMS_URL = '/ibc/apps/transfer/v1/denoms';
const QUERY_CHANNELS_PREFIX_URL = '/ibc/core/channel/v1/channels';
const QUERY_ALL_CHANNELS_URL =
  `${QUERY_CHANNELS_PREFIX_URL}?pagination.count_total=true&pagination.limit=10000`;
const QUERY_PACKET_FORWARD_PARAMS_URL = '/ibc/apps/packetforward/v1/params';
const QUERY_SWAP_ROUTER_STATE =
  '/cosmwasm/wasm/v1/contract/SWAP_ROUTER_ADDRESS/state?pagination.limit=100000000';
const SWAP_ROUTING_TABLE_PREFIX = '\x00\rrouting_table\x00D';
const FEE_SCALE = 10n ** 18n;

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

@Injectable()
export class LocalOsmosisSwapClientService {
  constructor(private readonly configService: ConfigService) {}

  // This service owns every live dependency on local Osmosis / Entrypoint REST state.
  // The planner should only orchestrate, not know how these remote queries are performed.
  async buildMetadata(swapRouterAddress: string): Promise<SwapMetadata> {
    const [channels, pfmFees, osmosisDenomTraces, routeMap] = await Promise.all([
      this.fetchAllChannels(ENTRYPOINT_CHAIN_ID, this.entrypointRestEndpoint),
      this.fetchPfmFees(),
      this.fetchAllDenomTraces(this.localOsmosisRestEndpoint),
      this.fetchCrossChainSwapRouterState(swapRouterAddress),
    ]);

    return {
      allChannelMappings: channels.channelsMap,
      availableChannelsMap: channels.availableChannelsMap,
      pfmFees,
      osmosisDenomTraces,
      routeMap,
    };
  }

  async estimateSwapViaRest(
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

  private get entrypointRestEndpoint(): string {
    return this.requireConfig('entrypointRestEndpoint', 'ENTRYPOINT_REST_ENDPOINT');
  }

  private get localOsmosisRestEndpoint(): string {
    return this.requireConfig('localOsmosisRestEndpoint', 'LOCAL_OSMOSIS_REST_ENDPOINT');
  }

  private requireConfig(configKey: string, envKey: string): string {
    const value = this.configService.get<string>(configKey)?.trim();
    if (!value) {
      throw new Error(`${envKey} must be configured for Gateway swap planning APIs.`);
    }
    return value;
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
    const baseUrl = `${restUrl}${QUERY_ALL_DENOMS_URL}?pagination.limit=10000`;
    let nextKey: string | undefined;

    do {
      const url = nextKey ? `${baseUrl}&pagination.key=${encodeURIComponent(nextKey)}` : baseUrl;
      const data = await this.fetchJson<{
        denoms?: Array<{
          base: string;
          trace?: Array<{ port_id: string; channel_id: string }>;
        }>;
        pagination?: { next_key?: string };
      }>(url);

      for (const denom of data.denoms || []) {
        const path = this.stringifyTrace(denom.trace || []);
        const fullDenom = path ? `${path}/${denom.base}` : denom.base;
        const ibcHash = `ibc/${sha256(fullDenom).toUpperCase()}`;
        traces[ibcHash] = {
          path,
          baseDenom: denom.base,
        };
      }

      nextKey = data.pagination?.next_key;
    } while (nextKey);

    return traces;
  }

  private stringifyTrace(trace: Array<{ port_id: string; channel_id: string }>): string {
    return trace.flatMap((hop) => [hop.port_id, hop.channel_id]).join('/');
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
        // Channel metadata is only useful for swap planning once we know which
        // counterparty chain each open transfer channel actually targets.
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

    return {
      channelsMap: this.buildChannelMap(tmpData),
      availableChannelsMap: this.buildChannelMap(bestChannel),
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

  private async fetchCrossChainSwapRouterState(swapRouterAddress: string): Promise<SwapRoute[]> {
    if (!swapRouterAddress) {
      return [];
    }

    const url = `${this.localOsmosisRestEndpoint}${QUERY_SWAP_ROUTER_STATE.replace(
      'SWAP_ROUTER_ADDRESS',
      swapRouterAddress,
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

  private parseScaledDecimal(value: string): bigint {
    const [whole = '0', fraction = ''] = value.trim().split('.');
    const normalizedFraction = fraction.padEnd(18, '0').slice(0, 18);
    return BigInt(whole || '0') * FEE_SCALE + BigInt(normalizedFraction || '0');
  }

  private isValidTokenInPool(tokenString: string): boolean {
    return tokenString.startsWith('ibc/') || !tokenString.includes('/');
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

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed for ${url}: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}
