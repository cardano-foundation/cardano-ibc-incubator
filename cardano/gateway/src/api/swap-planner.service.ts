import { Injectable } from '@nestjs/common';
import {
  type SwapEstimateRequest,
  type SwapEstimateResponse,
  type SwapOptionsResponse,
} from '@cardano-ibc/planner';
import { PlannerClientService } from './planner-client.service';

@Injectable()
export class LocalOsmosisSwapPlannerService {
  constructor(private readonly plannerClientService: PlannerClientService) {}

  async getSwapOptions(): Promise<SwapOptionsResponse> {
    return this.plannerClientService.getClient().getLocalOsmosisSwapOptions();
  }

  async estimateSwap(
    request: SwapEstimateRequest,
  ): Promise<SwapEstimateResponse> {
    return this.plannerClientService
      .getClient()
      .estimateLocalOsmosisSwap(request);
  }
}
