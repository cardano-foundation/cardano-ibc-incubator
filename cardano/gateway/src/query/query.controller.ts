import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  QueryClientStateResponse,
  QueryClientStateRequest,
  QueryConsensusStateRequest,
  QueryConsensusStateResponse,
  QueryLatestHeightRequest,
  QueryLatestHeightResponse,
  QueryNewClientRequest,
  QueryNewClientResponse,
  QueryBlockDataRequest,
  QueryBlockDataResponse,
} from '../../cosmjs-types/src/ibc/core/client/v1/query';
import { QueryService } from './query.service';

@Controller()
export class QueryController {
  constructor(private readonly queryService: QueryService) {}

  @GrpcMethod('Query', 'ClientState')
  async queryClientState(request: QueryClientStateRequest): Promise<QueryClientStateResponse> {
    const response: QueryClientStateResponse = await this.queryService.queryClientState(request);
    return response;
  }

  @GrpcMethod('Query', 'ConsensusState')
  async queryConsensusState(data: QueryConsensusStateRequest): Promise<QueryConsensusStateResponse> {
    const response: QueryConsensusStateResponse = await this.queryService.queryConsensusState(data);
    return response;
  }

  @GrpcMethod('Query', 'BlockData')
  async queryBlockData(data: QueryBlockDataRequest): Promise<QueryBlockDataResponse> {
    const response: QueryBlockDataResponse = await this.queryService.queryBlockData(data);
    return response;
  }

  @GrpcMethod('Query', 'LatestHeight')
  async LatestHeight(data: QueryLatestHeightRequest): Promise<QueryLatestHeightResponse> {
    const response: QueryLatestHeightResponse = await this.queryService.latestHeight(data);
    return response;
  }

  @GrpcMethod('Query', 'NewClient')
  async NewClient(request: QueryNewClientRequest): Promise<QueryNewClientResponse> {
    const response: QueryNewClientResponse = await this.queryService.newClient(request);
    return response;
  }
}
