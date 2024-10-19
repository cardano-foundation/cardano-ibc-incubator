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
} from '@plus/proto-types/build/ibc/core/client/v1/query';
import {
  QueryConnectionRequest,
  QueryConnectionResponse,
  QueryConnectionsRequest,
  QueryConnectionsResponse,
} from '@plus/proto-types/build/ibc/core/connection/v1/query';

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
  QueryPacketReceiptRequest,
  QueryPacketReceiptResponse,
  QueryUnreceivedPacketsRequest,
  QueryUnreceivedPacketsResponse,
  QueryUnreceivedAcksRequest,
  QueryUnreceivedAcksResponse,
  QueryProofUnreceivedPacketsRequest,
  QueryProofUnreceivedPacketsResponse,
  QueryNextSequenceReceiveRequest,
  QueryNextSequenceReceiveResponse,
} from '@plus/proto-types/build/ibc/core/channel/v1/query';
import {
  QueryBlockResultsRequest,
  QueryBlockResultsResponse,
  QueryBlockSearchRequest,
  QueryBlockSearchResponse,
  QueryTransactionByHashRequest,
  QueryTransactionByHashResponse,
  QueryIBCHeaderRequest,
  QueryIBCHeaderResponse,
} from '@plus/proto-types/build/ibc/core/types/v1/query';
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
    const response: QueryNewClientResponse = await this.queryService.queryNewMithrilClient(request);
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

  @GrpcMethod('Query', 'PacketReceipt')
  async queryPacketReceipt(request: QueryPacketReceiptRequest): Promise<QueryPacketReceiptResponse> {
    const response: QueryPacketReceiptResponse = await this.packetService.queryPacketReceipt(request);
    return response as unknown as QueryPacketReceiptResponse;
  }
  // write api query UnreceivedPackets
  @GrpcMethod('Query', 'UnreceivedPackets')
  async queryUnreceivedPackets(request: QueryUnreceivedPacketsRequest): Promise<QueryUnreceivedPacketsResponse> {
    const response: QueryUnreceivedPacketsResponse = await this.packetService.queryUnreceivedPackets(request);
    return response as unknown as QueryUnreceivedPacketsResponse;
  }
  @GrpcMethod('Query', 'UnreceivedAcks')
  async queryUnreceivedAcknowledgements(request: QueryUnreceivedAcksRequest): Promise<QueryUnreceivedAcksResponse> {
    const response: QueryUnreceivedAcksResponse = await this.packetService.queryUnreceivedAcks(request);
    return response as unknown as QueryUnreceivedAcksResponse;
  }
  @GrpcMethod('Query', 'BlockSearch')
  async queryBlockSearch(request: QueryBlockSearchRequest): Promise<QueryBlockSearchResponse> {
    const response: QueryBlockSearchResponse = await this.queryService.queryBlockSearch(request);
    return response as unknown as QueryBlockSearchResponse;
  }
  @GrpcMethod('Query', 'TransactionByHash')
  async queryTransactionByHash(request: QueryTransactionByHashRequest): Promise<QueryTransactionByHashResponse> {
    const response: QueryTransactionByHashResponse = await this.queryService.queryTransactionByHash(request);
    return response as unknown as QueryTransactionByHashResponse;
  }
  @GrpcMethod('Query', 'ProofUnreceivedPackets')
  async queryProofUnreceivedPackets(
    request: QueryProofUnreceivedPacketsRequest,
  ): Promise<QueryProofUnreceivedPacketsResponse> {
    const response: QueryProofUnreceivedPacketsResponse = await this.packetService.queryProofUnreceivedPackets(request);
    return response as unknown as QueryProofUnreceivedPacketsResponse;
  }

  @GrpcMethod('Query', 'IBCHeader')
  async queryIBCHeader(request: QueryIBCHeaderRequest): Promise<QueryIBCHeaderResponse> {
    const response: QueryIBCHeaderResponse = await this.queryService.queryIBCHeader(request);
    return response as unknown as QueryIBCHeaderResponse;
  }
  @GrpcMethod('Query', 'NextSequenceReceive')
  async queryNextSequenceReceive(request: QueryNextSequenceReceiveRequest): Promise<QueryNextSequenceReceiveResponse> {
    const response: QueryNextSequenceReceiveResponse = await this.packetService.queryNextSequenceReceive(request);
    return response as unknown as QueryNextSequenceReceiveResponse;
  }
  @GrpcMethod('Query', 'NextSequenceAck')
  async queryNextSequenceAck(request: QueryNextSequenceReceiveRequest): Promise<QueryNextSequenceReceiveResponse> {
    const response: QueryNextSequenceReceiveResponse = await this.packetService.QueryNextSequenceAck(request);
    return response as unknown as QueryNextSequenceReceiveResponse;
  }
}
