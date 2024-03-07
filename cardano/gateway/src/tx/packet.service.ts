import { Inject, Injectable, Logger } from '@nestjs/common';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { MsgRecvPacket, MsgRecvPacketResponse, ResponseResultType } from 'cosmjs-types/src/ibc/core/channel/v1/tx';
import { GrpcInternalException, GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { RecvPacketOperator } from './dto/packet/recv-packet-operator.dto';
import { Tx, TxComplete, UTxO } from 'lucid-cardano';
import { parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ChannelDatum } from 'src/shared/types/channel/channel-datum';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { Packet } from 'src/shared/types/channel/packet';
import { SpendChannelRedeemer } from '~@/shared/types/channel/channel-redeemer';
import { ACK_RESULT, CHANNEL_ID_PREFIX, CHANNEL_TOKEN_PREFIX } from '~@/constant';
import { IBCModuleRedeemer } from '~@/shared/types/port/ibc_module_redeemer';
import { insertSortMapWithNumberKey } from '~@/shared/helpers/helper';
import { MockModuleDatum } from '~@/shared/types/apps/mock/mock-module-datum';
import { RpcException } from '@nestjs/microservices';

@Injectable()
export class PacketService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
  ) {}
  async recvPacket(data: MsgRecvPacket): Promise<MsgRecvPacketResponse> {
    try {
      this.logger.log('RecvPacket is processing');
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (!data.packet.destination_channel.startsWith(`${CHANNEL_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "destination_channel". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
        );
      console.dir(data, { depth: 10 });

      // Prepare the Recv packet operator object
      const recvPacketOperator: RecvPacketOperator = {
        channelId: data.packet.destination_channel,
        packetSequence: BigInt(data.packet.sequence),
        packetData: this.lucidService.toBytes(data.packet.data),
        proofCommitment: this.lucidService.toBytes(data.proof_commitment),
        proofHeight: {
          revisionHeight: BigInt(data.proof_height?.revision_height || 0),
          revisionNumber: BigInt(data.proof_height?.revision_number || 0),
        },
        timeoutHeight: {
          revisionHeight: BigInt(data.packet.timeout_height?.revision_height || 0),
          revisionNumber: BigInt(data.packet.timeout_height?.revision_number || 0),
        },
        timeoutTimestamp: BigInt(data.packet?.timeout_timestamp || 0),
      };
      console.dir(recvPacketOperator, { depth: 10 });
      // Build and complete the unsigned transaction
      const unsignedRecvPacketTx: Tx = await this.buildUnsignedRecvPacketTx(recvPacketOperator, constructedAddress);
      const unsignedRecvPacketTxValidTo: Tx = unsignedRecvPacketTx.validTo(Date.now() + 600 * 1e3);

      const unsignedRecvPacketCompleted: TxComplete = await unsignedRecvPacketTxValidTo.complete();

      this.logger.log(unsignedRecvPacketCompleted.toHash(), 'recv packet - unsignedTX - hash');
      const response: MsgRecvPacketResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: unsignedRecvPacketCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgRecvPacketResponse;
      return response;
    } catch (error) {
      console.error(error);

      this.logger.error(`recvPacket: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  async buildUnsignedRecvPacketTx(recvPacketOperator: RecvPacketOperator, constructedAddress: string): Promise<Tx> {
    const channelSequence: string = recvPacketOperator.channelId.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel datum
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    // Get the connection token unit with connection id from channel datum
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(this.lucidService.toText(channelDatum.state.channel.connection_hops[0])),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    // Decode connection datum
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    // Get the token unit associated with the client by connection datum
    const clientTokenUnit = this.lucidService.getClientTokenUnit(
      parseClientSequence(this.lucidService.toText(connectionDatum.state.client_id)),
    );
    // Get client utxo by client unit associated
    const clientUtxo: UTxO = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const mockModuleIdentifier = this.getMockModuleIdentifier();
    // Get mock module utxo
    const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);
    const spendChannelRefUtxo: UTxO = this.getSpendChannelRefUtxo();
    const spendMockModuleRefUtxo: UTxO = this.getSpendMockModuleRefUtxo();
    // channel id
    const channelId = this.lucidService.toHex(recvPacketOperator.channelId);
    // Init packet
    const packet: Packet = {
      sequence: recvPacketOperator.packetSequence,
      source_port: channelDatum.state.channel.counterparty.port_id,
      source_channel: channelDatum.state.channel.counterparty.channel_id,
      destination_port: channelDatum.port,
      destination_channel: channelId,
      data: recvPacketOperator.packetData,
      timeout_height: recvPacketOperator.timeoutHeight,
      timeout_timestamp: recvPacketOperator.timeoutTimestamp,
    };
    // build spend channel redeemer
    const spendChannelRedeemer: SpendChannelRedeemer = {
      RecvPacket: {
        packet: packet,
        proof_commitment: this.lucidService.toHex(recvPacketOperator.proofCommitment),
        proof_height: recvPacketOperator.proofHeight,
      },
    };
    console.dir(spendChannelRedeemer, { depth: 10 });

    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );
    // build mock module redeemer
    const spendMockModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnRecvPacket: {
            channel_id: channelId,
            acknowledgement: {
              response: { AcknowledgementResult: { result: ACK_RESULT } },
            },
          },
        },
      ],
    };

    const encodedSpendMockModuleRedeemer: string = await this.lucidService.encode(
      spendMockModuleRedeemer,
      'iBCModuleRedeemer',
    );

    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        packet_receipt: insertSortMapWithNumberKey(channelDatum.state.packet_receipt, packet.sequence, ''),
        packet_acknowledgement: insertSortMapWithNumberKey(
          channelDatum.state.packet_acknowledgement,
          packet.sequence,
          '08F7557ED51826FE18D84512BF24EC75001EDBAF2123A477DF72A0A9F3640A7C',
        ),
      },
    };
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
    const currentMockModuleDatum = await this.lucidService.decodeDatum<MockModuleDatum>(
      mockModuleUtxo.datum!,
      'mockModule',
    );

    const newMockModuleDatum: MockModuleDatum = {
      ...currentMockModuleDatum,
      received_packets: [recvPacketOperator.packetData, ...currentMockModuleDatum.received_packets],
    };

    const encodedNewMockModuleDatum: string = await this.lucidService.encode<MockModuleDatum>(
      newMockModuleDatum,
      'mockModule',
    );
    return this.lucidService.createUnsignedRecvPacketTransaction(
      channelUtxo,
      connectionUtxo,
      clientUtxo,
      spendChannelRefUtxo,
      spendMockModuleRefUtxo,
      mockModuleUtxo,
      encodedSpendChannelRedeemer,
      encodedSpendMockModuleRedeemer,
      channelTokenUnit,
      encodedUpdatedChannelDatum,
      encodedNewMockModuleDatum,
      constructedAddress,
    );
  }
  private getSpendChannelRefUtxo(): UTxO {
    return this.configService.get('deployment').validators.spendChannel.refUtxo;
  }
  private getSpendMockModuleRefUtxo(): UTxO {
    return this.configService.get('deployment').validators.spendMockModule.refUtxo;
  }
  private getMockModuleIdentifier(): string {
    return this.configService.get('deployment').modules.mock.identifier;
  }
}
