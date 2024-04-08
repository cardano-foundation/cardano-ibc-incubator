import { Inject, Injectable, Logger } from '@nestjs/common';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import {
  MsgAcknowledgement,
  MsgAcknowledgementResponse,
  MsgRecvPacket,
  MsgRecvPacketResponse,
  MsgTimeout,
  MsgTimeoutRefresh,
  MsgTimeoutRefreshResponse,
  MsgTimeoutResponse,
  MsgTransfer,
  MsgTransferResponse,
  ResponseResultType,
} from 'cosmjs-types/src/ibc/core/channel/v1/tx';
import { MerkleProof as MerkleProofMsg } from '@cosmjs-types/src/ibc/core/commitment/v1/commitment';
import { GrpcInternalException, GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { RecvPacketOperator } from './dto/packet/recv-packet-operator.dto';
import { Tx, TxComplete, UTxO } from '@dinhbx/lucid-custom';
import { parseChannelSequence, parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ChannelDatum } from 'src/shared/types/channel/channel-datum';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { Packet } from 'src/shared/types/channel/packet';
import { initializeMerkleProof } from '@shared/helpers/merkle-proof';
import { SpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';
import { ACK_RESULT, CHANNEL_ID_PREFIX, LOVELACE, PORT_ID_PREFIX, TRANSFER_MODULE_PORT } from 'src/constant';
import { IBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import {
  deleteKeySortMap,
  deleteSortMap,
  getDenomPrefix,
  insertSortMapWithNumberKey,
  sortedStringify,
} from '@shared/helpers/helper';
import { RpcException } from '@nestjs/microservices';
import { SendPacketOperator } from './dto/packet/send-packet-operator.dto';
import {
  FungibleTokenPacketDatum,
  castToFungibleTokenPacket,
} from '@shared/types/apps/transfer/types/fungible-token-packet-data';
import { UnsignedSendPacketEscrowDto } from '../shared/modules/lucid/dtos/packet/send-packet-escrow.dto';
import { TransferModuleRedeemer } from '../shared/types/apps/transfer/transfer_module_redeemer/transfer-module-redeemer';
import { normalizeDenomTokenTransfer } from './helper/helper';
import { convertHex2String, convertString2Hex, hashSHA256, hashSha3_256, toHex } from '../shared/helpers/hex';
import { UnsignedRecvPacketUnescrowDto } from '@shared/modules/lucid/dtos/packet/recv-packet-unescrow.dto';
import { UnsignedRecvPacketMintDto } from '@shared/modules/lucid/dtos/packet/recv-packet-mint.dto';
import { MintVoucherRedeemer } from '@shared/types/apps/transfer/mint_voucher_redeemer/mint-voucher-redeemer';
import { commitPacket } from '../shared/helpers/commitment';
import { UnsignedAckPacketUnescrowDto } from '../shared/modules/lucid/dtos/packet/ack-packet-unescrow.dto';
import { AckPacketOperator } from './dto/packet/ack-packet-operator.dto';
import { UnsignedAckPacketMintDto } from '../shared/modules/lucid/dtos/packet/ack-packet-mint.dto';
import { UnsignedSendPacketBurnDto } from '../shared/modules/lucid/dtos/packet/send-packet-burn.dto';
import { ClientDatum } from '@shared/types/client-datum';
import { TimeoutPacketOperator } from './dto/packet/time-out-packet-operator.dto';
import { UnsignedTimeoutPacketMintDto } from '@shared/modules/lucid/dtos/packet/timeout-packet-mint.dto';
import { UnsignedTimeoutPacketUnescrowDto } from '@shared/modules/lucid/dtos/packet/timeout-packet-unescrow.dto';
import { isValidProofHeight } from './helper/height.validate';
import { TimeoutRefreshOperator } from './dto/packet/timeout-resfresh-operator.dto';
import { UnsignedTimeoutRefreshDto } from '@shared/modules/lucid/dtos/packet/timeout-refresh-dto';
import { AcknowledgementResponse } from '@shared/types/channel/acknowledgement_response';
import { UnsignedAckPacketSucceedDto } from '@shared/modules/lucid/dtos/packet/ack-packet-succeed.dto';
import {
  validateAndFormatAcknowledgementPacketParams,
  validateAndFormatRecvPacketParams,
  validateAndFormatSendPacketParams,
  validateAndFormatTimeoutPacketParams,
} from './helper/packet.validate';

@Injectable()
export class PacketService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
  ) {}
  /**
   *
   * @param data
   * @returns unsigned_tx
   * 1. check validate port transfer
   * 2. check denom with voucher prefix
   * - yes => recv_unescrow
   * - no => recv_mint
   */
  async recvPacket(data: MsgRecvPacket): Promise<MsgRecvPacketResponse> {
    try {
      this.logger.log('RecvPacket is processing');

      const { constructedAddress, recvPacketOperator } = validateAndFormatRecvPacketParams(data);

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
  async sendPacket(data: MsgTransfer): Promise<MsgTransferResponse> {
    try {
      this.logger.log('Transfer is processing');
      const sendPacketOperator = validateAndFormatSendPacketParams(data);

      const unsignedSendPacketTx: Tx = await this.buildUnsignedSendPacketTx(sendPacketOperator);

      const unsignedSendPacketTxValidTo: Tx = unsignedSendPacketTx.validTo(Date.now() + 600 * 1e3);

      const unsignedSendPacketTxCompleted: TxComplete = await unsignedSendPacketTxValidTo.complete();

      this.logger.log(unsignedSendPacketTxCompleted.toHash(), 'send packet - unsignedTX - hash');
      const response: MsgRecvPacketResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: unsignedSendPacketTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgRecvPacketResponse;
      return response;
    } catch (error) {
      console.error(error);
      this.logger.error(`Transfer: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      }

      throw error;
    }
  }
  /**
   * Handles an IBC packet timeout by building and signing a timeout transaction.
   * This function prepares the timeout packet data from the MsgTimeout request,
   * builds an unsigned timeout transaction and returns it
   */
  async timeoutPacket(data: MsgTimeout): Promise<MsgTimeoutResponse> {
    try {
      this.logger.log('timeoutPacket is processing');
      const { constructedAddress, timeoutPacketOperator } = validateAndFormatTimeoutPacketParams(data);
      const unsignedSendPacketTx: Tx = await this.buildUnsignedTimeoutPacketTx(
        timeoutPacketOperator,
        constructedAddress,
      );
      const unsignedSendPacketTxValidTo: Tx = unsignedSendPacketTx.validTo(Date.now() + 600 * 1e3);

      const unsignedSendPacketTxCompleted: TxComplete = await unsignedSendPacketTxValidTo.complete();

      this.logger.log(unsignedSendPacketTxCompleted.toHash(), 'timeout packet - unsignedTX - hash');
      const response: MsgTimeoutResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: unsignedSendPacketTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgTimeoutResponse;
      return response;
    } catch (error) {
      this.logger.error(`Timeout: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      }

      throw error;
    }
  }
  /**
   * Handles a timeout refresh by building and signing a timeout refresh transaction.
   * This function prepares the timeout refresh data from the MsgTimeoutRefresh request,
   * builds an unsigned timeout refresh transaction and return it
   */
  async timeoutRefresh(data: MsgTimeoutRefresh): Promise<MsgTimeoutRefreshResponse> {
    try {
      this.logger.log('TimeoutRefresh is processing');

      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (!data.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
        );
      // Prepare the timeout refresh operator object
      const timeoutRefreshOperator: TimeoutRefreshOperator = {
        channelId: data.channel_id,
      };

      // Build and complete the unsigned transaction
      const unsignedTimeoutRefreshTx: Tx = await this.buildUnsignedTimeoutRefreshTx(
        timeoutRefreshOperator,
        constructedAddress,
      );
      const unsignedTimeoutRefreshTxValidTo: Tx = unsignedTimeoutRefreshTx.validTo(Date.now() + 600 * 1e3);

      const unsignedTimeoutRefreshCompleted: TxComplete = await unsignedTimeoutRefreshTxValidTo.complete();

      this.logger.log(unsignedTimeoutRefreshCompleted.toHash(), 'TimeoutRefresh - unsignedTX - hash');
      const response: MsgTimeoutRefreshResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedTimeoutRefreshCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgTimeoutRefreshResponse;
      return response;
    } catch (error) {
      console.error(error);

      this.logger.error(`Timeout refresh: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  async acknowledgementPacket(data: MsgAcknowledgement): Promise<MsgAcknowledgementResponse> {
    try {
      this.logger.log('AcknowledgementPacket is processing');

      const { constructedAddress, ackPacketOperator } = validateAndFormatAcknowledgementPacketParams(data);

      // Build and complete the unsigned transaction
      const unsignedAckPacketTx: Tx = await this.buildUnsignedAcknowlegementPacketTx(
        ackPacketOperator,
        constructedAddress,
      );
      const unsignedAckPacketTxValidTo: Tx = unsignedAckPacketTx.validTo(Date.now() + 600 * 1e3);

      const unsignedAckPacketCompleted: TxComplete = await unsignedAckPacketTxValidTo.complete();

      this.logger.log(unsignedAckPacketCompleted.toHash(), 'ack packet - unsignedTX - hash');
      const response: MsgAcknowledgementResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: unsignedAckPacketCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgAcknowledgementResponse;
      return response;
    } catch (error) {
      console.error(error);
      this.logger.error(`AckPacket: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  async buildUnsignedTimeoutRefreshTx(
    timeoutRefreshOperator: TimeoutRefreshOperator,
    constructedAddress: string,
  ): Promise<Tx> {
    const channelSequence: string = timeoutRefreshOperator.channelId.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel datum
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');

    const encodedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(channelDatum, 'channel');
    // build spend channel redeemer
    const spendChannelRedeemer: SpendChannelRedeemer = 'RefreshUtxo';
    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );
    const spendChannelRefUtxo: UTxO = this.getSpendChannelRefUtxo();
    const unsignedTimeoutRefreshParams: UnsignedTimeoutRefreshDto = {
      channelUtxo,
      spendChannelRefUTxO: spendChannelRefUtxo,
      encodedSpendChannelRedeemer,
      encodedChannelDatum,
      channelTokenUnit,
      constructedAddress,
    };
    return this.lucidService.createUnsignedTimeoutRefreshTx(unsignedTimeoutRefreshParams);
  }
  async buildUnsignedRecvPacketTx(recvPacketOperator: RecvPacketOperator, constructedAddress: string): Promise<Tx> {
    const channelSequence: string = recvPacketOperator.channelId.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel datum
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    const channelEnd = channelDatum.state.channel;
    if (channelEnd.state !== 'Open') {
      throw new Error('SendPacket to channel not in Open state');
    }

    const fungibleTokenPacketData: FungibleTokenPacketDatum = JSON.parse(
      convertHex2String(recvPacketOperator.packetData),
    );

    this.logger.log('buildUnsignedRecvPacketTx: ', {
      fungibleTokenPacketData,
    });

    // Get the connection token unit with connection id from channel datum
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])),
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
      parseClientSequence(convertHex2String(connectionDatum.state.client_id)),
    );
    // Get client utxo by client unit associated
    const clientUtxo: UTxO = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const clientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');
    // Get the keys (heights) of the map and convert them into an array
    const heightsArray = Array.from(clientDatum.state.consensusStates.keys());

    if (!isValidProofHeight(heightsArray, recvPacketOperator.proofHeight.revisionHeight)) {
      throw new GrpcInternalException(`Invalid proof height: ${recvPacketOperator.proofHeight.revisionHeight}`);
    }
    const transferModuleIdentifier = this.getTransferModuleIdentifier();
    // Get mock module utxo
    const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
    const spendChannelRefUtxo: UTxO = this.getSpendChannelRefUtxo();
    const spendTransferModuleRefUtxo: UTxO = this.getSpendTransferModuleRefUtxo();
    // channel id
    const channelId = convertString2Hex(recvPacketOperator.channelId);
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
        proof_commitment: recvPacketOperator.proofCommitment,
        proof_height: recvPacketOperator.proofHeight,
      },
    };
    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );

    // build update channel datum
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

    // build transfer module redeemer
    const fTokenPacketData: FungibleTokenPacketDatum = {
      denom: convertString2Hex(fungibleTokenPacketData.denom),
      amount: convertString2Hex(fungibleTokenPacketData.amount),
      sender: convertString2Hex(fungibleTokenPacketData.sender),
      receiver: convertString2Hex(fungibleTokenPacketData.receiver),
      memo: convertString2Hex(fungibleTokenPacketData.memo),
    };

    const spendTransferModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnRecvPacket: {
            channel_id: channelId,
            data: castToFungibleTokenPacket(fTokenPacketData, this.lucidService.LucidImporter),
            acknowledgement: {
              response: { AcknowledgementResult: { result: ACK_RESULT } },
            },
          },
        },
      ],
    };

    const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
      spendTransferModuleRedeemer,
      'iBCModuleRedeemer',
    );

    if (
      this._hasVoucherPrefix(
        fungibleTokenPacketData.denom,
        convertHex2String(packet.destination_port),
        convertHex2String(packet.destination_channel),
      )
    ) {
      this.logger.log('recv unescrow');
      const unsignedRecvPacketUnescrowParams: UnsignedRecvPacketUnescrowDto = {
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        spendChannelRefUtxo,
        spendTransferModuleRefUtxo,
        transferModuleUtxo,

        encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer,
        channelTokenUnit,
        encodedUpdatedChannelDatum,
        transferAmount: BigInt(fungibleTokenPacketData.amount),
        receiverAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.receiver),
        constructedAddress,
      };
      return this.lucidService.createUnsignedRecvPacketUnescrowTx(unsignedRecvPacketUnescrowParams);
    }
    this.logger.log('recv mint');

    // build encode mint voucher redeemer
    const mintVoucherRedeemer: MintVoucherRedeemer = {
      MintVoucher: {
        packet_source_port: packet.source_port,
        packet_source_channel: packet.source_channel,
        packet_dest_port: packet.destination_port,
        packet_dest_channel: packet.destination_channel,
      },
    };
    const encodedMintVoucherRedeemer: string = await this.lucidService.encode(
      mintVoucherRedeemer,
      'mintVoucherRedeemer',
    );

    // add prefix voucher prefix with denom token
    const sourcePrefix = getDenomPrefix(
      convertHex2String(packet.destination_port),
      convertHex2String(packet.destination_channel),
    );

    const prefixedDenom = convertString2Hex(sourcePrefix + fungibleTokenPacketData.denom);
    const voucherTokenName = hashSha3_256(prefixedDenom);
    const voucherTokenUnit = this.configService.get('deployment').validators.mintVoucher.scriptHash + voucherTokenName;
    const unsignedRecvPacketMintParams: UnsignedRecvPacketMintDto = {
      channelUtxo,
      connectionUtxo,
      clientUtxo,
      spendChannelRefUtxo,
      spendTransferModuleRefUtxo,
      transferModuleUtxo,
      mintVoucherRefUtxo: this.getMintVoucherRefUtxo(),

      encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer,
      encodedMintVoucherRedeemer,
      encodedUpdatedChannelDatum,

      channelTokenUnit,
      voucherTokenUnit,
      transferAmount: BigInt(fungibleTokenPacketData.amount),
      receiverAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.receiver),
      constructedAddress,
    };

    // handle recv packet mint
    return this.lucidService.createUnsignedRecvPacketMintTx(unsignedRecvPacketMintParams);
  }
  async buildUnsignedTimeoutPacketTx(
    timeoutPacketOperator: TimeoutPacketOperator,
    constructedAddress: string,
  ): Promise<Tx> {
    const channelSequence = parseChannelSequence(convertHex2String(timeoutPacketOperator.packet.source_channel));
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel end
    const channelDatum: ChannelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    // Get the connection token unit with connection id from channel datum
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])),
    );
    const connectionTokenUnit: string = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo: UTxO = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    // Decode connection datum
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    // Get the token unit associated with the client by connection datum
    const clientTokenUnit: string = this.lucidService.getClientTokenUnit(
      parseClientSequence(convertHex2String(connectionDatum.state.client_id)),
    );
    // Get client utxo by client unit associated
    const clientUtxo: UTxO = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const clientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');
    // Get the keys (heights) of the map and convert them into an array
    const heightsArray = Array.from(clientDatum.state.consensusStates.keys());
    // Check if consensus state includes the proof height
    if (!isValidProofHeight(heightsArray, timeoutPacketOperator.proofHeight.revisionHeight)) {
      throw new GrpcInternalException(`Invalid proof height: ${timeoutPacketOperator.proofHeight.revisionHeight}`);
    }
    const packetSequence: bigint = timeoutPacketOperator.packet.sequence;
    const packet: Packet = timeoutPacketOperator.packet;
    // update channel datum
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        packet_commitment: deleteSortMap(channelDatum.state.packet_commitment, packetSequence),
      },
    };
    const spendChannelRedeemer: SpendChannelRedeemer = {
      TimeoutPacket: {
        packet: packet,
        proof_unreceived: timeoutPacketOperator.proofUnreceived,
        proof_height: timeoutPacketOperator.proofHeight,
        next_sequence_recv: timeoutPacketOperator.nextSequenceRecv,
      },
    };
    // const deploymentConfig = this.configService.get('deployment');
    const { transferModuleUtxo, transferModuleAddress, spendChannelAddress } = await this.getTransferModuleDetails();
    const { spendChannelRefUtxo, spendTransferModuleUtxo } = this.getSpendUtxos();
    const transferAmount = BigInt(timeoutPacketOperator.fungibleTokenPacketData.amount);
    const senderPublicKeyHash = timeoutPacketOperator.fungibleTokenPacketData.sender;
    let denom =
      timeoutPacketOperator.fungibleTokenPacketData.denom === convertString2Hex(LOVELACE)
        ? convertHex2String(timeoutPacketOperator.fungibleTokenPacketData.denom)
        : timeoutPacketOperator.fungibleTokenPacketData.denom;
    const spendTransferModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnTimeoutPacket: {
            channel_id: packet.source_channel,
            data: castToFungibleTokenPacket(
              {
                denom: convertString2Hex(timeoutPacketOperator.fungibleTokenPacketData.denom),
                amount: convertString2Hex(timeoutPacketOperator.fungibleTokenPacketData.amount.toString()),
                sender: convertString2Hex(senderPublicKeyHash),
                receiver: convertString2Hex(timeoutPacketOperator.fungibleTokenPacketData.receiver),
                memo: convertString2Hex(timeoutPacketOperator.fungibleTokenPacketData.memo),
              },
              this.lucidService.LucidImporter,
            ),
          },
        },
      ],
    };
    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );

    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
    const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
      spendTransferModuleRedeemer,
      'iBCModuleRedeemer',
    );
    const voucherHasPrefix = this._hasVoucherPrefix(
      timeoutPacketOperator.fungibleTokenPacketData.denom,
      convertHex2String(packet.source_port),
      convertHex2String(packet.source_channel),
    );

    if (!voucherHasPrefix) {
      this.logger.log(denom, 'unescrow timeout processing');

      const unsignedSendPacketParams: UnsignedTimeoutPacketUnescrowDto = {
        spendChannelRefUtxo: spendChannelRefUtxo,
        channelUtxo: channelUtxo,
        transferModuleUtxo: transferModuleUtxo,
        connectionUtxo: connectionUtxo,
        clientUtxo: clientUtxo,
        spendTransferModuleUtxo: spendTransferModuleUtxo,

        encodedSpendChannelRedeemer: encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer: encodedSpendTransferModuleRedeemer,
        encodedUpdatedChannelDatum: encodedUpdatedChannelDatum,

        transferAmount: transferAmount,
        channelTokenUnit: channelTokenUnit,
        spendChannelAddress: spendChannelAddress,
        transferModuleAddress: transferModuleAddress,
        denomToken: normalizeDenomTokenTransfer(denom),
        senderAddress: this.lucidService.credentialToAddress(senderPublicKeyHash),

        constructedAddress: constructedAddress,
      };
      return this.lucidService.createUnsignedTimeoutPacketUnescrowTx(unsignedSendPacketParams);
    }
    this.logger.log(timeoutPacketOperator.fungibleTokenPacketData.denom, 'mint timeout processing');
    // const prefixedDenom = convertString2Hex(sourcePrefix + denom);
    const prefixedDenom = convertString2Hex(denom);
    const spendTransferModuleRefUtxo: UTxO = this.getSpendTransferModuleRefUtxo();
    const mintVoucherRedeemer: MintVoucherRedeemer = {
      RefundVoucher: {
        packet_source_port: packet.source_port,
        packet_source_channel: packet.source_channel,
      },
    };
    const voucherTokenName = hashSha3_256(prefixedDenom);
    const voucherTokenUnit = this.getMintVoucherScriptHash() + voucherTokenName;

    const mintVoucherRefUtxo = this.getMintVoucherRefUtxo();
    const encodedMintVoucherRedeemer: string = await this.lucidService.encode(
      mintVoucherRedeemer,
      'mintVoucherRedeemer',
    );
    const unsignedTimeoutPacketMintDto: UnsignedTimeoutPacketMintDto = {
      spendChannelRefUtxo: spendChannelRefUtxo,
      spendTransferModuleRefUtxo: spendTransferModuleRefUtxo,
      mintVoucherRefUtxo: mintVoucherRefUtxo,
      channelUtxo: channelUtxo,
      transferModuleUtxo: transferModuleUtxo,
      connectionUtxo: connectionUtxo,
      clientUtxo: clientUtxo,

      encodedSpendChannelRedeemer: encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer: encodedSpendTransferModuleRedeemer,
      encodedMintVoucherRedeemer: encodedMintVoucherRedeemer,
      encodedUpdatedChannelDatum: encodedUpdatedChannelDatum,

      transferAmount: transferAmount,
      senderAddress: this.lucidService.credentialToAddress(senderPublicKeyHash),

      spendChannelAddress: spendChannelAddress,
      channelTokenUnit: channelTokenUnit,
      transferModuleAddress: transferModuleAddress,
      voucherTokenUnit: voucherTokenUnit,
      constructedAddress: constructedAddress,
    };
    return this.lucidService.createUnsignedTimeoutPacketMintTx(unsignedTimeoutPacketMintDto);
  }
  async buildUnsignedSendPacketTx(sendPacketOperator: SendPacketOperator): Promise<Tx> {
    const channelSequence: string = sendPacketOperator.sourceChannel.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel datum
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    // Get the connection token unit with connection id from channel datum
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])),
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
      parseClientSequence(convertHex2String(connectionDatum.state.client_id)),
    );
    // Get client utxo by client unit associated
    const clientUtxo: UTxO = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const transferModuleIdentifier = this.getTransferModuleIdentifier();
    // Get transfer module utxo
    const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
    const spendChannelRefUtxo: UTxO = this.getSpendChannelRefUtxo();
    const spendTransferModuleRefUtxo: UTxO = this.getSpendTransferModuleRefUtxo();
    // channel id
    const channelId = convertString2Hex(sendPacketOperator.sourceChannel);

    // build transfer module redeemer
    let denom =
      sendPacketOperator.token.denom === LOVELACE
        ? convertString2Hex(sendPacketOperator.token.denom)
        : sendPacketOperator.token.denom;
    // fungible token packet data
    const fTokenPacketData: FungibleTokenPacketDatum = {
      denom: denom,
      amount: sendPacketOperator.token.amount.toString(),
      sender: sendPacketOperator.sender,
      receiver: sendPacketOperator.receiver,
      memo: sendPacketOperator.memo,
    };
    console.dir(sendPacketOperator, { depth: 100 });

    // Init packet
    const packet: Packet = {
      sequence: channelDatum.state.next_sequence_send,
      source_port: convertString2Hex(sendPacketOperator.sourcePort),
      source_channel: convertString2Hex(sendPacketOperator.sourceChannel),
      destination_port: channelDatum.state.channel.counterparty.port_id,
      destination_channel: channelDatum.state.channel.counterparty.channel_id,
      data: convertString2Hex(sortedStringify(fTokenPacketData)),
      // data: encodeFungibleTokenPacketDatum(fTokenPacketData, this.lucidService.LucidImporter),
      timeout_height: sendPacketOperator.timeoutHeight,
      timeout_timestamp: sendPacketOperator.timeoutTimestamp,
    };
    // build spend channel redeemer
    const spendChannelRedeemer: SpendChannelRedeemer = {
      SendPacket: {
        packet,
      },
    };
    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );

    const transferModuleRedeemer: TransferModuleRedeemer = {
      Transfer: {
        channel_id: channelId,
        data: {
          denom: convertString2Hex(denom),
          amount: convertString2Hex(sendPacketOperator.token.amount.toString()),
          sender: convertString2Hex(sendPacketOperator.sender),
          receiver: convertString2Hex(sendPacketOperator.receiver),
          memo: convertString2Hex(sendPacketOperator.memo),
        },
      },
    };
    const spendTransferModuleRedeemer: IBCModuleRedeemer = {
      Operator: [transferModuleRedeemer, this.lucidService.LucidImporter], //TODO
    };

    const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
      spendTransferModuleRedeemer,
      'iBCModuleRedeemer',
    );

    // update channel datum
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        next_sequence_send: channelDatum.state.next_sequence_send + 1n,
        packet_commitment: insertSortMapWithNumberKey(
          channelDatum.state.packet_commitment,
          packet.sequence,
          commitPacket(packet),
        ),
      },
    };
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
    const deploymentConfig = this.configService.get('deployment');

    if (
      this._hasVoucherPrefix(
        sendPacketOperator.token.denom,
        sendPacketOperator.sourcePort,
        sendPacketOperator.sourceChannel,
      )
    ) {
      this.logger.log('send burn');
      const mintVoucherRefUtxo = deploymentConfig.validators.mintVoucher.refUtxo;
      const mintVoucherRedeemer: MintVoucherRedeemer = {
        BurnVoucher: {
          packet_source_port: packet.source_port,
          packet_source_channel: packet.source_channel,
        },
      };
      const encodedMintVoucherRedeemer: string = await this.lucidService.encode(
        mintVoucherRedeemer,
        'mintVoucherRedeemer',
      );

      const voucherTokenName = hashSha3_256(sendPacketOperator.token.denom);
      const voucherTokenUnit = deploymentConfig.validators.mintVoucher.scriptHash + voucherTokenName;
      const senderAddress = sendPacketOperator.sender;

      const senderVoucherTokenUtxo = await this.lucidService.findUtxoAtWithUnit(senderAddress, voucherTokenUnit);
      // send burn
      const unsignedSendPacketParams: UnsignedSendPacketBurnDto = {
        channelUTxO: channelUtxo,
        connectionUTxO: connectionUtxo,
        clientUTxO: clientUtxo,
        spendChannelRefUTxO: spendChannelRefUtxo,
        spendTransferModuleUTxO: spendTransferModuleRefUtxo,
        transferModuleUTxO: transferModuleUtxo,
        senderVoucherTokenUtxo,
        mintVoucherRefUtxo,

        encodedMintVoucherRedeemer,
        encodedSpendChannelRedeemer: encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer: encodedSpendTransferModuleRedeemer,
        encodedUpdatedChannelDatum: encodedUpdatedChannelDatum,

        transferAmount: BigInt(sendPacketOperator.token.amount),
        senderAddress,
        receiverAddress: sendPacketOperator.receiver,

        channelTokenUnit,
        voucherTokenUnit,
        denomToken: normalizeDenomTokenTransfer(sendPacketOperator.token.denom),
      };

      return this.lucidService.createUnsignedSendPacketBurnTx(unsignedSendPacketParams);
    }
    // escrow
    this.logger.log('send escrow');
    const unsignedSendPacketParams: UnsignedSendPacketEscrowDto = {
      channelUTxO: channelUtxo,
      connectionUTxO: connectionUtxo,
      clientUTxO: clientUtxo,
      spendChannelRefUTxO: spendChannelRefUtxo,
      spendTransferModuleUTxO: spendTransferModuleRefUtxo,
      transferModuleUTxO: transferModuleUtxo,

      encodedSpendChannelRedeemer: encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer: encodedSpendTransferModuleRedeemer,
      encodedUpdatedChannelDatum: encodedUpdatedChannelDatum,

      transferAmount: BigInt(sendPacketOperator.token.amount),
      senderAddress: sendPacketOperator.sender,
      receiverAddress: sendPacketOperator.receiver,

      spendChannelAddress: deploymentConfig.validators.spendChannel.address,
      channelTokenUnit: channelTokenUnit,
      transferModuleAddress: deploymentConfig.modules.transfer.address,
      denomToken: normalizeDenomTokenTransfer(sendPacketOperator.token.denom),
    };
    return this.lucidService.createUnsignedSendPacketEscrowTx(unsignedSendPacketParams);
  }

  async buildUnsignedAcknowlegementPacketTx(
    ackPacketOperator: AckPacketOperator,
    constructedAddress: string,
  ): Promise<Tx> {
    const channelSequence: string = ackPacketOperator.channelId.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel datum
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    const channelEnd = channelDatum.state.channel;
    if (channelEnd.state !== 'Open') {
      throw new Error('SendPacket to channel not in Open state');
    }

    const fungibleTokenPacketData: FungibleTokenPacketDatum = JSON.parse(
      convertHex2String(ackPacketOperator.packetData),
    );

    // Get the connection token unit with connection id from channel datum
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])),
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
      parseClientSequence(convertHex2String(connectionDatum.state.client_id)),
    );
    // Get client utxo by client unit associated
    const clientUtxo: UTxO = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    // Get client utxo by client unit associated
    const clientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');
    // Get the token unit associated with the client by connection datum
    // Get the keys (heights) of the map and convert them into an array
    const heightsArray = Array.from(clientDatum.state.consensusStates.keys());

    if (!isValidProofHeight(heightsArray, ackPacketOperator.proofHeight.revisionHeight)) {
      throw new GrpcInternalException(`Invalid proof height: ${ackPacketOperator.proofHeight.revisionHeight}`);
    }

    const transferModuleIdentifier = this.getTransferModuleIdentifier();
    // Get mock module utxo

    const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
    const spendChannelRefUtxo: UTxO = this.getSpendChannelRefUtxo();
    const spendTransferModuleRefUtxo: UTxO = this.getSpendTransferModuleRefUtxo();
    // channel id
    const channelId = convertString2Hex(ackPacketOperator.channelId);
    // Init packet
    const packet: Packet = {
      sequence: ackPacketOperator.packetSequence,
      source_port: channelDatum.port,
      source_channel: channelId,
      destination_port: channelDatum.state.channel.counterparty.port_id,
      destination_channel: channelDatum.state.channel.counterparty.channel_id,
      data: ackPacketOperator.packetData,
      timeout_height: ackPacketOperator.timeoutHeight,
      timeout_timestamp: ackPacketOperator.timeoutTimestamp,
    };

    this.logger.log(
      {
        sequence: ackPacketOperator.packetSequence,
        source_port: channelDatum.port,
        source_channel: channelId,
        destination_port: channelDatum.state.channel.counterparty.port_id,
        destination_channel: channelDatum.state.channel.counterparty.channel_id,
        ackHash: hashSHA256(ackPacketOperator.acknowledgement),
        ack: ackPacketOperator.acknowledgement,
      },
      'buildUnsignedAcknowlegementPacketTx',
    );

    // build spend channel redeemer
    const spendChannelRedeemer: SpendChannelRedeemer = {
      AcknowledgePacket: {
        packet: packet,
        proof_acked: ackPacketOperator.proofAcked,
        proof_height: ackPacketOperator.proofHeight,
        acknowledgement: ackPacketOperator.acknowledgement,
      },
    };
    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );

    // build update channel datum
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        packet_commitment: deleteKeySortMap(channelDatum.state.packet_commitment, ackPacketOperator.packetSequence),
      },
    };
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );

    // build transfer module redeemer
    const fTokenPacketData: FungibleTokenPacketDatum = {
      denom: convertString2Hex(fungibleTokenPacketData.denom),
      amount: convertString2Hex(fungibleTokenPacketData.amount),
      sender: convertString2Hex(fungibleTokenPacketData.sender),
      receiver: convertString2Hex(fungibleTokenPacketData.receiver),
      memo: convertString2Hex(fungibleTokenPacketData.memo),
    };

    const acknowledgementResponse: any = JSON.parse(convertHex2String(ackPacketOperator.acknowledgement));
    // Function to create IBCModuleRedeemer object
    const createIBCModuleRedeemer = (
      channelId: string,
      fTokenPacketData: any,
      acknowledgementResponse: AcknowledgementResponse,
    ) => ({
      Callback: [
        {
          OnAcknowledgementPacket: {
            channel_id: channelId,
            data: castToFungibleTokenPacket(fTokenPacketData, this.lucidService.LucidImporter),
            acknowledgement: { response: acknowledgementResponse },
          },
        },
      ],
    });

    // Check the type of acknowledgementResponse using discriminant property pattern
    if ('result' in acknowledgementResponse) {
      this.logger.log('AcknowledgementResult');
      if (acknowledgementResponse.result != 'AQ==') {
        throw new GrpcInternalException('Acknowledgement Response invalid: result must be 01');
      }
      const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
        createIBCModuleRedeemer(channelId, fTokenPacketData, {
          AcknowledgementResult: {
            result: '01',
          },
        }),
        'iBCModuleRedeemer',
      );
      const unsignedAckPacketSucceedParams: UnsignedAckPacketSucceedDto = {
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        spendChannelRefUtxo,
        spendTransferModuleRefUtxo,
        transferModuleUtxo,
        encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer,
        channelTokenUnit,
        encodedUpdatedChannelDatum,
        constructedAddress,
      };
      return this.lucidService.createUnsignedAckPacketSucceedTx(unsignedAckPacketSucceedParams);
    }
    if (!('err' in acknowledgementResponse)) {
      throw new GrpcInternalException('Acknowledgement Response invalid: unknown result');
    }
    const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
      createIBCModuleRedeemer(channelId, fTokenPacketData, {
        AcknowledgementError: {
          err: convertString2Hex(acknowledgementResponse.err as string),
        },
      }),
      'iBCModuleRedeemer',
    );
    this.logger.log('AcknowledgementError');
    if (
      !this._hasVoucherPrefix(
        fungibleTokenPacketData.denom,
        convertHex2String(packet.source_port),
        convertHex2String(packet.source_channel),
      )
    ) {
      this.logger.log('AckPacketUnescrow');
      const unsignedAckPacketUnescrowParams: UnsignedAckPacketUnescrowDto = {
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        spendChannelRefUtxo,
        spendTransferModuleRefUtxo,
        transferModuleUtxo,

        encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer,
        channelTokenUnit,
        encodedUpdatedChannelDatum,
        transferAmount: BigInt(fungibleTokenPacketData.amount),
        senderAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.sender),

        denomToken: normalizeDenomTokenTransfer(fungibleTokenPacketData.denom),
        constructedAddress,
      };
      return this.lucidService.createUnsignedAckPacketUnescrowTx(unsignedAckPacketUnescrowParams);
    }

    // build encode mint voucher redeemer
    const mintVoucherRedeemer: MintVoucherRedeemer = {
      RefundVoucher: {
        packet_source_port: packet.source_port,
        packet_source_channel: packet.source_channel,
      },
    };
    const encodedMintVoucherRedeemer: string = await this.lucidService.encode(
      mintVoucherRedeemer,
      'mintVoucherRedeemer',
    );

    // add prefix voucher prefix with denom token
    const sourcePrefix = getDenomPrefix(
      convertHex2String(packet.source_port),
      convertHex2String(packet.source_channel),
    );

    const prefixedDenom = convertString2Hex(sourcePrefix + fungibleTokenPacketData.denom);
    const voucherTokenName = hashSha3_256(prefixedDenom);
    const voucherTokenUnit = this.configService.get('deployment').validators.mintVoucher.scriptHash + voucherTokenName;
    const unsignedAckPacketMintParams: UnsignedAckPacketMintDto = {
      channelUtxo,
      connectionUtxo,
      clientUtxo,
      spendChannelRefUtxo,
      spendTransferModuleRefUtxo,
      transferModuleUtxo,
      mintVoucherRefUtxo: this.getMintVoucherRefUtxo(),

      encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer,
      encodedMintVoucherRedeemer,
      encodedUpdatedChannelDatum,

      channelTokenUnit,
      voucherTokenUnit,
      transferAmount: BigInt(fungibleTokenPacketData.amount),
      senderAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.sender),

      denomToken: normalizeDenomTokenTransfer(fungibleTokenPacketData.denom),

      constructedAddress,
    };

    // handle recv packet mint
    return this.lucidService.createUnsignedAckPacketMintTx(unsignedAckPacketMintParams);
  }
  private _hasVoucherPrefix(denom: string, portId: string, channelId: string): boolean {
    const voucherPrefix = getDenomPrefix(portId, channelId);
    return denom.startsWith(voucherPrefix);
  }
  private getSpendChannelRefUtxo(): UTxO {
    return this.configService.get('deployment').validators.spendChannel.refUtxo;
  }
  private getSpendTransferModuleUtxo(): UTxO {
    return this.configService.get('deployment').validators.spendTransferModule.refUtxo;
  }
  private getTransferModuleAddress(): string {
    return this.configService.get('deployment').modules.transfer.address;
  }
  private getMintVoucherScriptHash(): string {
    return this.configService.get('deployment').validators.mintVoucher.scriptHash;
  }
  private getSpendChannelAddress(): string {
    return this.configService.get('deployment').validators.spendChannel.address;
  }
  private getTransferModuleIdentifier(): string {
    return this.configService.get('deployment').modules.transfer.identifier;
  }
  private getSpendTransferModuleRefUtxo(): UTxO {
    return this.configService.get('deployment').validators.spendTransferModule.refUtxo;
  }
  private getMintVoucherRefUtxo(): UTxO {
    return this.configService.get('deployment').validators.mintVoucher.refUtxo;
  }
  private async getTransferModuleDetails(): Promise<{
    transferModuleUtxo: UTxO;
    transferModuleAddress: string;
    spendChannelAddress: string;
  }> {
    const transferModuleIdentifier = this.getTransferModuleIdentifier();
    const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
    const transferModuleAddress = this.getTransferModuleAddress();
    const spendChannelAddress = this.getSpendChannelAddress();
    return { transferModuleUtxo, transferModuleAddress, spendChannelAddress };
  }
  private getSpendUtxos(): { spendChannelRefUtxo: UTxO; spendTransferModuleUtxo: UTxO } {
    const spendChannelRefUtxo = this.getSpendChannelRefUtxo();
    const spendTransferModuleUtxo = this.getSpendTransferModuleUtxo();
    return { spendChannelRefUtxo, spendTransferModuleUtxo };
  }
}
