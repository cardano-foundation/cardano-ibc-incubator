import { Injectable, Logger } from '@nestjs/common';
import {
  QueryClientStateRequest,
  QueryClientStateResponse,
  QueryConsensusStateRequest,
  QueryConsensusStateResponse,
} from '@plus/proto-types/build/ibc/core/client/v1/query';
import { QueryConnectionRequest, QueryConnectionResponse } from '@plus/proto-types/build/ibc/core/connection/v1/query';
import {
  QueryChannelRequest,
  QueryChannelResponse,
  QueryNextSequenceReceiveRequest,
  QueryNextSequenceReceiveResponse,
  QueryPacketCommitmentRequest,
  QueryPacketCommitmentResponse,
  QueryPacketReceiptRequest,
  QueryPacketReceiptResponse,
} from '@plus/proto-types/build/ibc/core/channel/v1/query';
import { QueryService } from 'src/query/services/query.service';
import { ConnectionService } from 'src/query/services/connection.service';
import { ChannelService } from 'src/query/services/channel.service';
import { PacketService as QueryPacketService } from 'src/query/services/packet.service';
import { AcknowledgementResponse } from '@shared/types/channel/acknowledgement_response';
import {
  ASYNC_ICQ_ALLOWED_QUERY_PATHS,
  CosmosResponse,
  TendermintRequestQuery,
  TendermintResponseQuery,
  decodeCosmosQuery,
  decodeInterchainQueryPacketDataJson,
  encodeCosmosResponse,
  encodeInterchainQueryPacketAckJson,
} from '@shared/types/apps/async-icq/async-icq';
import { convertString2Hex } from '@shared/helpers/hex';

@Injectable()
export class AsyncIcqHostService {
  constructor(
    private readonly logger: Logger,
    private readonly queryService: QueryService,
    private readonly connectionService: ConnectionService,
    private readonly channelService: ChannelService,
    private readonly queryPacketService: QueryPacketService,
  ) {}

  async executePacket(
    packetData: Uint8Array,
  ): Promise<{ acknowledgementResponse: AcknowledgementResponse; executionHeight: bigint }> {
    let executionHeight = BigInt(0);

    try {
      // Capture the current host height once so every RequestQuery in the packet
      // executes against the same Cardano IBC snapshot.
      executionHeight = await this.getExecutionHeight();
      const packet = decodeInterchainQueryPacketDataJson(packetData);
      const cosmosQuery = decodeCosmosQuery(packet.data);

      if (cosmosQuery.requests.length === 0) {
        throw new Error('async-icq packet must contain at least one request');
      }

      const responses: TendermintResponseQuery[] = [];

      for (let index = 0; index < cosmosQuery.requests.length; index += 1) {
        responses.push(await this.executeRequest(cosmosQuery.requests[index], executionHeight, index));
      }

      // The inner async-icq ack bytes are then wrapped into the gateway's normal
      // acknowledgement format, which stores the result payload as a hex string.
      const ackBytes = encodeInterchainQueryPacketAckJson({
        data: encodeCosmosResponse({ responses } satisfies CosmosResponse),
      });

      return {
        acknowledgementResponse: {
          AcknowledgementResult: {
            result: convertString2Hex(Buffer.from(ackBytes).toString('base64')),
          },
        },
        executionHeight,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`async-icq host execution failed: ${message}`);
      return {
        acknowledgementResponse: {
          AcknowledgementError: {
            err: convertString2Hex(message),
          },
        },
        executionHeight,
      };
    }
  }

  private async getExecutionHeight(): Promise<bigint> {
    const latestHeight = (await this.queryService.latestHeight({})).height;
    return BigInt(latestHeight.toString());
  }

  private authenticateRequest(query: TendermintRequestQuery, executionHeight: bigint): void {
    // Match the upstream async-icq host rules: allowlisted paths only, no
    // arbitrary historical heights, and no proof-bearing requests.
    if (!ASYNC_ICQ_ALLOWED_QUERY_PATHS.includes(query.path as (typeof ASYNC_ICQ_ALLOWED_QUERY_PATHS)[number])) {
      throw new Error(`async-icq query path not allowed: ${query.path}`);
    }

    if (!(query.height === BigInt(0) || query.height === executionHeight)) {
      throw new Error(`async-icq query height not allowed: ${query.height.toString()}`);
    }

    if (query.prove) {
      throw new Error('async-icq query proof not allowed');
    }
  }

  private async executeRequest(
    query: TendermintRequestQuery,
    executionHeight: bigint,
    index: number,
  ): Promise<TendermintResponseQuery> {
    this.authenticateRequest(query, executionHeight);

    let value: Uint8Array;

    // Translate the async-icq RequestQuery path into the gateway's native Cardano
    // query service, then re-encode that response into the protobuf bytes expected
    // inside Tendermint ResponseQuery.value.
    switch (query.path) {
      case '/ibc.core.client.v1.Query/ClientState': {
        const request = QueryClientStateRequest.decode(query.data);
        const response = await this.queryService.queryClientState(request);
        value = QueryClientStateResponse.encode(response).finish();
        break;
      }
      case '/ibc.core.client.v1.Query/ConsensusState': {
        const request = QueryConsensusStateRequest.decode(query.data);
        const response = await this.queryService.queryConsensusState(request);
        value = QueryConsensusStateResponse.encode(response).finish();
        break;
      }
      case '/ibc.core.connection.v1.Query/Connection': {
        const request = QueryConnectionRequest.decode(query.data);
        const response = await this.connectionService.queryConnection(request);
        value = QueryConnectionResponse.encode(response).finish();
        break;
      }
      case '/ibc.core.channel.v1.Query/Channel': {
        const request = QueryChannelRequest.decode(query.data);
        const response = await this.channelService.queryChannel(request);
        value = QueryChannelResponse.encode(response).finish();
        break;
      }
      case '/ibc.core.channel.v1.Query/PacketCommitment': {
        const request = QueryPacketCommitmentRequest.decode(query.data);
        const response = await this.queryPacketService.queryPacketCommitment(request);
        value = QueryPacketCommitmentResponse.encode(response).finish();
        break;
      }
      case '/ibc.core.channel.v1.Query/PacketReceipt': {
        const request = QueryPacketReceiptRequest.decode(query.data);
        const response = await this.queryPacketService.queryPacketReceipt(request);
        value = QueryPacketReceiptResponse.encode(response).finish();
        break;
      }
      case '/ibc.core.channel.v1.Query/NextSequenceReceive': {
        const request = QueryNextSequenceReceiveRequest.decode(query.data);
        const response = await this.queryPacketService.queryNextSequenceReceive(request);
        value = QueryNextSequenceReceiveResponse.encode(response).finish();
        break;
      }
      default:
        throw new Error(`async-icq query path not implemented: ${query.path}`);
    }

    // Keep only the stable fields that async-icq needs in the ack payload.
    return {
      code: 0,
      log: '',
      info: '',
      index: BigInt(index),
      key: new Uint8Array(),
      value,
      height: executionHeight,
      codespace: '',
    };
  }
}
