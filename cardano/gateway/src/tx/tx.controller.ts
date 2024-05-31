import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  MsgCreateClientResponse,
  MsgCreateClient,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '@plus/proto-types/build/ibc/core/client/v1/tx';
import {
  MsgConnectionOpenAck,
  MsgConnectionOpenAckResponse,
  MsgConnectionOpenConfirm,
  MsgConnectionOpenConfirmResponse,
  MsgConnectionOpenInit,
  MsgConnectionOpenInitResponse,
  MsgConnectionOpenTry,
  MsgConnectionOpenTryResponse,
} from '@plus/proto-types/build/ibc/core/connection/v1/tx';
import {
  MsgAcknowledgement,
  MsgAcknowledgementResponse,
  MsgChannelOpenAck,
  MsgChannelOpenAckResponse,
  MsgChannelOpenConfirm,
  MsgChannelOpenConfirmResponse,
  MsgChannelOpenInit,
  MsgChannelOpenInitResponse,
  MsgChannelOpenTry,
  MsgChannelOpenTryResponse,
  MsgRecvPacket,
  MsgRecvPacketResponse,
  MsgTimeout,
  MsgTimeoutRefresh,
  MsgTimeoutRefreshResponse,
  MsgTimeoutResponse,
  MsgTransfer,
  MsgTransferResponse,
  MsgChannelCloseInit,
  MsgChannelCloseInitResponse
} from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { ConnectionService } from './connection.service';
import { ClientService } from './client.service';
import { ChannelService } from './channel.service';
import { PacketService } from './packet.service';

@Controller()
export class TxController {
  constructor(
    private readonly clientService: ClientService,
    private readonly connectionService: ConnectionService,
    private readonly channelService: ChannelService,
    private readonly packetService: PacketService,
  ) {}

  @GrpcMethod('Msg', 'CreateClient')
  async CreateClient(data: MsgCreateClient): Promise<MsgCreateClientResponse> {
    const response: MsgCreateClientResponse = await this.clientService.createClient(data);
    return response;
  }
  @GrpcMethod('Msg', 'UpdateClient')
  async UpdateClient(data: MsgUpdateClient): Promise<MsgUpdateClientResponse> {
    const response: MsgUpdateClientResponse = await this.clientService.updateClient(data);
    return response;
  }
  @GrpcMethod('Msg', 'ConnectionOpenInit')
  async ConnectionOpenInit(data: MsgConnectionOpenInit): Promise<MsgConnectionOpenInitResponse> {
    const response: MsgUpdateClientResponse = await this.connectionService.connectionOpenInit(data);
    return response;
  }
  /* istanbul ignore next */
  @GrpcMethod('Msg', 'ConnectionOpenTry')
  async ConnectionOpenTry(data: MsgConnectionOpenTry): Promise<MsgConnectionOpenTryResponse> {
    const response: MsgConnectionOpenTryResponse = await this.connectionService.connectionOpenTry(data);
    return response;
  }
  @GrpcMethod('Msg', 'ConnectionOpenAck')
  async ConnectionOpenAck(data: MsgConnectionOpenAck): Promise<MsgConnectionOpenAckResponse> {
    const response: MsgConnectionOpenAckResponse = await this.connectionService.connectionOpenAck(data);
    return response;
  }
  /* istanbul ignore next */
  @GrpcMethod('Msg', 'ConnectionOpenConfirm')
  async ConnectionOpenConfirm(data: MsgConnectionOpenConfirm): Promise<MsgConnectionOpenConfirmResponse> {
    const response: MsgConnectionOpenConfirmResponse = await this.connectionService.connectionOpenConfirm(data);
    return response;
  }
  @GrpcMethod('Msg', 'ChannelOpenInit')
  async ChannelOpenInit(data: MsgChannelOpenInit): Promise<MsgChannelOpenInitResponse> {
    const response: MsgChannelOpenInitResponse = await this.channelService.channelOpenInit(data);
    return response;
  }
  /* istanbul ignore next */
  @GrpcMethod('Msg', 'ChannelOpenTry')
  async ChannelChannelOpenTry(data: MsgChannelOpenTry): Promise<MsgChannelOpenTryResponse> {
    const response: MsgChannelOpenTryResponse = await this.channelService.channelOpenTry(data);
    return response;
  }
  @GrpcMethod('Msg', 'ChannelOpenAck')
  async ChannelOpenAck(data: MsgChannelOpenAck): Promise<MsgChannelOpenAckResponse> {
    const response: MsgChannelOpenAckResponse = await this.channelService.channelOpenAck(data);
    return response;
  }
  /* istanbul ignore next */
  @GrpcMethod('Msg', 'ChannelOpenConfirm')
  async ChannelOpenConfirm(data: MsgChannelOpenConfirm): Promise<MsgChannelOpenConfirmResponse> {
    const response: MsgChannelOpenConfirmResponse = await this.channelService.channelOpenConfirm(data);
    return response;
  }
  @GrpcMethod('Msg', 'RecvPacket')
  async RecvPacket(data: MsgRecvPacket): Promise<MsgRecvPacketResponse> {
    const response: MsgRecvPacketResponse = await this.packetService.recvPacket(data);
    return response;
  }
  @GrpcMethod('Msg', 'Transfer')
  async Transfer(data: MsgTransfer): Promise<MsgTransferResponse> {
    const response: MsgTransferResponse = await this.packetService.sendPacket(data);
    return response;
  }
  @GrpcMethod('Msg', 'Acknowledgement')
  async Acknowledgement(data: MsgAcknowledgement): Promise<MsgAcknowledgementResponse> {
    const response: MsgAcknowledgementResponse = await this.packetService.acknowledgementPacket(data);
    return response;
  }
  @GrpcMethod('Msg', 'Timeout')
  async Timeout(data: MsgTimeout): Promise<MsgTimeoutResponse> {
    const response: MsgTimeoutResponse = await this.packetService.timeoutPacket(data);
    return response;
  }
  @GrpcMethod('Msg', 'TimeoutRefresh')
  async TimeoutRefresh(data: MsgTimeoutRefresh): Promise<MsgTimeoutRefreshResponse> {
    const response: MsgTimeoutRefreshResponse = await this.packetService.timeoutRefresh(data);
    return response;
  }
  @GrpcMethod('Msg', 'ChannelCloseInit')
  async ChannelCloseInit(data: MsgChannelCloseInit): Promise<MsgChannelCloseInitResponse> {
    const response: MsgChannelCloseInitResponse = await this.channelService.channelCloseInit(data);
    return response;
  }
}
