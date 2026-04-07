import { Injectable } from '@nestjs/common';
import {
  type TransferPlanRequest,
  type TransferPlanResponse,
} from '@cardano-ibc/planner';
import { PlannerClientService } from './planner-client.service';

@Injectable()
export class TransferPlannerService {
  constructor(private readonly plannerClientService: PlannerClientService) {}

  async planTransferRoute(
    request: TransferPlanRequest,
  ): Promise<TransferPlanResponse> {
    return this.plannerClientService.getClient().planTransferRoute(request);
  }
}
