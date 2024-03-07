import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  MsgCreateClientResponse,
  MsgCreateClient,
  MsgUpdateClient,
  MsgUpdateClientResponse,
} from '../../cosmjs-types/src/ibc/core/client/v1/tx';
import {
  MsgConnectionOpenAck,
  MsgConnectionOpenAckResponse,
  MsgConnectionOpenConfirm,
  MsgConnectionOpenConfirmResponse,
  MsgConnectionOpenInit,
  MsgConnectionOpenInitResponse,
  MsgConnectionOpenTry,
  MsgConnectionOpenTryResponse,
} from '../../cosmjs-types/src/ibc/core/connection/v1/tx';
import {
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
} from '../../cosmjs-types/src/ibc/core/channel/v1/tx';
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
  @GrpcMethod('Msg', 'ConnectionOpenTry')
  async ConnectionOpenTry(data: MsgConnectionOpenTry): Promise<MsgConnectionOpenTryResponse> {
    const response: MsgUpdateClientResponse = await this.connectionService.connectionOpenTry(data);
    return response;
  }
  @GrpcMethod('Msg', 'ConnectionOpenAck')
  async ConnectionOpenAck(data: MsgConnectionOpenAck): Promise<MsgConnectionOpenAckResponse> {
    const response: MsgUpdateClientResponse = await this.connectionService.connectionOpenAck(data);
    return response;
  }
  @GrpcMethod('Msg', 'ConnectionOpenConfirm')
  async ConnectionOpenConfirm(data: MsgConnectionOpenConfirm): Promise<MsgConnectionOpenConfirmResponse> {
    const response: MsgUpdateClientResponse = await this.connectionService.connectionOpenConfirm(data);
    return response;
  }
  @GrpcMethod('Msg', 'ChannelOpenInit')
  async ChannelOpenInit(data: MsgChannelOpenInit): Promise<MsgChannelOpenInitResponse> {
    const response: MsgChannelOpenInitResponse = await this.channelService.channelOpenInit(data);
    return response;
  }
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
}