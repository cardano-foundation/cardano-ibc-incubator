import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransferRouteResolverService } from './transfer-route-resolver.service';
import { LocalOsmosisSwapClientService } from './local-osmosis-swap-client.service';
import {
  DEFAULT_PFM_FEE,
  IbcDenomTrace,
  LOCAL_OSMOSIS_CHAIN_ID,
  SwapEstimateRequest,
  SwapEstimateResponse,
  SwapMetadata,
  SwapOptionToken,
  SwapOptionsResponse,
} from './local-osmosis-swap.types';

const METADATA_TTL_MS = 10_000;
const FEE_SCALE = 10n ** 18n;

@Injectable()
export class LocalOsmosisSwapPlannerService {
  private metadataCache?: {
    expiresAt: number;
    value: Promise<SwapMetadata>;
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly localOsmosisSwapClientService: LocalOsmosisSwapClientService,
    private readonly transferRouteResolverService: TransferRouteResolverService,
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
    const transferCandidates = await this.transferRouteResolverService.resolveSwapCandidates(
      request,
      metadata,
    );

    if (transferCandidates.length === 0) {
      return this.buildEmptyEstimate('Cannot find match pool, please select another pair');
    }

    // At this point route resolution is done. The planner only applies
    // intermediate fees and asks the local-Osmosis client for swap estimates.
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

        const estimatedSwap = await this.localOsmosisSwapClientService.estimateSwapViaRest(
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

  private get cardanoIbcChainId(): string {
    return this.configService.get<string>('cardanoChainId') || 'cardano-devnet';
  }

  private get swapRouterAddress(): string {
    return this.configService.get<string>('swapRouterAddress') || '';
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
    return this.localOsmosisSwapClientService.buildMetadata(this.swapRouterAddress);
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

  private formatSwapTokenName(tokenId: string, traces: IbcDenomTrace): string {
    if (tokenId.startsWith('ibc/')) {
      return traces[tokenId]?.baseDenom || tokenId;
    }
    return tokenId;
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
}
