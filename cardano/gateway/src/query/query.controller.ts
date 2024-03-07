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
} from '@cosmjs-types/src/ibc/core/client/v1/query';
import {
  QueryConnectionRequest,
  QueryConnectionResponse,
  QueryConnectionsRequest,
  QueryConnectionsResponse,
} from '@cosmjs-types/src/ibc/core/connection/v1/query';

import {
  QueryChannelRequest,
  QueryChannelResponse,
  QueryChannelsRequest,
  QueryChannelsResponse,
  QueryConnectionChannelsRequest,
  QueryConnectionChannelsResponse,
  QueryPacketAcknowledgementRequest,
  QueryPacketAcknowledgementResponse,
  QueryPacketAcknowledgementsRequest,
  QueryPacketAcknowledgementsResponse,
  QueryPacketCommitmentRequest,
  QueryPacketCommitmentResponse,
  QueryPacketCommitmentsRequest,
  QueryPacketCommitmentsResponse,
} from '@cosmjs-types/src/ibc/core/channel/v1/query';
import { QueryBlockResultsRequest, QueryBlockResultsResponse } from '@cosmjs-types/src/ibc/core/types/v1/query';
import { QueryService } from './services/query.service';
import { ConnectionService } from './services/connection.service';
import { ChannelService } from './services/channel.service';
import { PacketService } from './services/packet.service';

@Controller()
export class QueryController {
  constructor(
    private readonly queryService: QueryService,
    private readonly connectionService: ConnectionService,
    private readonly channelService: ChannelService,
    private readonly packetService: PacketService,
  ) {}

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

  @GrpcMethod('Query', 'BlockResults')
  async BlockResults(request: QueryBlockResultsRequest): Promise<QueryBlockResultsResponse> {
    const response: QueryBlockResultsResponse = await this.queryService.queryBlockResults(request);
    return response as unknown as QueryBlockResultsResponse;
  }

  @GrpcMethod('Query', 'Connections')
  async queryConnections(request: QueryConnectionsRequest): Promise<QueryConnectionsResponse> {
    const response: QueryConnectionsResponse = await this.connectionService.queryConnections(request);
    return response as unknown as QueryConnectionsResponse;
  }

  @GrpcMethod('Query', 'Connection')
  async queryConnection(request: QueryConnectionRequest): Promise<QueryConnectionResponse> {
    const response: QueryConnectionResponse = await this.connectionService.queryConnection(request);
    return response as unknown as QueryConnectionResponse;
  }

  @GrpcMethod('Query', 'Channels')
  async queryChannels(request: QueryChannelsRequest): Promise<QueryChannelsResponse> {
    const response: QueryChannelsResponse = await this.channelService.queryChannels(request);
    return response as unknown as QueryChannelsResponse;
  }

  @GrpcMethod('Query', 'Channel')
  async queryChannel(request: QueryChannelRequest): Promise<QueryChannelResponse> {
    const response: QueryChannelResponse = await this.channelService.queryChannel(request);
    return response as unknown as QueryChannelResponse;
  }

  @GrpcMethod('Query', 'ConnectionChannels')
  async queryConnectionChannels(request: QueryConnectionChannelsRequest): Promise<QueryConnectionChannelsResponse> {
    const response: QueryConnectionChannelsResponse = await this.channelService.queryConnectionChannels(request);
    return response as unknown as QueryConnectionChannelsResponse;
  }

  @GrpcMethod('Query', 'PacketAcknowledgement')
  async queryPacketAcknowledgement(
    request: QueryPacketAcknowledgementRequest,
  ): Promise<QueryPacketAcknowledgementResponse> {
    const response: QueryPacketAcknowledgementResponse = await this.packetService.queryPacketAcknowledgement(request);
    return response as unknown as QueryPacketAcknowledgementResponse;
  }

  @GrpcMethod('Query', 'PacketAcknowledgements')
  async queryPacketAcknowledgements(
    request: QueryPacketAcknowledgementsRequest,
  ): Promise<QueryPacketAcknowledgementsResponse> {
    const response: QueryPacketAcknowledgementsResponse = await this.packetService.queryPacketAcknowledgements(request);
    return response as unknown as QueryPacketAcknowledgementsResponse;
  }

  @GrpcMethod('Query', 'PacketCommitment')
  async queryPacketCommitment(request: QueryPacketCommitmentRequest): Promise<QueryPacketCommitmentResponse> {
    const response: QueryPacketCommitmentResponse = await this.packetService.queryPacketCommitment(request);
    return response as unknown as QueryPacketCommitmentResponse;
  }

  @GrpcMethod('Query', 'PacketCommitments')
  async queryPacketCommitments(request: QueryPacketCommitmentsRequest): Promise<QueryPacketCommitmentsResponse> {
    const response: QueryPacketCommitmentsResponse = await this.packetService.queryPacketCommitments(request);
    return response as unknown as QueryPacketCommitmentsResponse;
  }
}
