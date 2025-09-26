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
} from '@plus/proto-types/build/ibc/core/channel/v1/tx';

import { fromHex, TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { parseChannelSequence, parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ChannelDatum } from 'src/shared/types/channel/channel-datum';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { Packet } from 'src/shared/types/channel/packet';
import { SpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';
import { ACK_RESULT, CHANNEL_ID_PREFIX, LOVELACE, ORDER_MAPPING_CHANNEL } from 'src/constant';
import { IBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import { deleteKeySortMap, deleteSortMap, getDenomPrefix, prependToMap, sortedStringify } from '@shared/helpers/helper';
import { RpcException } from '@nestjs/microservices';
import { FungibleTokenPacketDatum } from '@shared/types/apps/transfer/types/fungible-token-packet-data';
import { TransferModuleRedeemer } from '../shared/types/apps/transfer/transfer_module_redeemer/transfer-module-redeemer';
import { normalizeDenomTokenTransfer } from './helper/helper';
import { convertHex2String, convertString2Hex, hashSHA256, hashSha3_256 } from '../shared/helpers/hex';
import { MintVoucherRedeemer } from '@shared/types/apps/transfer/mint_voucher_redeemer/mint-voucher-redeemer';
import { commitPacket } from '../shared/helpers/commitment';
import { ClientDatum } from '@shared/types/client-datum';
import { isValidProofHeight } from './helper/height.validate';
import { AcknowledgementResponse } from '@shared/types/channel/acknowledgement_response';
import {
  validateAndFormatAcknowledgementPacketParams,
  validateAndFormatRecvPacketParams,
  validateAndFormatSendPacketParams,
  validateAndFormatTimeoutPacketParams,
} from './helper/packet.validate';
import { encodeVerifyProofRedeemer, VerifyProofRedeemer } from '../shared/types/connection/verify-proof-redeemer';
import { getBlockDelay } from '../shared/helpers/verify';
import { packetAcknowledgementPath, packetCommitmentPath, packetReceiptPath } from '../shared/helpers/packet-keys';
import { Order as ChannelOrder } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
import { GrpcInternalException, GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import {
  AckPacketOperator,
  RecvPacketOperator,
  SendPacketOperator,
  TimeoutPacketOperator,
  TimeoutRefreshOperator,
} from './dto';
import {
  UnsignedAckPacketMintDto,
  UnsignedAckPacketSucceedDto,
  UnsignedAckPacketUnescrowDto,
  UnsignedRecvPacketDto,
  UnsignedRecvPacketMintDto,
  UnsignedRecvPacketUnescrowDto,
  UnsignedSendPacketBurnDto,
  UnsignedSendPacketEscrowDto,
  UnsignedTimeoutPacketMintDto,
  UnsignedTimeoutPacketUnescrowDto,
  UnsignedTimeoutRefreshDto,
} from '~@/shared/modules/lucid/dtos';

@Injectable()
export class PacketService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
  ) {}
  /**
   * @param data
   * @returns unsigned_tx
   * 1. check validate port transfer
   * 2. check denom with voucher prefix
   * - yes => recv_unescrow
   * - no => recv_mint
   */

  private prettyPrint(obj: any, indent = 2): string {
    const seen = new WeakSet();

    function replacer(key: string, value: any): any {
      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }

      // Handle Map objects
      if (value instanceof Map) {
        const mapEntries: Record<string, any> = {};
        value.forEach((v, k) => {
          mapEntries[String(k)] = v;
        });
        return { __type: 'Map', entries: mapEntries };
      }

      // Handle BigInt values
      if (typeof value === 'bigint') {
        return { __type: 'BigInt', value: value.toString() };
      }

      // Handle other special types as needed
      // ...

      return value;
    }

    return JSON.stringify(obj, replacer, indent);
  }

  async recvPacket(data: MsgRecvPacket): Promise<MsgRecvPacketResponse> {
    try {
      this.logger.log('RecvPacket data: ', data);
      const { constructedAddress, recvPacketOperator } = validateAndFormatRecvPacketParams(data);
      // Build and complete the unsigned transaction
      const unsignedRecvPacketTx: TxBuilder = await this.buildUnsignedRecvPacketTx(
        recvPacketOperator,
        constructedAddress,
      );

      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('recv packet failed: tx time invalid');
      }

      if (
        recvPacketOperator.timeoutTimestamp > 0 &&
        BigInt(validToTime) * 10n ** 6n > recvPacketOperator.timeoutTimestamp
      ) {
        throw new GrpcInternalException('recv packet failed: tx_valid_to * 1_000_000 < packet.timeout_timestamp');
      }
      const unsignedRecvPacketTxValidTo: TxBuilder = unsignedRecvPacketTx.validTo(validToTime);
      // Todo: signing should be done in the relayer in the future
      const signedRecvPacketCompleted = await (await unsignedRecvPacketTxValidTo.complete()).sign
        .withWallet()
        .complete();

      this.logger.log(signedRecvPacketCompleted.toHash(), 'recv packet - unsignedTX - hash');
      const response: MsgRecvPacketResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: fromHex(signedRecvPacketCompleted.toCBOR()),
        },
      } as unknown as MsgRecvPacketResponse;
      return response;
    } catch (error) {
      this.logger.error(`recvPacket: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  async sendPacket(data: MsgTransfer): Promise<MsgTransferResponse> {
    // used in the funding osmosis step
    try {
      this.logger.log('Transfer is processing');
      const sendPacketOperator = validateAndFormatSendPacketParams(data);

      const unsignedSendPacketTx: TxBuilder = await this.buildUnsignedSendPacketTx(sendPacketOperator);
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('channel init failed: tx time invalid');
      }

      const unsignedSendPacketTxValidTo: TxBuilder = unsignedSendPacketTx.validTo(validToTime);

      // Todo: signing should be done in the relayer in the future
      const signedSendPacketTxCompleted = await (await unsignedSendPacketTxValidTo.complete()).sign
        .withWallet()
        .complete();

      this.logger.log(signedSendPacketTxCompleted.toHash(), 'send packet - unsignedTX - hash');
      const response: MsgRecvPacketResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: fromHex(signedSendPacketTxCompleted.toCBOR()),
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
      const unsignedSendPacketTx: TxBuilder = await this.buildUnsignedTimeoutPacketTx(
        timeoutPacketOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedSendPacketTxValidTo: TxBuilder = unsignedSendPacketTx.validTo(validToTime);

      // Todo: signing should be done in the relayer in the future
      const signedSendPacketTxCompleted = await (await unsignedSendPacketTxValidTo.complete()).sign
        .withWallet()
        .complete();

      this.logger.log(signedSendPacketTxCompleted.toHash(), 'timeout packet - unsignedTX - hash');
      const response: MsgTimeoutResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: fromHex(signedSendPacketTxCompleted.toCBOR()),
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
      if (!data.channel_id.startsWith(`${CHANNEL_ID_PREFIX}-`)) {
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
        );
      }
      // Prepare the timeout refresh operator object
      const timeoutRefreshOperator: TimeoutRefreshOperator = {
        channelId: data.channel_id,
      };

      // Build and complete the unsigned transaction
      const unsignedTimeoutRefreshTx: TxBuilder = await this.buildUnsignedTimeoutRefreshTx(
        timeoutRefreshOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));

      const currentSlot = this.lucidService.lucid.currentSlot();

      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('recv packet failed: tx time invalid');
      }
      const unsignedTimeoutRefreshTxValidTo: TxBuilder = unsignedTimeoutRefreshTx.validTo(validToTime);

      // Todo: signing should be done in the relayer in the future
      const signedTimeoutRefreshCompleted = await (await unsignedTimeoutRefreshTxValidTo.complete()).sign
        .withWallet()
        .complete();

      this.logger.log(signedTimeoutRefreshCompleted.toHash(), 'TimeoutRefresh - unsignedTX - hash');
      const response: MsgTimeoutRefreshResponse = {
        unsigned_tx: {
          type_url: '',
          value: fromHex(signedTimeoutRefreshCompleted.toCBOR()),
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
      // entypoint fromc controller.
      this.logger.log('AcknowledgementPacket is processing data.packet.sequence: ', data.packet.sequence);
      this.logger.log('AcknowledgementPacket is processing (MsgAcknowledgement): ', data);

      const { constructedAddress, ackPacketOperator } = validateAndFormatAcknowledgementPacketParams(data);
      this.logger.log('AcknowledgementPacket ackPacketOperator.packetSequence: ', ackPacketOperator.packetSequence);
      this.logger.log('AcknowledgementPacket ackPacketOperator: ', ackPacketOperator);

      // Build and complete the unsigned transaction
      const unsignedAckPacketTx: TxBuilder = await this.buildUnsignedAcknowlegementPacketTx(
        ackPacketOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedAckPacketTxValidTo: TxBuilder = unsignedAckPacketTx.validTo(validToTime);

      // Todo: signing should be done in the relayer in the future
      const signedAckPacketCompleted = await (await unsignedAckPacketTxValidTo.complete()).sign.withWallet().complete();

      this.logger.log(signedAckPacketCompleted.toHash(), 'ack packet - unsignedTX - hash');
      const response: MsgAcknowledgementResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: fromHex(signedAckPacketCompleted.toCBOR()),
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
  ): Promise<TxBuilder> {
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
    const unsignedTimeoutRefreshParams: UnsignedTimeoutRefreshDto = {
      channelUtxo,
      encodedSpendChannelRedeemer,
      encodedChannelDatum,
      channelTokenUnit,
      constructedAddress,
    };
    return this.lucidService.createUnsignedTimeoutRefreshTx(unsignedTimeoutRefreshParams);
  }

  async buildUnsignedRecvPacketTx(
    recvPacketOperator: RecvPacketOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
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

    // Check Next Sequence
    if (ORDER_MAPPING_CHANNEL[channelDatum.state.channel.ordering] === ChannelOrder.ORDER_ORDERED) {
      if (recvPacketOperator.packetSequence !== channelDatum.state.next_sequence_recv) {
        throw new Error('Invalid recv packet sequence');
      }
    }

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
    // check packet receipt has sequence packet
    if (channelDatum.state.packet_receipt.has(recvPacketOperator.packetSequence)) {
      throw new GrpcInternalException(
        `PacketReceivedException: Packet with sequence ${recvPacketOperator.packetSequence} has recieved`,
      );
    }
    const transferModuleIdentifier = this.getTransferModuleIdentifier();
    // Get mock module utxo
    const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
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

    const deploymentConfig = this.configService.get('deployment');
    const recvPacketPolicyId = deploymentConfig.validators.spendChannel.refValidator.recv_packet.scriptHash;
    const channelToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };
    const verifyProofPolicyId = this.configService.get('deployment').validators.verifyProof.scriptHash;
    const [, consensusState] = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) => key.revisionHeight === recvPacketOperator.proofHeight.revisionHeight,
    );
    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: recvPacketOperator.proofHeight,
        delay_time_period: connectionDatum.state.delay_period,
        delay_block_period: BigInt(getBlockDelay(connectionDatum.state.delay_period)),
        proof: recvPacketOperator.proofCommitment,
        path: {
          key_path: [
            connectionDatum.state.counterparty.prefix.key_prefix,
            convertString2Hex(
              packetCommitmentPath(
                convertHex2String(packet.source_port),
                convertHex2String(packet.source_channel),
                packet.sequence,
              ),
            ),
          ],
        },
        value: commitPacket(packet),
      },
    };

    const encodedVerifyProofRedeemer: string = encodeVerifyProofRedeemer(
      verifyProofRedeemer,
      this.lucidService.LucidImporter,
    );

    const stringData = convertHex2String(recvPacketOperator.packetData) || '';
    let jsonData;

    if (stringData.startsWith('{') && stringData.endsWith('}')) {
      try {
        jsonData = JSON.parse(stringData);

        if (jsonData.denom !== undefined) {
          // Packet data seems to be ICS-20 related. Build transfer module redeemer.
          const fungibleTokenPacketData: FungibleTokenPacketDatum = jsonData;
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
                  data: {
                    TransferModuleData: [fTokenPacketData],
                  },
                  acknowledgement: {
                    response: {
                      AcknowledgementResult: {
                        result: convertString2Hex(ACK_RESULT),
                      },
                    },
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
            // Handle recv packet unescrow
            const updatedChannelDatum: ChannelDatum = {
              ...channelDatum,
              state: {
                ...channelDatum.state,
                packet_receipt: prependToMap(channelDatum.state.packet_receipt, packet.sequence, ''),
                packet_acknowledgement: prependToMap(
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

            const unsignedRecvPacketUnescrowParams: UnsignedRecvPacketUnescrowDto = {
              channelUtxo,
              connectionUtxo,
              clientUtxo,
              transferModuleUtxo,

              encodedSpendChannelRedeemer,
              encodedSpendTransferModuleRedeemer,
              channelTokenUnit,
              encodedUpdatedChannelDatum,
              transferAmount: BigInt(fungibleTokenPacketData.amount),
              receiverAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.receiver),
              constructedAddress,

              recvPacketPolicyId,
              channelToken,

              verifyProofPolicyId,
              encodedVerifyProofRedeemer,
            };
            return this.lucidService.createUnsignedRecvPacketUnescrowTx(unsignedRecvPacketUnescrowParams);
          } else {
            // Handle recv packet escrow and voucher mint
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

            // Add prefix voucher prefix with denom token
            const sourcePrefix = getDenomPrefix(
              convertHex2String(packet.destination_port),
              convertHex2String(packet.destination_channel),
            );

            const prefixedDenom = convertString2Hex(sourcePrefix + fungibleTokenPacketData.denom);
            const voucherTokenName = hashSha3_256(prefixedDenom);
            const voucherTokenUnit =
              this.configService.get('deployment').validators.mintVoucher.scriptHash + voucherTokenName;
            const updatedChannelDatum: ChannelDatum = {
              ...channelDatum,
              state: {
                ...channelDatum.state,
                packet_receipt: prependToMap(channelDatum.state.packet_receipt, packet.sequence, ''),
                packet_acknowledgement: prependToMap(
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

            const unsignedRecvPacketMintParams: UnsignedRecvPacketMintDto = {
              channelUtxo,
              connectionUtxo,
              clientUtxo,
              transferModuleUtxo,

              encodedSpendChannelRedeemer,
              encodedSpendTransferModuleRedeemer,
              encodedMintVoucherRedeemer,
              encodedUpdatedChannelDatum,

              channelTokenUnit,
              voucherTokenUnit,
              transferAmount: BigInt(fungibleTokenPacketData.amount),
              receiverAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.receiver),
              constructedAddress,

              recvPacketPolicyId,
              channelToken,

              verifyProofPolicyId,
              encodedVerifyProofRedeemer,
            };

            return this.lucidService.createUnsignedRecvPacketMintTx(unsignedRecvPacketMintParams);
          }
        }
      } catch (error) {
        this.logger.error('Error in parsing JSON packet data: ' + stringData, error);
      }
    }
    // Packet data is not related to an ICS-20 token transfer
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        packet_receipt: prependToMap(channelDatum.state.packet_receipt, packet.sequence, ''),
        packet_acknowledgement: prependToMap(
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

    const unsignedRecvPacketMintParams: UnsignedRecvPacketDto = {
      channelUtxo,
      connectionUtxo,
      clientUtxo,

      encodedSpendChannelRedeemer,
      encodedUpdatedChannelDatum,

      channelTokenUnit,
      constructedAddress,

      recvPacketPolicyId,
      channelToken,

      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
    };

    // handle recv packet mint
    return this.lucidService.createUnsignedRecvPacketTx(unsignedRecvPacketMintParams);
  }
  async buildUnsignedTimeoutPacketTx(
    timeoutPacketOperator: TimeoutPacketOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
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

    const { transferModuleUtxo, transferModuleAddress, spendChannelAddress } = await this.getTransferModuleDetails();
    const transferAmount = BigInt(timeoutPacketOperator.fungibleTokenPacketData.amount);
    const senderPublicKeyHash = timeoutPacketOperator.fungibleTokenPacketData.sender;
    const denom =
      timeoutPacketOperator.fungibleTokenPacketData.denom === convertString2Hex(LOVELACE)
        ? convertHex2String(timeoutPacketOperator.fungibleTokenPacketData.denom)
        : timeoutPacketOperator.fungibleTokenPacketData.denom;
    const spendTransferModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnTimeoutPacket: {
            channel_id: packet.source_channel,
            data: {
              TransferModuleData: [
                {
                  denom: convertString2Hex(timeoutPacketOperator.fungibleTokenPacketData.denom),
                  amount: convertString2Hex(timeoutPacketOperator.fungibleTokenPacketData.amount.toString()),
                  sender: convertString2Hex(senderPublicKeyHash),
                  receiver: convertString2Hex(timeoutPacketOperator.fungibleTokenPacketData.receiver),
                  memo: convertString2Hex(timeoutPacketOperator.fungibleTokenPacketData.memo),
                },
              ],
            },
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

    const deploymentConfig = this.configService.get('deployment');
    const timeoutPacketPolicyId = deploymentConfig.validators.spendChannel.refValidator.timeout_packet.scriptHash;
    const verifyProofPolicyId = deploymentConfig.validators.verifyProof.scriptHash;
    const channelToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };

    const [, consensusState] = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) => key.revisionHeight === timeoutPacketOperator.proofHeight.revisionHeight,
    );
    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyNonMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: timeoutPacketOperator.proofHeight,
        delay_time_period: connectionDatum.state.delay_period,
        delay_block_period: BigInt(getBlockDelay(connectionDatum.state.delay_period)),
        proof: timeoutPacketOperator.proofUnreceived,
        path: {
          key_path: [
            connectionDatum.state.counterparty.prefix.key_prefix,
            convertString2Hex(
              packetReceiptPath(
                convertHex2String(packet.destination_port),
                convertHex2String(packet.destination_channel),
                packet.sequence,
              ),
            ),
          ],
        },
      },
    };

    const encodedVerifyProofRedeemer: string = encodeVerifyProofRedeemer(
      verifyProofRedeemer,
      this.lucidService.LucidImporter,
    );

    if (!voucherHasPrefix) {
      this.logger.log(denom, 'unescrow timeout processing');

      const unsignedSendPacketParams: UnsignedTimeoutPacketUnescrowDto = {
        channelUtxo: channelUtxo,
        transferModuleUtxo: transferModuleUtxo,
        connectionUtxo: connectionUtxo,
        clientUtxo: clientUtxo,

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

        timeoutPacketPolicyId,
        channelToken,

        verifyProofPolicyId,
        encodedVerifyProofRedeemer,
      };
      return this.lucidService.createUnsignedTimeoutPacketUnescrowTx(unsignedSendPacketParams);
    }
    this.logger.log(timeoutPacketOperator.fungibleTokenPacketData.denom, 'mint timeout processing');
    // const prefixedDenom = convertString2Hex(sourcePrefix + denom);
    const prefixedDenom = convertString2Hex(denom);
    const mintVoucherRedeemer: MintVoucherRedeemer = {
      RefundVoucher: {
        packet_source_port: packet.source_port,
        packet_source_channel: packet.source_channel,
      },
    };
    const voucherTokenName = hashSha3_256(prefixedDenom);
    const voucherTokenUnit = this.getMintVoucherScriptHash() + voucherTokenName;

    const encodedMintVoucherRedeemer: string = await this.lucidService.encode(
      mintVoucherRedeemer,
      'mintVoucherRedeemer',
    );
    const unsignedTimeoutPacketMintDto: UnsignedTimeoutPacketMintDto = {
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

      timeoutPacketPolicyId,
      channelToken,

      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
    };
    return this.lucidService.createUnsignedTimeoutPacketMintTx(unsignedTimeoutPacketMintDto);
  }

  async buildUnsignedSendPacketTx(sendPacketOperator: SendPacketOperator): Promise<TxBuilder> {
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
    // channel id
    const channelId = convertString2Hex(sendPacketOperator.sourceChannel);

    // build transfer module redeemer
    const denom =
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
      Operator: [
        {
          TransferModuleOperator: [transferModuleRedeemer],
        },
      ],
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
        packet_commitment: prependToMap(channelDatum.state.packet_commitment, packet.sequence, commitPacket(packet)),
      },
    };
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
    const deploymentConfig = this.configService.get('deployment');

    const sendPacketPolicyId = deploymentConfig.validators.spendChannel.refValidator.send_packet.scriptHash;
    const channelToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };

    if (
      this._hasVoucherPrefix(
        sendPacketOperator.token.denom,
        sendPacketOperator.sourcePort,
        sendPacketOperator.sourceChannel,
      )
    ) {
      this.logger.log('send burn');
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
        transferModuleUTxO: transferModuleUtxo,
        senderVoucherTokenUtxo,

        encodedMintVoucherRedeemer,
        encodedSpendChannelRedeemer: encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer: encodedSpendTransferModuleRedeemer,
        encodedUpdatedChannelDatum: encodedUpdatedChannelDatum,

        transferAmount: BigInt(sendPacketOperator.token.amount),
        senderAddress,
        receiverAddress: sendPacketOperator.receiver,

        constructedAddress: sendPacketOperator.signer,

        channelTokenUnit,
        voucherTokenUnit,
        denomToken: normalizeDenomTokenTransfer(sendPacketOperator.token.denom),

        sendPacketPolicyId,
        channelToken,
      };

      return this.lucidService.createUnsignedSendPacketBurnTx(unsignedSendPacketParams);
    }
    // escrow
    this.logger.log('send escrow');
    const unsignedSendPacketParams: UnsignedSendPacketEscrowDto = {
      channelUTxO: channelUtxo,
      connectionUTxO: connectionUtxo,
      clientUTxO: clientUtxo,
      transferModuleUTxO: transferModuleUtxo,

      encodedSpendChannelRedeemer: encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer: encodedSpendTransferModuleRedeemer,
      encodedUpdatedChannelDatum: encodedUpdatedChannelDatum,

      transferAmount: BigInt(sendPacketOperator.token.amount),
      senderAddress: sendPacketOperator.sender,
      receiverAddress: sendPacketOperator.receiver,

      constructedAddress: sendPacketOperator.signer,

      spendChannelAddress: deploymentConfig.validators.spendChannel.address,
      channelTokenUnit: channelTokenUnit,
      transferModuleAddress: deploymentConfig.modules.transfer.address,
      denomToken: normalizeDenomTokenTransfer(sendPacketOperator.token.denom),

      sendPacketPolicyId,
      channelToken,
    };

    return this.lucidService.createUnsignedSendPacketEscrowTx(unsignedSendPacketParams);
  }

  async buildUnsignedAcknowlegementPacketTx(
    ackPacketOperator: AckPacketOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
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
    if (!channelDatum.state.packet_commitment.has(ackPacketOperator.packetSequence)) {
      throw new GrpcInternalException(
        `PacketAcknowledgedException: Packet with sequence ${ackPacketOperator.packetSequence} not exists in the packet commitment map`,
      );
    }

    const transferModuleIdentifier = this.getTransferModuleIdentifier();
    // Get mock module utxo

    const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
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

    // // build update channel datum
    // const updatedChannelDatum: ChannelDatum = {
    //   ...channelDatum,
    //   state: {
    //     ...channelDatum.state,
    //     packet_commitment: deleteKeySortMap(channelDatum.state.packet_commitment, ackPacketOperator.packetSequence),
    //   },
    // };
    // const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
    //   updatedChannelDatum,
    //   'channel',
    // );

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
            data: {
              TransferModuleData: [fTokenPacketData],
            },
            acknowledgement: { response: acknowledgementResponse },
          },
        },
      ],
    });

    const deploymentConfig = this.configService.get('deployment');
    const ackPacketPolicyId = deploymentConfig.validators.spendChannel.refValidator.acknowledge_packet.scriptHash;
    const channelToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };

    const verifyProofPolicyId = this.configService.get('deployment').validators.verifyProof.scriptHash;
    const [, consensusState] = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) => key.revisionHeight === ackPacketOperator.proofHeight.revisionHeight,
    );
    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: ackPacketOperator.proofHeight,
        delay_time_period: connectionDatum.state.delay_period,
        delay_block_period: BigInt(getBlockDelay(connectionDatum.state.delay_period)),
        proof: ackPacketOperator.proofAcked,
        path: {
          key_path: [
            connectionDatum.state.counterparty.prefix.key_prefix,
            convertString2Hex(
              packetAcknowledgementPath(
                convertHex2String(packet.destination_port),
                convertHex2String(packet.destination_channel),
                packet.sequence,
              ),
            ),
          ],
        },
        value: hashSHA256(ackPacketOperator.acknowledgement),
      },
    };
    const encodedVerifyProofRedeemer: string = encodeVerifyProofRedeemer(
      verifyProofRedeemer,
      this.lucidService.LucidImporter,
    );
    // Check the type of acknowledgementResponse using discriminant property pattern
    if ('result' in acknowledgementResponse) {
      // build update channel datum
      const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
        createIBCModuleRedeemer(channelId, fTokenPacketData, {
          AcknowledgementResult: {
            result: convertString2Hex(acknowledgementResponse.result as string),
          },
        }),
        'iBCModuleRedeemer',
      );
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
      const unsignedAckPacketSucceedParams: UnsignedAckPacketSucceedDto = {
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        transferModuleUtxo,
        encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer,
        channelTokenUnit,
        encodedUpdatedChannelDatum,
        constructedAddress,
        ackPacketPolicyId,
        channelToken,

        verifyProofPolicyId,
        encodedVerifyProofRedeemer,
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
      const unsignedAckPacketUnescrowParams: UnsignedAckPacketUnescrowDto = {
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        transferModuleUtxo,

        encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer,
        channelTokenUnit,
        encodedUpdatedChannelDatum,
        transferAmount: BigInt(fungibleTokenPacketData.amount),
        senderAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.sender),

        denomToken: normalizeDenomTokenTransfer(fungibleTokenPacketData.denom),
        constructedAddress,

        ackPacketPolicyId,
        channelToken,

        verifyProofPolicyId,
        encodedVerifyProofRedeemer,
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
    const unsignedAckPacketMintParams: UnsignedAckPacketMintDto = {
      channelUtxo,
      connectionUtxo,
      clientUtxo,
      transferModuleUtxo,

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

      ackPacketPolicyId,
      channelToken,

      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
    };

    // handle recv packet mint
    return this.lucidService.createUnsignedAckPacketMintTx(unsignedAckPacketMintParams);
  }
  private _hasVoucherPrefix(denom: string, portId: string, channelId: string): boolean {
    const voucherPrefix = getDenomPrefix(portId, channelId);
    return denom.startsWith(voucherPrefix);
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
  private getMockModuleAddress(): string {
    return this.configService.get('deployment').modules.mock.address;
  }
  private getMockModuleIdentifier(): string {
    return this.configService.get('deployment').modules.mock.identifier;
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
}
