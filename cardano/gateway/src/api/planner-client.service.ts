import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPlannerClient,
  type PlannerClient,
  type PlannerClientConfig,
  type ResolvedCardanoAssetTrace,
} from '@cardano-ibc/planner';
import { DenomTraceService } from '~@/query/services/denom-trace.service';

const CARDANO_POLICY_ID_HEX_LENGTH = 56;

@Injectable()
export class PlannerClientService {
  private plannerClient?: PlannerClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly denomTraceService: DenomTraceService,
  ) {}

  getClient(): PlannerClient {
    if (!this.plannerClient) {
      this.plannerClient = createPlannerClient(this.buildConfig());
    }

    return this.plannerClient;
  }

  private buildConfig(): PlannerClientConfig {
    return {
      cardanoChainId:
        this.configService.get<string>('cardanoChainId') || 'cardano-devnet',
      entrypointRestEndpoint: this.requireConfig(
        'entrypointRestEndpoint',
        'ENTRYPOINT_REST_ENDPOINT',
      ),
      localOsmosisRestEndpoint: this.requireConfig(
        'localOsmosisRestEndpoint',
        'LOCAL_OSMOSIS_REST_ENDPOINT',
      ),
      swapRouterAddress:
        this.configService.get<string>('swapRouterAddress') || '',
      resolveCardanoAssetDenomTrace: (assetId) =>
        this.resolveCardanoAssetDenomTrace(assetId),
    };
  }

  private requireConfig(configKey: string, envKey: string): string {
    const value = this.configService.get<string>(configKey)?.trim();
    if (!value) {
      throw new Error(`${envKey} must be configured for Gateway planning APIs.`);
    }
    return value;
  }

  private async resolveCardanoAssetDenomTrace(
    assetId: string,
  ): Promise<ResolvedCardanoAssetTrace | null> {
    const normalized = assetId.trim().toLowerCase();
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
      baseDenom: trace.base_denom,
      fullDenom: trace.path
        ? `${trace.path}/${trace.base_denom}`
        : trace.base_denom,
    };
  }
}
