import { type Tx, TxComplete, UTxO } from '@dinhbx/lucid-custom';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException } from 'nestjs-grpc-exceptions';
import { RpcException } from '@nestjs/microservices';
import {
  MsgChannelCloseInit,
  MsgChannelCloseInitResponse,
  MsgChannelOpenAck,
  MsgChannelOpenAckResponse,
  MsgChannelOpenConfirm,
  MsgChannelOpenConfirmResponse,
  MsgChannelOpenInit,
  MsgChannelOpenInitResponse,
  MsgChannelOpenTry,
  MsgChannelOpenTryResponse,
} from '@plus/proto-types/build/ibc/core/channel/v1/tx';
import { ChannelOpenInitOperator } from './dto/channel/channel-open-init-operator.dto';
import { ChannelOpenConfirmOperator } from './dto/channel/channel-open-confirm-operator.dto';
import { ChannelOpenAckOperator } from './dto/channel/channel-open-ack-operator.dto';
import { ChannelOpenTryOperator } from './dto/channel/channel-open-try-operator.dto';
import { ChannelCloseInitOperator } from './dto/channel/channel-close-init-operator.dto';
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { HandlerOperator } from 'src/shared/types/handler-operator';
import { MintChannelRedeemer, SpendChannelRedeemer } from 'src/shared/types/channel/channel-redeemer';
import { ConfigService } from '@nestjs/config';
import { AuthToken } from 'src/shared/types/auth-token';
import { ChannelDatum } from 'src/shared/types/channel/channel-datum';
import { ChannelState } from 'src/shared/types/channel/state';
import { CHANNEL_ID_PREFIX } from 'src/constant';
import { IBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import { MockModuleDatum } from '@shared/types/apps/mock/mock-module-datum';
import { insertSortMap } from '../shared/helpers/helper';
import { convertHex2String, convertString2Hex, toHex } from '@shared/helpers/hex';
import { ClientDatum } from '@shared/types/client-datum';
import {
  UnsignedChannelOpenInitDto,
  UnsignedOrderedChannelOpenInitDto,
} from '@shared/modules/lucid/dtos/channel/channel-open-init.dto';
import {
  UnsignedChannelOpenAckDto,
  UnsignedOrderedChannelOpenAckDto,
} from '@shared/modules/lucid/dtos/channel/channel-open-ack.dto';
import { UnsignedChannelCloseInitDto} from '@shared/modules/lucid/dtos/channel/channle-close-init.dto';
import { isValidProofHeight } from './helper/height.validate';
import {
  validateAndFormatChannelOpenAckParams,
  validateAndFormatChannelOpenConfirmParams,
  validateAndFormatChannelOpenInitParams,
  validateAndFormatChannelOpenTryParams,
  validateAndFormatChannelCloseInitParams
} from './helper/channel.validate';
import { VerifyProofRedeemer, encodeVerifyProofRedeemer } from '~@/shared/types/connection/verify-proof-redeemer';
import { getBlockDelay } from '~@/shared/helpers/verify';
import { channelPath } from '~@/shared/helpers/channel';
import {
  Channel as CardanoChannel,
  State as CardanoChannelState,
  orderFromJSON,
} from '@plus/proto-types/build/ibc/core/channel/v1/channel';
import { ORDER_MAPPING_CHANNEL } from '~@/constant/channel';
import { Order } from '~@/shared/types/channel/order';

@Injectable()
export class ChannelService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
  ) {}

  async channelOpenInit(data: MsgChannelOpenInit): Promise<MsgChannelOpenInitResponse> {
    try {
      this.logger.log('Channel Open Init is processing');
      const { channelOpenInitOperator, constructedAddress } = validateAndFormatChannelOpenInitParams(data);

      // Build and complete the unsigned transaction
      const { unsignedTx: unsignedChannelOpenInitTx, channelId } = await this.buildUnsignedChannelOpenInitTx(
        channelOpenInitOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + 3 * 1e5;
      const validToSlot = this.lucidService.lucid.utils.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('channel init failed: tx time invalid');
      }
      const unsignedChannelOpenInitTxValidTo: Tx = unsignedChannelOpenInitTx.validTo(validToTime);

      const unsignedChannelOpenInitTxCompleted: TxComplete = await unsignedChannelOpenInitTxValidTo.complete();

      this.logger.log(unsignedChannelOpenInitTxCompleted.toHash(), 'channel open init - unsignedTX - hash');
      const response: MsgChannelOpenInitResponse = {
        channel_id: channelId,
        version: data.channel.version,
        unsigned_tx: {
          type_url: '',
          value: unsignedChannelOpenInitTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgChannelOpenInitResponse;
      return response;
    } catch (error) {
      this.logger.error(`channelOpenInit: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  /* istanbul ignore next */
  async channelOpenTry(data: MsgChannelOpenTry): Promise<MsgChannelOpenTryResponse> {
    try {
      this.logger.log('Channel Open Try is processing');
      const { constructedAddress, channelOpenTryOperator } = validateAndFormatChannelOpenTryParams(data);
      // Build and complete the unsigned transaction
      const unsignedChannelOpenTryTx: Tx = await this.buildUnsignedChannelOpenTryTx(
        channelOpenTryOperator,
        constructedAddress,
      );
      const unsignedChannelOpenTryTxValidTo: Tx = unsignedChannelOpenTryTx.validTo(Date.now() + 600 * 1e3);

      const unsignedChannelOpenTryTxCompleted: TxComplete = await unsignedChannelOpenTryTxValidTo.complete();

      this.logger.log(unsignedChannelOpenTryTxCompleted.toHash(), 'channel open try - unsignedTX - hash');
      const response: MsgChannelOpenTryResponse = {
        version: channelOpenTryOperator.version,
        unsigned_tx: {
          type_url: '',
          value: unsignedChannelOpenTryTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgChannelOpenTryResponse;
      return response;
    } catch (error) {
      this.logger.error(`channelOpenTry: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  async channelOpenAck(data: MsgChannelOpenAck): Promise<MsgChannelOpenAckResponse> {
    try {
      this.logger.log('Channel Open Ack is processing');
      const { constructedAddress, channelOpenAckOperator } = validateAndFormatChannelOpenAckParams(data);
      // Build and complete the unsigned transaction
      const unsignedChannelOpenAckTx: Tx = await this.buildUnsignedChannelOpenAckTx(
        channelOpenAckOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + 3 * 1e5;
      const validToSlot = this.lucidService.lucid.utils.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('channel init failed: tx time invalid');
      }
      const unsignedChannelOpenAckTxValidTo: Tx = unsignedChannelOpenAckTx.validTo(validToTime);
      const unsignedChannelOpenAckTxCompleted: TxComplete = await unsignedChannelOpenAckTxValidTo.complete();

      this.logger.log(unsignedChannelOpenAckTxCompleted.toHash(), 'channel open ack - unsignedTX - hash');
      const response: MsgChannelOpenAckResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedChannelOpenAckTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgChannelOpenAckResponse;
      return response;
    } catch (error) {
      this.logger.error(`channelOpenAck: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  /* istanbul ignore next */
  async channelOpenConfirm(data: MsgChannelOpenConfirm): Promise<MsgChannelOpenConfirmResponse> {
    try {
      this.logger.log('Channel Open Confirm is processing');
      const { constructedAddress, channelOpenConfirmOperator } = validateAndFormatChannelOpenConfirmParams(data);
      // Build and complete the unsigned transaction
      const unsignedChannelConfirmInitTx: Tx = await this.buildUnsignedChannelOpenConfirmTx(
        channelOpenConfirmOperator,
        constructedAddress,
      );
      const unsignedChannelConfirmInitTxValidTo: Tx = unsignedChannelConfirmInitTx.validTo(Date.now() + 600 * 1e3);

      const unsignedChannelConfirmInitTxCompleted: TxComplete = await unsignedChannelConfirmInitTxValidTo.complete();

      this.logger.log(unsignedChannelConfirmInitTxCompleted.toHash(), 'channelOpenConfirm - unsignedTX - hash');
      const response: MsgChannelOpenConfirmResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedChannelConfirmInitTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgChannelOpenConfirmResponse;
      return response;
    } catch (error) {
      this.logger.error(`channelOpenConfirm: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }

  async channelCloseInit(data: MsgChannelCloseInit): Promise<MsgChannelCloseInitResponse> {
    console.log("dataMsgChannelCloseInit");
    console.dir({
      ...data
    }, {depth: 10});
    try {
      this.logger.log('Channel Close Init is processing');
      const { constructedAddress, channelCloseInitOperator } = validateAndFormatChannelCloseInitParams(data);
      // Build and complete the unsigned transaction
      const unsignedChannelCloseInitTx: Tx = await this.buildUnsignedChannelCloseInitTx(
        channelCloseInitOperator,
        constructedAddress,
      );
      const unsignedChannelCloseInitTxValidTo: Tx = unsignedChannelCloseInitTx.validTo(Date.now() + 600 * 1e3);

      const unsignedChannelCloseInitTxCompleted: TxComplete = await unsignedChannelCloseInitTxValidTo.complete();

      this.logger.log(unsignedChannelCloseInitTxCompleted.toHash(), 'channel close init - unsignedTX - hash');
      const response: MsgChannelCloseInitResponse = {
        unsigned_tx: {
          type_url: '',
          value: unsignedChannelCloseInitTxCompleted.txComplete.to_bytes(),
        },
      } as unknown as MsgChannelCloseInitResponse;
      return response;
    } catch (error) {
      this.logger.error(`channelCloseInit: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }
  async buildUnsignedChannelOpenInitTx(
    channelOpenInitOperator: ChannelOpenInitOperator,
    constructedAddress: string,
  ): Promise<{ unsignedTx: Tx; channelId: string }> {
    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');

    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(channelOpenInitOperator.connectionId),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    const connectionClientSequence = parseClientSequence(convertHex2String(connectionDatum.state.client_id));
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(connectionClientSequence);
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const spendHandlerRedeemer: HandlerOperator = 'HandlerChanOpenInit';
    const encodedSpendHandlerRedeemer: string = await this.lucidService.encode<HandlerOperator>(
      spendHandlerRedeemer,
      'handlerOperator',
    );
    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_channel_sequence: handlerDatum.state.next_channel_sequence + 1n,
      },
    };
    const mintChannelRedeemer: MintChannelRedeemer = {
      ChanOpenInit: {
        handler_token: this.configService.get('deployment').handlerAuthToken,
      },
    };
    const channelSequence = handlerDatum.state.next_channel_sequence;
    const channelId = convertString2Hex(CHANNEL_ID_PREFIX + '-' + channelSequence);

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(channelSequence);
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelToken: AuthToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };
    const channelDatum: ChannelDatum = {
      state: {
        channel: {
          state: ChannelState.Init,
          counterparty: {
            port_id: convertString2Hex(channelOpenInitOperator.counterpartyPortId),
            channel_id: convertString2Hex(''),
          },
          ordering: channelOpenInitOperator.ordering,
          connection_hops: [convertString2Hex(channelOpenInitOperator.connectionId)],
          version: convertString2Hex(channelOpenInitOperator.version),
        },
        next_sequence_send: 1n,
        next_sequence_recv: 1n,
        next_sequence_ack: 1n,
        packet_commitment: new Map(),
        packet_receipt: new Map(),
        packet_acknowledgement: new Map(),
      },
      port: convertString2Hex(channelOpenInitOperator.port_id),
      token: channelToken,
    };
    const encodedMintChannelRedeemer: string = await this.lucidService.encode<MintChannelRedeemer>(
      mintChannelRedeemer,
      'mintChannelRedeemer',
    );
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode<HandlerDatum>(
      updatedHandlerDatum,
      'handler',
    );
    const encodedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(channelDatum, 'channel');
    const spendHandlerRefUtxo = this.configService.get('deployment').validators.spendHandler.refUtxo;
    const mintChannelRefUtxo = this.configService.get('deployment').validators.mintChannel.refUtxo;

    switch (channelOpenInitOperator.ordering) {
      case Order.Unordered:
        const spendTransferModuleRefUtxo = this.configService.get('deployment').validators.spendTransferModule.refUtxo;
        const transferModuleIdentifier = this.configService.get('deployment').modules.transfer.identifier;
        const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
        const spendTransferModuleRedeemer: IBCModuleRedeemer = {
          Callback: [
            {
              OnChanOpenInit: {
                channel_id: channelId,
              },
            },
          ],
        };
        const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
          spendTransferModuleRedeemer,
          'iBCModuleRedeemer',
        );
        const unsignedChannelOpenInitParams: UnsignedChannelOpenInitDto = {
          handlerUtxo,
          connectionUtxo,
          clientUtxo,
          spendHandlerRefUtxo,
          mintChannelRefUtxo,
          spendTransferModuleRefUtxo,
          transferModuleUtxo,
          encodedSpendTransferModuleRedeemer,
          encodedSpendHandlerRedeemer,
          encodedMintChannelRedeemer,
          channelTokenUnit,
          encodedUpdatedHandlerDatum,
          encodedChannelDatum,
          constructedAddress,
        };
        const unsignedUnorderedChannelTx =
          this.lucidService.createUnsignedChannelOpenInitTransaction(unsignedChannelOpenInitParams);
        return { unsignedTx: unsignedUnorderedChannelTx, channelId: channelId.toString() };
      case Order.Ordered:
        const spendMockModuleRefUtxo = this.configService.get('deployment').validators.spendMockModule.refUtxo;
        const mockModuleIdentifier = this.configService.get('deployment').modules.mock.identifier;
        const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);

        const spendMockModuleRedeemer: IBCModuleRedeemer = {
          Callback: [
            {
              OnChanOpenInit: {
                channel_id: channelId,
              },
            },
          ],
        };
        const encodedSpendMockModuleRedeemer: string = await this.lucidService.encode(
          spendMockModuleRedeemer,
          'iBCModuleRedeemer',
        );

        const currentMockModuleDatum = await this.lucidService.decodeDatum<MockModuleDatum>(
          mockModuleUtxo.datum!,
          'mockModule',
        );

        const newMockModuleDatum: MockModuleDatum = {
          ...currentMockModuleDatum,
        };

        const encodedNewMockModuleDatum: string = await this.lucidService.encode<MockModuleDatum>(
          newMockModuleDatum,
          'mockModule',
        );

        const unsignedOrderedChannelOpenInitParams: UnsignedOrderedChannelOpenInitDto = {
          handlerUtxo,
          connectionUtxo,
          clientUtxo,
          spendHandlerRefUtxo,
          mintChannelRefUtxo,
          spendMockModuleRefUtxo,
          mockModuleUtxo,
          encodedSpendMockModuleRedeemer,
          encodedSpendHandlerRedeemer,
          encodedMintChannelRedeemer,
          channelTokenUnit,
          encodedUpdatedHandlerDatum,
          encodedChannelDatum,
          encodedNewMockModuleDatum,
          constructedAddress,
        };
        const unsignedOrderedChannelTx = this.lucidService.createUnsignedOrderedChannelOpenInitTransaction(
          unsignedOrderedChannelOpenInitParams,
        );

        return { unsignedTx: unsignedOrderedChannelTx, channelId: channelId.toString() };
    }
  }
  /* istanbul ignore next */
  async buildUnsignedChannelOpenTryTx(
    channelOpenTryOperator: ChannelOpenTryOperator,
    constructedAddress: string,
  ): Promise<Tx> {
    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(channelOpenTryOperator.connectionId),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    const connectionClientSequence = parseClientSequence(convertHex2String(connectionDatum.state.client_id));
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(connectionClientSequence);
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const spendHandlerRedeemer: HandlerOperator = 'HandlerChanOpenTry';
    const encodedSpendHandlerRedeemer: string = await this.lucidService.encode<HandlerOperator>(
      spendHandlerRedeemer,
      'handlerOperator',
    );
    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_channel_sequence: handlerDatum.state.next_channel_sequence + 1n,
      },
    };
    const mintChannelRedeemer: MintChannelRedeemer = {
      ChanOpenTry: {
        handler_token: this.configService.get('deployment').handlerAuthToken,
        counterparty_version: convertString2Hex(channelOpenTryOperator.counterpartyVersion),
        //TODO
        proof_init: channelOpenTryOperator.proofInit,
        proof_height: channelOpenTryOperator.proofHeight,
      },
    };
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(
      handlerDatum.state.next_channel_sequence,
    );
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelToken: AuthToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };
    const channelDatum: ChannelDatum = {
      state: {
        channel: {
          state: ChannelState.TryOpen,
          counterparty: {
            port_id: convertString2Hex(channelOpenTryOperator.counterparty.port_id),
            channel_id: convertString2Hex(channelOpenTryOperator.counterparty.channel_id),
          },
          ordering: channelOpenTryOperator.ordering,
          connection_hops: [convertString2Hex(channelOpenTryOperator.connectionId)],
          version: convertString2Hex(channelOpenTryOperator.version),
        },
        next_sequence_send: 1n,
        next_sequence_recv: 1n,
        next_sequence_ack: 1n,
        packet_commitment: new Map(),
        packet_receipt: new Map(),
        packet_acknowledgement: new Map(),
      },
      port: convertString2Hex(channelOpenTryOperator.port_id),
      token: channelToken,
    };

    const encodedMintChannelRedeemer: string = await this.lucidService.encode<MintChannelRedeemer>(
      mintChannelRedeemer,
      'mintChannelRedeemer',
    );
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode<HandlerDatum>(
      updatedHandlerDatum,
      'handler',
    );
    const encodedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(channelDatum, 'channel');
    const spendHandlerRefUtxo = this.configService.get('deployment').validators.spendHandler.refUtxo;
    const mintChannelRefUtxo = this.configService.get('deployment').validators.mintChannel.refUtxo;
    const spendMockModuleRefUtxo = this.configService.get('deployment').validators.spendMockModule.refUtxo;
    const mockModuleIdentifier = this.configService.get('deployment').modules.mock.identifier;
    // Get mock module utxo
    const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);
    const channelId = convertString2Hex(CHANNEL_ID_PREFIX + '-' + handlerDatum.state.next_channel_sequence.toString());
    const spendMockModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnChanOpenTry: {
            channel_id: channelId,
          },
        },
      ],
    };
    const encodedSpendMockModuleRedeemer: string = await this.lucidService.encode(
      spendMockModuleRedeemer,
      'iBCModuleRedeemer',
    );
    const currentMockModuleDatum = await this.lucidService.decodeDatum<MockModuleDatum>(
      mockModuleUtxo.datum!,
      'mockModule',
    );
    const newMockModuleDatum: MockModuleDatum = {
      ...currentMockModuleDatum,
      opened_channels: insertSortMap(currentMockModuleDatum.opened_channels, channelId, true),
    };

    const encodedNewMockModuleDatum: string = await this.lucidService.encode<MockModuleDatum>(
      newMockModuleDatum,
      'mockModule',
    );

    // Call createUnsignedChannelOpenTryTransaction method with defined parameters
    return this.lucidService.createUnsignedChannelOpenTryTransaction(
      handlerUtxo,
      connectionUtxo,
      clientUtxo,
      mockModuleUtxo,
      spendHandlerRefUtxo,
      mintChannelRefUtxo,
      spendMockModuleRefUtxo,
      encodedSpendMockModuleRedeemer,
      encodedSpendHandlerRedeemer,
      encodedMintChannelRedeemer,
      channelTokenUnit,
      encodedUpdatedHandlerDatum,
      encodedChannelDatum,
      encodedNewMockModuleDatum,
      constructedAddress,
    );
  }
  async buildUnsignedChannelOpenAckTx(
    channelOpenAckOperator: ChannelOpenAckOperator,
    constructedAddress: string,
  ): Promise<Tx> {
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(
      BigInt(channelOpenAckOperator.channelSequence),
    );
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelUtxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    if (channelDatum.state.channel.state !== 'Init') {
      throw new GrpcInternalException('ChanOpenAck to channel not in Init state');
    }
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      //TODO: recheck
      parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    const clientSequence = parseClientSequence(convertHex2String(connectionDatum.state.client_id));
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(clientSequence);
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const clientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');

    // Get the keys (heights) of the map and convert them into an array
    const heightsArray = Array.from(clientDatum.state.consensusStates.keys());

    if (!isValidProofHeight(heightsArray, channelOpenAckOperator.proofHeight.revisionHeight)) {
      throw new GrpcInternalException(`Invalid proof height: ${channelOpenAckOperator.proofHeight.revisionHeight}`);
    }

    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        channel: {
          ...channelDatum.state.channel,
          state: ChannelState.Open,
          counterparty: {
            ...channelDatum.state.channel.counterparty,
            channel_id: convertString2Hex(channelOpenAckOperator.counterpartyChannelId),
          },
        },
      },
    };
    const spendChannelRedeemer: SpendChannelRedeemer = {
      ChanOpenAck: {
        counterparty_version: convertString2Hex(channelOpenAckOperator.counterpartyVersion),
        //TODO
        proof_try: channelOpenAckOperator.proofTry,
        proof_height: channelOpenAckOperator.proofHeight,
      },
    };
    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
    const spendChannelRefUtxo = this.configService.get('deployment').validators.spendChannel.refUtxo;
    const channelId = convertString2Hex(CHANNEL_ID_PREFIX + '-' + channelOpenAckOperator.channelSequence);

    const chanOpenAckPolicyId =
      this.configService.get('deployment').validators.spendChannel.refValidator.chan_open_ack.scriptHash;

    const chanOpenAckRefUtxo =
      this.configService.get('deployment').validators.spendChannel.refValidator.chan_open_ack.refUtxo;

    const channelToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };

    const verifyProofRefUTxO = this.configService.get('deployment').validators.verifyProof.refUtxo;
    const verifyProofPolicyId = this.configService.get('deployment').validators.verifyProof.scriptHash;
    const [_, consensusState] = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) => key.revisionHeight === channelOpenAckOperator.proofHeight.revisionHeight,
    );

    const cardanoChannelEnd: CardanoChannel = {
      state: CardanoChannelState.STATE_TRYOPEN,
      ordering: orderFromJSON(ORDER_MAPPING_CHANNEL[channelDatum.state.channel.ordering]),
      counterparty: {
        port_id: convertHex2String(channelDatum.port),
        channel_id: `${CHANNEL_ID_PREFIX}-${channelOpenAckOperator.channelSequence}`,
      },
      connection_hops: [convertHex2String(connectionDatum.state.counterparty.connection_id)],
      version: convertHex2String(channelDatum.state.channel.version),
    };

    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: channelOpenAckOperator.proofHeight,
        delay_time_period: connectionDatum.state.delay_period,
        delay_block_period: BigInt(getBlockDelay(connectionDatum.state.delay_period)),
        proof: channelOpenAckOperator.proofTry,
        path: {
          key_path: [
            connectionDatum.state.counterparty.prefix.key_prefix,
            convertString2Hex(
              channelPath(
                convertHex2String(updatedChannelDatum.state.channel.counterparty.port_id),
                convertHex2String(updatedChannelDatum.state.channel.counterparty.channel_id),
              ),
            ),
          ],
        },
        value: toHex(CardanoChannel.encode(cardanoChannelEnd).finish()),
      },
    };

    const encodedVerifyProofRedeemer: string = encodeVerifyProofRedeemer(
      verifyProofRedeemer,
      this.lucidService.LucidImporter,
    );

    switch (channelDatum.state.channel.ordering) {
      case Order.Unordered:
        const spendTransferModuleRefUtxo = this.configService.get('deployment').validators.spendTransferModule.refUtxo;
        const transferModuleIdentifier = this.configService.get('deployment').modules.transfer.identifier;
        const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);

        const spendTransferModuleRedeemer: IBCModuleRedeemer = {
          Callback: [
            {
              OnChanOpenAck: {
                channel_id: channelId,
              },
            },
          ],
        };
        const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
          spendTransferModuleRedeemer,
          'iBCModuleRedeemer',
        );
        const unsignedChannelOpenAckParams: UnsignedChannelOpenAckDto = {
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
          chanOpenAckPolicyId,
          chanOpenAckRefUtxo,
          channelToken,
          verifyProofPolicyId,
          verifyProofRefUTxO,
          encodedVerifyProofRedeemer,
        };
        return this.lucidService.createUnsignedChannelOpenAckTransaction(unsignedChannelOpenAckParams);
      case Order.Ordered:
        const spendMockModuleRefUtxo = this.configService.get('deployment').validators.spendMockModule.refUtxo;
        const mockModuleIdentifier = this.configService.get('deployment').modules.mock.identifier;
        const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);

        const spendMockModuleRedeemer: IBCModuleRedeemer = {
          Callback: [
            {
              OnChanOpenAck: {
                channel_id: channelId,
              },
            },
          ],
        };

        const encodedSpendMockModuleRedeemer: string = await this.lucidService.encode(
          spendMockModuleRedeemer,
          'iBCModuleRedeemer',
        );
        const unsignedOrderedChannelOpenAckParams: UnsignedOrderedChannelOpenAckDto = {
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
          constructedAddress,
          chanOpenAckPolicyId,
          chanOpenAckRefUtxo,
          channelToken,
          verifyProofPolicyId,
          verifyProofRefUTxO,
          encodedVerifyProofRedeemer,
        };
        return this.lucidService.createUnsignedOrderedChannelOpenAckTransaction(unsignedOrderedChannelOpenAckParams);
    }
  }
  /* istanbul ignore next */
  async buildUnsignedChannelOpenConfirmTx(
    channelOpenConfirmOperator: ChannelOpenConfirmOperator,
    constructedAddress: string,
  ): Promise<Tx> {
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(
      BigInt(channelOpenConfirmOperator.channelSequence),
    );
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelUtxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    if (channelDatum.state.channel.state !== 'TryOpen') {
      throw new GrpcInternalException('ChanOpenConfirm to channel not in TryOpen state');
    }
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      //TODO: recheck
      parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    const clientSequence = parseClientSequence(convertHex2String(connectionDatum.state.client_id));
    // Get the token unit associated with the client
    const clientTokenUnit = this.lucidService.getClientTokenUnit(clientSequence);
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);

    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        channel: {
          ...channelDatum.state.channel,
          state: ChannelState.Open,
        },
      },
    };
    const spendChannelRedeemer: SpendChannelRedeemer = {
      ChanOpenConfirm: {
        //TODO
        proof_ack: channelOpenConfirmOperator.proofAck,
        proof_height: channelOpenConfirmOperator.proofHeight,
      },
    };
    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
    const spendChannelRefUtxo = this.configService.get('deployment').validators.spendChannel.refUtxo;
    const spendMockModuleRefUtxo = this.configService.get('deployment').validators.spendMockModule.refUtxo;
    const mockModuleIdentifier = this.configService.get('deployment').modules.mock.identifier;

    const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);
    const channelId = convertString2Hex(CHANNEL_ID_PREFIX + '-' + channelOpenConfirmOperator.channelSequence);
    const spendMockModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnChanOpenConfirm: {
            channel_id: channelId,
          },
        },
      ],
    };
    const encodedSpendMockModuleRedeemer: string = await this.lucidService.encode(
      spendMockModuleRedeemer,
      'iBCModuleRedeemer',
    );
    const currentMockModuleDatum = await this.lucidService.decodeDatum<MockModuleDatum>(
      mockModuleUtxo.datum!,
      'mockModule',
    );
    const newMockModuleDatum: MockModuleDatum = currentMockModuleDatum;
    const encodedNewMockModuleDatum: string = await this.lucidService.encode<MockModuleDatum>(
      newMockModuleDatum,
      'mockModule',
    );
    // Call createUnsignedChannelOpenConfirmTransaction method with defined parameters
    return this.lucidService.createUnsignedChannelOpenConfirmTransaction(
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

  async buildUnsignedChannelCloseInitTx(
    channelCloseInitOperator: ChannelCloseInitOperator,
    constructedAddress: string,
  ): Promise<Tx> {

    const channelSequence = channelCloseInitOperator.channel_id

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence))
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel datum
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');

    const channelId = convertString2Hex(CHANNEL_ID_PREFIX + '-' + channelSequence);
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

    if(channelDatum.state.channel.state === ChannelState.Close) {
      throw new GrpcInternalException('Channel is in Close State');
    }

    // update channel datum
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        channel:
        {
          ...channelDatum.state.channel,
          state: ChannelState.Close,
        }
      },
    };
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
    
    const channelToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };

    const deploymentConfig = this.configService.get('deployment');
    const channelCloseInitPolicyId = deploymentConfig.validators.spendChannel.refValidator.chan_close_init.scriptHash;
    const channelCloseInitRefUtxO = deploymentConfig.validators.spendChannel.refValidator.chan_close_init.refUtxo;
    
    const spendChannelRefUtxo = deploymentConfig.validators.spendChannel.refUtxo;
    const spendMockModuleRefUtxo = deploymentConfig.validators.spendMockModule.refUtxo;
    const mockModuleIdentifier = deploymentConfig.modules.mock.identifier

    const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);

    const spendMockModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnChanCloseInit: {
            channel_id: channelId,
          },
        },
      ]
    };

    const encodedSpendMockModuleRedeemer: string = await this.lucidService.encode(
      spendMockModuleRedeemer,
      'iBCModuleRedeemer',
    );
    
    const spendChannelRedeemer: SpendChannelRedeemer = 'ChanCloseInit';
    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      spendChannelRedeemer,
      'spendChannelRedeemer',
    );

    const unsignedChannelCloseInitParams: UnsignedChannelCloseInitDto = {
      channelUtxo,
      connectionUtxo,
      clientUtxo,
      spendChannelRefUtxo,
      spendMockModuleRefUtxo,
      channelCloseInitRefUtxO,
      mockModuleUtxo,
      channelCloseInitPolicyId,
      encodedSpendChannelRedeemer,
      encodedSpendMockModuleRedeemer,
      channelTokenUnit,
      channelToken,
      encodedUpdatedChannelDatum,
      constructedAddress,
    };

    return this.lucidService.createUnsignedChannelCloseInitTransaction(unsignedChannelCloseInitParams);
  }
}
