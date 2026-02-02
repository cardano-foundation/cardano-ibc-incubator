import { TxBuilder, UTxO } from '@lucid-evolution/lucid';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException } from '~@/exception/grpc_exceptions';
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
import { HandlerDatum } from 'src/shared/types/handler-datum';
import { HostStateDatum } from 'src/shared/types/host-state-datum';
import { parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { HandlerOperator } from 'src/shared/types/handler-operator';
import { MintChannelRedeemer, SpendChannelRedeemer } from 'src/shared/types/channel/channel-redeemer';
import { ConfigService } from '@nestjs/config';
import { AuthToken } from 'src/shared/types/auth-token';
import { ChannelDatum, encodeChannelEndValue } from 'src/shared/types/channel/channel-datum';
import { ChannelState } from 'src/shared/types/channel/state';
import { CHANNEL_ID_PREFIX } from 'src/constant';
import { IBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import { MockModuleDatum } from '@shared/types/apps/mock/mock-module-datum';
import { insertSortMap } from '../shared/helpers/helper';
import { convertHex2String, convertString2Hex, toHex } from '@shared/helpers/hex';
import { ClientDatum } from '@shared/types/client-datum';
import { isValidProofHeight } from './helper/height.validate';
import { TxEventsService } from './tx-events.service';
import {
  validateAndFormatChannelOpenAckParams,
  validateAndFormatChannelOpenConfirmParams,
  validateAndFormatChannelOpenInitParams,
  validateAndFormatChannelOpenTryParams,
  validateAndFormatChannelCloseInitParams,
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
import { sleep } from '../shared/helpers/time';
import {
  ChannelCloseInitOperator,
  ChannelOpenAckOperator,
  ChannelOpenConfirmOperator,
  ChannelOpenInitOperator,
  ChannelOpenTryOperator,
} from './dto';
import {
  UnsignedChannelCloseInitDto,
  UnsignedChannelOpenAckDto,
  UnsignedChannelOpenInitDto,
} from '~@/shared/modules/lucid/dtos';
import { TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import {
  alignTreeWithChain,
  computeRootWithCreateChannelUpdate,
  computeRootWithUpdateChannelUpdate,
  isTreeAligned,
} from '../shared/helpers/ibc-state-root';

@Injectable()
export class ChannelService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    private readonly txEventsService: TxEventsService,
  ) {}

  /**
   * Compute the new IBC state root for CreateChannel, and also return the per-key witnesses.
   *
   * The on-chain `host_state_stt` validator uses these witnesses to enforce that the new
   * `ibc_state_root` is derived from the old root (not an arbitrary value).
   */
  private async computeRootWithCreateChannelUpdate(
    oldRoot: string,
    portId: string,
    channelId: string,
    channelDatum: ChannelDatum,
  ): Promise<{
    newRoot: string;
    channelSiblings: string[];
    nextSequenceSendSiblings: string[];
    nextSequenceRecvSiblings: string[];
    nextSequenceAckSiblings: string[];
  }> {
    // Encode the exact bytes that the on-chain validator commits to the root.
    // These bytes must match Aiken's `cbor.serialise(...)` output.
    const channelValue = Buffer.from(
      await encodeChannelEndValue(channelDatum.state.channel, this.lucidService.LucidImporter),
      'hex',
    );

    const { Data } = this.lucidService.LucidImporter;
    const nextSequenceSendValue = Buffer.from(
      Data.to(channelDatum.state.next_sequence_send as any, Data.Integer() as any),
      'hex',
    );
    const nextSequenceRecvValue = Buffer.from(
      Data.to(channelDatum.state.next_sequence_recv as any, Data.Integer() as any),
      'hex',
    );
    const nextSequenceAckValue = Buffer.from(
      Data.to(channelDatum.state.next_sequence_ack as any, Data.Integer() as any),
      'hex',
    );

    return computeRootWithCreateChannelUpdate(
      oldRoot,
      portId,
      channelId,
      channelValue,
      nextSequenceSendValue,
      nextSequenceRecvValue,
      nextSequenceAckValue,
    );
  }

  /**
   * Compute the new IBC state root for UpdateChannel (handshake continuation),
   * and also return the per-key witness.
   *
   * The on-chain `host_state_stt` validator uses this witness to enforce that the new
   * `ibc_state_root` is derived from the old root (not an arbitrary value).
   */
  private async computeRootWithUpdateChannelUpdate(
    oldRoot: string,
    portId: string,
    channelId: string,
    channelDatum: ChannelDatum,
  ): Promise<{ newRoot: string; channelSiblings: string[] }> {
    // Encode the exact bytes that the on-chain validator commits to the root.
    // These bytes must match Aiken's `cbor.serialise(...)` output.
    const channelValue = Buffer.from(
      await encodeChannelEndValue(channelDatum.state.channel, this.lucidService.LucidImporter),
      'hex',
    );

    return computeRootWithUpdateChannelUpdate(oldRoot, portId, channelId, channelValue);
  }
  
  /**
   * Ensure the in-memory Merkle tree is aligned with on-chain state
   */
  private async ensureTreeAligned(onChainRoot: string): Promise<void> {
    if (!isTreeAligned(onChainRoot)) {
      this.logger.warn(`Tree is out of sync with on-chain root ${onChainRoot.substring(0, 16)}..., rebuilding...`);
      await alignTreeWithChain();
    }
  }

  async channelOpenInit(data: MsgChannelOpenInit): Promise<MsgChannelOpenInitResponse> {
    try {
      this.logger.log('Channel Open Init is processing');
      const { channelOpenInitOperator, constructedAddress } = validateAndFormatChannelOpenInitParams(data);
      // Build and complete the unsigned transaction
      const { unsignedTx: unsignedChannelOpenInitTx, channelId } = await this.buildUnsignedChannelOpenInitTx(
        channelOpenInitOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('channel init failed: tx time invalid');
      }
      const unsignedChannelOpenInitTxValidTo: TxBuilder = unsignedChannelOpenInitTx.validTo(validToTime);
      
      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedChannelOpenInitTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      // Hermes expects an ABCI-style event list from the tx submission response.
      // Cardano has no native events, so the Gateway synthesizes the equivalent IBC events
      // and returns them from the SubmitSignedTx response (keyed by tx hash).
      this.txEventsService.register(unsignedTxHash, [
        {
          type: 'channel_open_init',
          attributes: [
            { key: 'port_id', value: channelOpenInitOperator.port_id },
            { key: 'channel_id', value: channelId },
            { key: 'connection_id', value: channelOpenInitOperator.connectionId },
            { key: 'counterparty_port_id', value: channelOpenInitOperator.counterpartyPortId },
            { key: 'counterparty_channel_id', value: '' },
          ],
        },
      ]);

      this.logger.log('Returning unsigned tx for channel open init');
      const response: MsgChannelOpenInitResponse = {
        channel_id: channelId,
        version: data.channel.version,
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
        },
      } as unknown as MsgChannelOpenInitResponse;
      return response;
    } catch (error) {
      let throwError: Error = error as Error;
      this.logger.error(`channelOpenInit: ${throwError.name} - ${throwError.message}`, throwError.stack);
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
      const unsignedChannelOpenTryTx: TxBuilder = await this.buildUnsignedChannelOpenTryTx(
        channelOpenTryOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedChannelOpenTryTxValidTo: TxBuilder = unsignedChannelOpenTryTx.validTo(validToTime);
      
      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedChannelOpenTryTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));

      this.logger.log('Returning unsigned tx for channel open try');
      const response: MsgChannelOpenTryResponse = {
        version: channelOpenTryOperator.version,
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
      const { unsignedTx: unsignedChannelOpenAckTx, event: channelOpenAckEvent } =
        await this.buildUnsignedChannelOpenAckTx(
        channelOpenAckOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('channel init failed: tx time invalid');
      }
      const unsignedChannelOpenAckTxValidTo: TxBuilder = unsignedChannelOpenAckTx.validTo(validToTime);

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedChannelOpenAckTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.txEventsService.register(unsignedTxHash, [
        {
          type: 'channel_open_ack',
          attributes: [
            { key: 'port_id', value: channelOpenAckEvent.port_id },
            { key: 'channel_id', value: channelOpenAckEvent.channel_id },
            { key: 'connection_id', value: channelOpenAckEvent.connection_id },
            { key: 'counterparty_port_id', value: channelOpenAckEvent.counterparty_port_id },
            { key: 'counterparty_channel_id', value: channelOpenAckEvent.counterparty_channel_id },
          ],
        },
      ]);

      await sleep(7000);
      this.logger.log('Returning unsigned tx for channel open ack');
      const response: MsgChannelOpenAckResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
      const unsignedChannelConfirmInitTx: TxBuilder = await this.buildUnsignedChannelOpenConfirmTx(
        channelOpenConfirmOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedChannelConfirmInitTxValidTo: TxBuilder = unsignedChannelConfirmInitTx.validTo(validToTime);

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedChannelConfirmInitTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));

      this.logger.log('Returning unsigned tx for channel open confirm');
      const response: MsgChannelOpenConfirmResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
    try {
      this.logger.log('Channel Close Init is processing');
      const { constructedAddress, channelCloseInitOperator } = validateAndFormatChannelCloseInitParams(data);
      // Build and complete the unsigned transaction
      const unsignedChannelCloseInitTx: TxBuilder = await this.buildUnsignedChannelCloseInitTx(
        channelCloseInitOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedChannelCloseInitTxValidTo: TxBuilder = unsignedChannelCloseInitTx.validTo(validToTime);

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedChannelCloseInitTxValidTo.complete({ localUPLCEval: false });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));

      this.logger.log('Returning unsigned tx for channel close init');
      const response: MsgChannelCloseInitResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
  ): Promise<{ unsignedTx: TxBuilder; channelId: string }> {
    // STT Architecture: Query the HostState UTXO via its unique NFT.
    // This datum is the authoritative source of:
    // - `ibc_state_root` (the Merkle commitment root)
    // - sequence counters (client/connection/channel)
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );

    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing witnesses.
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);

    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');
    if (handlerDatum.state.next_channel_sequence !== hostStateDatum.state.next_channel_sequence) {
      throw new GrpcInternalException(
        `Handler/HostState channel sequence mismatch: handler=${handlerDatum.state.next_channel_sequence}, hostState=${hostStateDatum.state.next_channel_sequence}`,
      );
    }

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
    
    // Derive the new channel identifier from the HostState sequence.
    const channelSequence = hostStateDatum.state.next_channel_sequence;
    const channelId = `channel-${channelSequence}`;
    const mintChannelRedeemer: MintChannelRedeemer = {
      ChanOpenInit: {
        handler_token: this.configService.get('deployment').handlerAuthToken,
      },
    };
    const channelIdHex = convertString2Hex(CHANNEL_ID_PREFIX + '-' + channelSequence);

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

    const {
      newRoot,
      channelSiblings,
      nextSequenceSendSiblings,
      nextSequenceRecvSiblings,
      nextSequenceAckSiblings,
    } = await this.computeRootWithCreateChannelUpdate(
      hostStateDatum.state.ibc_state_root,
      channelOpenInitOperator.port_id,
      channelId,
      channelDatum,
    );

    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_channel_sequence: hostStateDatum.state.next_channel_sequence + 1n,
        ibc_state_root: newRoot,
      },
    };

    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        next_channel_sequence: hostStateDatum.state.next_channel_sequence + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };

    const hostStateRedeemer = {
      CreateChannel: {
        channel_siblings: channelSiblings,
        next_sequence_send_siblings: nextSequenceSendSiblings,
        next_sequence_recv_siblings: nextSequenceRecvSiblings,
        next_sequence_ack_siblings: nextSequenceAckSiblings,
      },
    };
    const encodedMintChannelRedeemer: string = await this.lucidService.encode<MintChannelRedeemer>(
      mintChannelRedeemer,
      'mintChannelRedeemer',
    );
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode(updatedHandlerDatum, 'handler');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    const encodedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(channelDatum, 'channel');
    const transferModuleIdentifier = this.configService.get('deployment').modules.transfer.identifier;
    const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
    const spendTransferModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnChanOpenInit: {
            channel_id: channelIdHex,
          },
        },
      ],
    };
    const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
      spendTransferModuleRedeemer,
      'iBCModuleRedeemer',
    );
    const unsignedChannelOpenInitParams: UnsignedChannelOpenInitDto = {
      hostStateUtxo,
      encodedHostStateRedeemer,
      handlerUtxo,
      connectionUtxo,
      clientUtxo,
      transferModuleUtxo,
      encodedSpendTransferModuleRedeemer,
      encodedSpendHandlerRedeemer,
      encodedMintChannelRedeemer,
      channelTokenUnit,
      encodedUpdatedHandlerDatum,
      encodedUpdatedHostStateDatum,
      encodedChannelDatum,
      constructedAddress,
    };
    const unsignedUnorderedChannelTx =
      this.lucidService.createUnsignedChannelOpenInitTransaction(unsignedChannelOpenInitParams);
    return { unsignedTx: unsignedUnorderedChannelTx, channelId };
  }
  /* istanbul ignore next */
  async buildUnsignedChannelOpenTryTx(
    channelOpenTryOperator: ChannelOpenTryOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
    // STT Architecture: Query the HostState UTXO via its unique NFT.
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );

    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing witnesses.
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);

    const handlerUtxo: UTxO = await this.lucidService.findUtxoAtHandlerAuthToken();
    const handlerDatum: HandlerDatum = await this.lucidService.decodeDatum<HandlerDatum>(handlerUtxo.datum!, 'handler');
    if (handlerDatum.state.next_channel_sequence !== hostStateDatum.state.next_channel_sequence) {
      throw new GrpcInternalException(
        `Handler/HostState channel sequence mismatch: handler=${handlerDatum.state.next_channel_sequence}, hostState=${hostStateDatum.state.next_channel_sequence}`,
      );
    }
    
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

    // Derive the new channel identifier from the HostState sequence.
    const channelSequence = hostStateDatum.state.next_channel_sequence;
    const channelId = `channel-${channelSequence}`;
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
      hostStateDatum.state.next_channel_sequence,
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

    const {
      newRoot,
      channelSiblings,
      nextSequenceSendSiblings,
      nextSequenceRecvSiblings,
      nextSequenceAckSiblings,
    } = await this.computeRootWithCreateChannelUpdate(
      hostStateDatum.state.ibc_state_root,
      channelOpenTryOperator.port_id,
      channelId,
      channelDatum,
    );

    const updatedHandlerDatum: HandlerDatum = {
      ...handlerDatum,
      state: {
        ...handlerDatum.state,
        next_channel_sequence: hostStateDatum.state.next_channel_sequence + 1n,
        ibc_state_root: newRoot,
      },
    };

    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        next_channel_sequence: hostStateDatum.state.next_channel_sequence + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };

    const hostStateRedeemer = {
      CreateChannel: {
        channel_siblings: channelSiblings,
        next_sequence_send_siblings: nextSequenceSendSiblings,
        next_sequence_recv_siblings: nextSequenceRecvSiblings,
        next_sequence_ack_siblings: nextSequenceAckSiblings,
      },
    };

    const encodedMintChannelRedeemer: string = await this.lucidService.encode<MintChannelRedeemer>(
      mintChannelRedeemer,
      'mintChannelRedeemer',
    );
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHandlerDatum: string = await this.lucidService.encode(updatedHandlerDatum, 'handler');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    const encodedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(channelDatum, 'channel');
    const mockModuleIdentifier = this.configService.get('deployment').modules.mock.identifier;
    // Get mock module utxo
    const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);
    const channelIdHex = convertString2Hex(CHANNEL_ID_PREFIX + '-' + channelSequence.toString());
    const spendMockModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnChanOpenTry: {
            channel_id: channelIdHex,
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
      hostStateUtxo,
      encodedHostStateRedeemer,
      connectionUtxo,
      clientUtxo,
      mockModuleUtxo,
      encodedSpendMockModuleRedeemer,
      encodedSpendHandlerRedeemer,
      encodedMintChannelRedeemer,
      channelTokenUnit,
      encodedUpdatedHandlerDatum,
      encodedUpdatedHostStateDatum,
      encodedChannelDatum,
      encodedNewMockModuleDatum,
      constructedAddress,
    );
  }
  async buildUnsignedChannelOpenAckTx(
    channelOpenAckOperator: ChannelOpenAckOperator,
    constructedAddress: string,
  ): Promise<{
    unsignedTx: TxBuilder;
    event: {
      port_id: string;
      channel_id: string;
      connection_id: string;
      counterparty_port_id: string;
      counterparty_channel_id: string;
    };
  }> {
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

    // STT Architecture: Query the HostState UTXO via its unique NFT.
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );

    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing witnesses.
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);
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

    if (!isValidProofHeight(heightsArray, channelOpenAckOperator.proofHeight)) {
      throw new GrpcInternalException(
        `Invalid proof height: ${channelOpenAckOperator.proofHeight.revisionNumber}/${channelOpenAckOperator.proofHeight.revisionHeight}`,
      );
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

    // Root correctness enforcement: Update the HostState commitment root by applying the channel end update.
    const portId = convertHex2String(channelDatum.port);
    const channelIdForRoot = `${CHANNEL_ID_PREFIX}-${channelOpenAckOperator.channelSequence}`;
    const { newRoot, channelSiblings } = await this.computeRootWithUpdateChannelUpdate(
      hostStateDatum.state.ibc_state_root,
      portId,
      channelIdForRoot,
      updatedChannelDatum,
    );
    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };

    // The HostState redeemer carries the witness proving how the root was updated.
    const hostStateRedeemer = {
      UpdateChannel: {
        channel_siblings: channelSiblings,
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
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
    const channelId = convertString2Hex(CHANNEL_ID_PREFIX + '-' + channelOpenAckOperator.channelSequence);

    const chanOpenAckPolicyId =
      this.configService.get('deployment').validators.spendChannel.refValidator.chan_open_ack.scriptHash;

    const channelToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };

    const verifyProofPolicyId = this.configService.get('deployment').validators.verifyProof.scriptHash;
    const consensusEntry = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) =>
        key.revisionNumber === channelOpenAckOperator.proofHeight.revisionNumber &&
        key.revisionHeight === channelOpenAckOperator.proofHeight.revisionHeight,
    );
    if (!consensusEntry) {
      throw new GrpcInternalException(
        `Missing consensus state at proof height ${channelOpenAckOperator.proofHeight.revisionNumber}/${channelOpenAckOperator.proofHeight.revisionHeight}`,
      );
    }
    const consensusState = consensusEntry[1];

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
        delay_block_period: getBlockDelay(connectionDatum.state.delay_period),
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
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      channelUtxo,
      connectionUtxo,
      clientUtxo,
      transferModuleUtxo,
      encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer,
      channelTokenUnit,
      encodedUpdatedChannelDatum,
      constructedAddress,
      chanOpenAckPolicyId,
      channelToken,
      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
    };
    const unsignedTx = this.lucidService.createUnsignedChannelOpenAckTransaction(unsignedChannelOpenAckParams);

    return {
      unsignedTx,
      event: {
        port_id: portId,
        channel_id: channelIdForRoot,
        connection_id: convertHex2String(channelDatum.state.channel.connection_hops[0]),
        counterparty_port_id: convertHex2String(channelDatum.state.channel.counterparty.port_id),
        counterparty_channel_id: channelOpenAckOperator.counterpartyChannelId || '',
      },
    };
  }
  /* istanbul ignore next */
  async buildUnsignedChannelOpenConfirmTx(
    channelOpenConfirmOperator: ChannelOpenConfirmOperator,
    constructedAddress: string,
  ): Promise<TxBuilder> {
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

    // STT Architecture: Query the HostState UTXO via its unique NFT.
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );

    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing witnesses.
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);
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

    // Root correctness enforcement: Update the HostState commitment root by applying the channel end update.
    const portId = convertHex2String(channelDatum.port);
    const channelIdForRoot = `${CHANNEL_ID_PREFIX}-${channelOpenConfirmOperator.channelSequence}`;
    const { newRoot, channelSiblings } = await this.computeRootWithUpdateChannelUpdate(
      hostStateDatum.state.ibc_state_root,
      portId,
      channelIdForRoot,
      updatedChannelDatum,
    );
    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };

    // The HostState redeemer carries the witness proving how the root was updated.
    const hostStateRedeemer = {
      UpdateChannel: {
        channel_siblings: channelSiblings,
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
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );
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
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      channelUtxo,
      connectionUtxo,
      clientUtxo,
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
  ): Promise<TxBuilder> {
    // STT Architecture: Query the HostState UTXO via its unique NFT.
    // This datum is the authoritative source of the current commitment root.
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }
    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );

    // Ensure the in-memory Merkle tree is aligned with on-chain state before computing witnesses.
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);

    const channelSequence = channelCloseInitOperator.channel_id;

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
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

    if (channelDatum.state.channel.state === ChannelState.Close) {
      throw new GrpcInternalException('Channel is in Close State');
    }

    // update channel datum
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        channel: {
          ...channelDatum.state.channel,
          state: ChannelState.Close,
        },
      },
    };

    // Root correctness enforcement: Update the HostState commitment root by applying the channel end update.
    const portId = convertHex2String(channelDatum.port);
    const channelIdForRoot = `${CHANNEL_ID_PREFIX}-${channelSequence}`;
    const { newRoot, channelSiblings } = await this.computeRootWithUpdateChannelUpdate(
      hostStateDatum.state.ibc_state_root,
      portId,
      channelIdForRoot,
      updatedChannelDatum,
    );
    const updatedHostStateDatum: HostStateDatum = {
      ...hostStateDatum,
      state: {
        ...hostStateDatum.state,
        version: hostStateDatum.state.version + 1n,
        ibc_state_root: newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };

    // The HostState redeemer carries the witness proving how the root was updated.
    const hostStateRedeemer = {
      UpdateChannel: {
        channel_siblings: channelSiblings,
      },
    };
    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');

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
    const mockModuleIdentifier = deploymentConfig.modules.mock.identifier;

    const mockModuleUtxo = await this.lucidService.findUtxoByUnit(mockModuleIdentifier);

    const spendMockModuleRedeemer: IBCModuleRedeemer = {
      Callback: [
        {
          OnChanCloseInit: {
            channel_id: channelId,
          },
        },
      ],
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
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      channelUtxo,
      connectionUtxo,
      clientUtxo,
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
