import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DenomTraceService } from '~@/query/services/denom-trace.service';
import { LOVELACE } from '../constant';
import {
  AvailableChannel,
  IbcDenomTrace,
  LOCAL_OSMOSIS_CHAIN_ID,
  MatchResult,
  RouteTraceBack,
  SwapCandidate,
  SwapEstimateRequest,
  SwapMetadata,
  TokenTrace,
} from './local-osmosis-swap.types';

const CARDANO_POLICY_ID_HEX_LENGTH = 56;
const LOVELACE_PACKET_DENOM_HEX = Buffer.from(LOVELACE, 'utf8').toString('hex');

@Injectable()
export class TransferRouteResolverService {
  constructor(
    private readonly configService: ConfigService,
    private readonly denomTraceService: DenomTraceService,
  ) {}

  async resolveSwapCandidates(
    request: SwapEstimateRequest,
    metadata: SwapMetadata,
  ): Promise<SwapCandidate[]> {
    // The resolver is responsible for one thing: determine whether the input and
    // output tokens can be matched to a local-Osmosis swap route without
    // guessing channels. It returns only canonical candidates the planner may use.
    const [tokenInTrace, tokenOutTrace] = await Promise.all([
      this.getTokenDenomTrace(request.fromChainId, request.tokenInDenom, metadata.osmosisDenomTraces),
      this.getTokenDenomTrace(request.toChainId, request.tokenOutDenom, metadata.osmosisDenomTraces),
    ]);

    const preFilterRoutes = metadata.routeMap.reduce<
      Array<
        {
          route: Array<{ pool_id: string; token_out_denom: string }>;
          outToken: string;
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
          route: route.route,
          outToken: route.outToken,
          token0PoolTrace,
          token1PoolTrace,
        });
      }
      return acc;
    }, []);

    return preFilterRoutes.reduce<SwapCandidate[]>((acc, route) => {
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

      if (!token0PoolTraceWToken0.match || !token1PoolTraceWToken1.match) {
        return acc;
      }

      const transferCheck = this.checkTransferRoute(
        token0PoolTraceWToken0.chains,
        token0PoolTraceWToken0.routes,
        metadata.availableChannelsMap,
      );
      if (!transferCheck.canTransfer) {
        return acc;
      }

      acc.push({
        route: route.route,
        outToken: route.outToken,
        transferRoutes: transferCheck.transferRoutes,
        transferBackRoutes: token0PoolTraceWToken0.routes,
        transferChains: token0PoolTraceWToken0.chains,
      });
      return acc;
    }, []);
  }

  private get cardanoIbcChainId(): string {
    return this.configService.get<string>('cardanoChainId') || 'cardano-devnet';
  }

  private async getTokenDenomTrace(
    chainId: string,
    tokenString: string,
    osmosisDenomTraces: IbcDenomTrace,
  ): Promise<TokenTrace> {
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

    const trace = osmosisDenomTraces[tokenString];
    return {
      path: trace?.path || '',
      base_denom: trace?.baseDenom || tokenString.replace('ibc/', ''),
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
    // Matching is denom-trace-aware. If a voucher can be unwound toward the
    // target chain, we follow that path; if not, we reject rather than wrap it
    // again through a heuristic forward hop.
    if (tokenTrace.base_denom !== tokenInPoolTrace.base_denom) {
      return this.emptyMatch();
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
      return this.emptyMatch();
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

    return this.emptyMatch();
  }

  private emptyMatch(): MatchResult {
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
    // availableChannelsMap contains one canonical open transfer channel per hop.
    // If the exact hop needed for the trace does not exist, the route is invalid.
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
}
