import { type Tx, TxComplete, UTxO } from 'lucid-cardano';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException, GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { RpcException } from '@nestjs/microservices';
import {
  MsgChannelOpenAck,
  MsgChannelOpenAckResponse,
  MsgChannelOpenConfirm,
  MsgChannelOpenConfirmResponse,
  MsgChannelOpenInit,
  MsgChannelOpenInitResponse,
  MsgChannelOpenTry,
  MsgChannelOpenTryResponse,
} from 'cosmjs-types/src/ibc/core/channel/v1/tx';
import { ChannelOpenInitOperator } from './dto/channel/channel-open-init-operator.dto';
import { Order } from 'src/shared/types/channel/order';
import { ChannelOpenConfirmOperator } from './dto/channel/channel-open-confirm-operator.dto';
import { ChannelOpenAckOperator } from './dto/channel/channel-open-ack-operator.dto';
import { ChannelOpenTryOperator } from './dto/channel/channel-open-try-operator.dto';
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { HandlerOperator } from 'src/shared/types/handler-operator';
import { MintChannelRedeemer, SpendChannelRedeemer } from 'src/shared/types/channel/channel-redeemer';
import { ConfigService } from '@nestjs/config';
import { AuthToken } from 'src/shared/types/auth-token';
import { ChannelDatum } from 'src/shared/types/channel/channel-datum';
import { ChannelState } from 'src/shared/types/channel/state';
import { CHANNEL_ID_PREFIX } from '~@/constant';
import { IBCModuleRedeemer } from '~@/shared/types/port/ibc_module_redeemer';
import { MockModuleDatum } from '~@/shared/types/apps/mock/mock-module-datum';
import { insertSortMap } from '../shared/helpers/helper';

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
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (data.channel.connection_hops.length == 0) {
        throw new GrpcInvalidArgumentException('Invalid connection id: Connection Id is not valid');
      }
      // if (['transfer'].includes(data.port_id.toLocaleLowerCase())) data.port_id = 'port-99';

      // Prepare the Channel open init operator object
      const channelOpenInitOperator: ChannelOpenInitOperator = {
        //TODO: check in channel.connection_hops
        connectionId: data.channel.connection_hops[0],
        counterpartyPortId: data.channel.counterparty.port_id,
        ordering: Order.Unordered,
        version: data.channel.version,
        port_id: data.port_id,
      };

      // Build and complete the unsigned transaction
      const [unsignedChannelOpenInitTx, channelId] = await this.buildUnsignedChannelOpenInitTx(
        channelOpenInitOperator,
        constructedAddress,
      );
      const unsignedChannelOpenInitTxValidTo: Tx = unsignedChannelOpenInitTx.validTo(Date.now() + 600 * 1e3);

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
  async channelOpenTry(data: MsgChannelOpenTry): Promise<MsgChannelOpenTryResponse> {
    try {
      this.logger.log('Channel Open Try is processing');
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (data.channel.connection_hops.length == 0) {
        throw new GrpcInvalidArgumentException('Invalid connection id: Connection Id is not valid');
      }
      // if (['transfer'].includes(data.port_id.toLocaleLowerCase())) data.port_id = 'port-99';
      // Prepare the Channel open try operator object
      const channelOpenTryOperator: ChannelOpenTryOperator = {
        //TODO: check with connection_hops
        connectionId: data.channel.connection_hops[0],
        counterparty: data.channel.counterparty,
        ordering: Order.Unordered,
        version: data.channel.version,
        port_id: data.port_id,
        counterpartyVersion: data.counterparty_version,
        proofInit: this.lucidService.toBytes(data.proof_init), // hex string

        proofHeight: {
          revisionHeight: BigInt(data.proof_height?.revision_height || 0),
          revisionNumber: BigInt(data.proof_height?.revision_number || 0),
        },
      };
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
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (!data.channel_id?.startsWith(`${CHANNEL_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
        );
      // if (['transfer'].includes(data.port_id.toLocaleLowerCase())) data.port_id = 'port-99';
      const channelSequence: string = data.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
      // Prepare the Channel open ack operator object
      const channelOpenAckOperator: ChannelOpenAckOperator = {
        channelSequence: channelSequence,
        counterpartyChannelId: data.counterparty_channel_id,
        counterpartyVersion: data.counterparty_version,
        proofTry: this.lucidService.toBytes(data.proof_try), // hex string
        proofHeight: {
          revisionHeight: BigInt(data.proof_height?.revision_height || 0),
          revisionNumber: BigInt(data.proof_height?.revision_number || 0),
        },
      };
      // Build and complete the unsigned transaction
      const unsignedChannelOpenAckTx: Tx = await this.buildUnsignedChannelOpenAckTx(
        channelOpenAckOperator,
        constructedAddress,
      );
      const unsignedChannelOpenAckTxValidTo: Tx = unsignedChannelOpenAckTx.validTo(Date.now() + 600 * 1e3);

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
  async channelOpenConfirm(data: MsgChannelOpenConfirm): Promise<MsgChannelOpenConfirmResponse> {
    try {
      this.logger.log('Channel Open Confirm is processing');
      const constructedAddress: string = data.signer;
      if (!constructedAddress) {
        throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      }
      if (!data.channel_id?.startsWith(`${CHANNEL_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
        );
      const channelSequence: string = data.channel_id.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
      // Prepare the Channel open init operator object
      const channelOpenInitOperator: ChannelOpenConfirmOperator = {
        //TODO: recheck
        channelSequence: channelSequence,
        proofAck: this.lucidService.toBytes(data.proof_ack),
        proofHeight: {
          revisionHeight: BigInt(data.proof_height?.revision_height || 0),
          revisionNumber: BigInt(data.proof_height?.revision_number || 0),
        },
      };
      // Build and complete the unsigned transaction
      const unsignedChannelConfirmInitTx: Tx = await this.buildUnsignedChannelOpenConfirmTx(
        channelOpenInitOperator,
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
  async buildUnsignedChannelOpenInitTx(
    channelOpenInitOperator: ChannelOpenInitOperator,
    constructedAddress: string,
  ): Promise<[Tx, string]> {
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
    const connectionClientSequence = parseClientSequence(this.lucidService.toText(connectionDatum.state.client_id));
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
    const channelId = this.lucidService.toHex(CHANNEL_ID_PREFIX + '-' + channelSequence);

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
            port_id: this.lucidService.toHex(channelOpenInitOperator.counterpartyPortId),
            channel_id: this.lucidService.toHex(''),
          },
          ordering: channelOpenInitOperator.ordering,
          connection_hops: [this.lucidService.toHex(channelOpenInitOperator.connectionId)],
          version: this.lucidService.toHex(channelOpenInitOperator.version),
        },
        next_sequence_send: 1n,
        next_sequence_recv: 1n,
        next_sequence_ack: 1n,
        packet_commitment: new Map(),
        packet_receipt: new Map(),
        packet_acknowledgement: new Map(),
      },
      port: this.lucidService.toHex(channelOpenInitOperator.port_id),
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
      opened_channels: insertSortMap(currentMockModuleDatum.opened_channels, channelId, true),
    };
    const encodedNewMockModuleDatum: string = await this.lucidService.encode<MockModuleDatum>(
      newMockModuleDatum,
      'mockModule',
    );
    // Call createUnsignedChannelOpenInitTransaction method with defined parameters
    const unsignedTx = this.lucidService.createUnsignedChannelOpenInitTransaction(
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
    );
    return [unsignedTx, channelId.toString()];
  }
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
    const connectionClientSequence = parseClientSequence(this.lucidService.toText(connectionDatum.state.client_id));
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
        counterparty_version: this.lucidService.toHex(channelOpenTryOperator.counterpartyVersion),
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
            port_id: this.lucidService.toHex(channelOpenTryOperator.counterparty.port_id),
            channel_id: this.lucidService.toHex(channelOpenTryOperator.counterparty.channel_id),
          },
          ordering: channelOpenTryOperator.ordering,
          connection_hops: [this.lucidService.toHex(channelOpenTryOperator.connectionId)],
          version: this.lucidService.toHex(channelOpenTryOperator.version),
        },
        next_sequence_send: 1n,
        next_sequence_recv: 1n,
        next_sequence_ack: 1n,
        packet_commitment: new Map(),
        packet_receipt: new Map(),
        packet_acknowledgement: new Map(),
      },
      port: this.lucidService.toHex(channelOpenTryOperator.port_id),
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
    const channelId = this.lucidService.toHex(
      CHANNEL_ID_PREFIX + '-' + handlerDatum.state.next_channel_sequence.toString(),
    );
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
      parseConnectionSequence(this.lucidService.toText(channelDatum.state.channel.connection_hops[0])),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    const clientSequence = parseClientSequence(this.lucidService.toText(connectionDatum.state.client_id));
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
          counterparty: {
            ...channelDatum.state.channel.counterparty,
            channel_id: this.lucidService.toHex(channelOpenAckOperator.counterpartyChannelId),
          },
        },
      },
    };
    const spendChannelRedeemer: SpendChannelRedeemer = {
      ChanOpenAck: {
        counterparty_version: this.lucidService.toHex(channelOpenAckOperator.counterpartyVersion),
        proof_try: this.lucidService.toHex(channelOpenAckOperator.proofTry),
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
    const spendMockModuleRefUtxo = this.configService.get('deployment').validators.spendMockModule.refUtxo;
    const mockModuleIdentifier = this.configService.get('deployment').modules.mock.identifier;
    const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);
    const channelId = this.lucidService.toHex(CHANNEL_ID_PREFIX + '-' + channelOpenAckOperator.channelSequence);
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
    const currentMockModuleDatum = await this.lucidService.decodeDatum<MockModuleDatum>(
      mockModuleUtxo.datum!,
      'mockModule',
    );
    const newMockModuleDatum: MockModuleDatum = currentMockModuleDatum;
    const encodedNewMockModuleDatum: string = await this.lucidService.encode<MockModuleDatum>(
      newMockModuleDatum,
      'mockModule',
    );

    // Call createUnsignedChannelOpenAckTransaction method with defined parameters
    return this.lucidService.createUnsignedChannelOpenAckTransaction(
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
      parseConnectionSequence(this.lucidService.toText(channelDatum.state.channel.connection_hops[0])),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    // Find the UTXO for the client token
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    const clientSequence = parseClientSequence(this.lucidService.toText(connectionDatum.state.client_id));
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
        proof_ack: this.lucidService.toHex(channelOpenConfirmOperator.proofAck),
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
    const channelId = this.lucidService.toHex(CHANNEL_ID_PREFIX + '-' + channelOpenConfirmOperator.channelSequence);
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
}
