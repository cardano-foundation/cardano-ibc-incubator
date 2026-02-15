import { Inject, Injectable, Logger } from '@nestjs/common';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { DenomTraceService } from 'src/query/services/denom-trace.service';
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

import { TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { parseChannelSequence, parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ChannelDatum } from 'src/shared/types/channel/channel-datum';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { Packet } from 'src/shared/types/channel/packet';
import { SpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';
import { ACK_RESULT, CHANNEL_ID_PREFIX, LOVELACE, ORDER_MAPPING_CHANNEL } from 'src/constant';
import { IBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import {
  deleteKeySortMap,
  deleteSortMap,
  getDenomPrefix,
  insertSortMapWithNumberKey,
  prependToMap,
  sortedStringify,
} from '@shared/helpers/helper';
import { RpcException } from '@nestjs/microservices';
import { FungibleTokenPacketDatum } from '@shared/types/apps/transfer/types/fungible-token-packet-data';
import { TransferModuleRedeemer } from '../shared/types/apps/transfer/transfer_module_redeemer/transfer-module-redeemer';
import { mapLovelaceDenom, normalizeDenomTokenTransfer, sumLovelaceFromUtxos } from './helper/helper';
import { convertHex2String, convertString2Hex, hashSHA256, hashSha3_256 } from '../shared/helpers/hex';
import { MintVoucherRedeemer } from '@shared/types/apps/transfer/mint_voucher_redeemer/mint-voucher-redeemer';
import { commitPacket } from '../shared/helpers/commitment';
import { ClientDatum } from '@shared/types/client-datum';
import { isValidProofHeight } from './helper/height.validate';
import { AcknowledgementResponse } from '@shared/types/channel/acknowledgement_response';
import { HostStateDatum } from 'src/shared/types/host-state-datum';
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
import { TRANSACTION_SET_COLLATERAL, TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import {
  AckPacketOperator,
  RecvPacketOperator,
  SendPacketOperator,
  TimeoutPacketOperator,
  TimeoutRefreshOperator,
} from './dto';
import { IbcTreePendingUpdatesService, PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';
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
import { alignTreeWithChain, computeRootWithHandlePacketUpdate, isTreeAligned } from '../shared/helpers/ibc-state-root';
import { splitFullDenomTrace } from '../shared/helpers/denom-trace';

@Injectable()
export class PacketService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    private denomTraceService: DenomTraceService,
    private readonly ibcTreePendingUpdatesService: IbcTreePendingUpdatesService,
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

  /**
   * Ensure the in-memory Merkle tree is aligned with on-chain state.
   *
   * Packet handlers must compute sibling witnesses against the *current* root,
   * otherwise `host_state_stt` will reject the transaction.
   */
  private async ensureTreeAligned(onChainRoot: string): Promise<void> {
    if (!isTreeAligned(onChainRoot)) {
      this.logger.warn(`Tree is out of sync with on-chain root ${onChainRoot.substring(0, 16)}..., rebuilding...`);
      await alignTreeWithChain();
    }
  }

  private dedupeUtxos(utxos: UTxO[]): UTxO[] {
    // Prefer the *last* occurrence for a given out-ref so callers can append a "canonical" UTxO
    // (e.g., fetched via `utxosAtWithUnit`) that should be used both for `collectFrom(...)` and
    // within the wallet UTxO set passed to `fromAddress(...)`.
    const map = new Map<string, UTxO>();
    const order: string[] = [];

    for (const utxo of utxos) {
      const key = `${utxo.txHash}#${utxo.outputIndex}`;
      if (!map.has(key)) order.push(key);
      map.set(key, utxo);
    }

    return order.map((k) => map.get(k)!).filter(Boolean);
  }

  private async refreshWalletContext(
    address: string,
    context: string,
    options?: { excludeAssetUnit?: string },
  ): Promise<void> {
    const walletUtxos = await this.lucidService.tryFindUtxosAt(address, {
      maxAttempts: 6,
      retryDelayMs: 1000,
    });
    if (walletUtxos.length === 0) {
      throw new GrpcInternalException(`${context} failed: no spendable UTxOs found for ${address}`);
    }

    const excludeAssetUnit = options?.excludeAssetUnit?.trim();
    const selectableWalletUtxos = excludeAssetUnit
      ? walletUtxos.filter((utxo) => {
          const assetAmount = (utxo.assets as Record<string, unknown>)[excludeAssetUnit];
          if (assetAmount === undefined || assetAmount === null) {
            return true;
          }
          if (typeof assetAmount === 'bigint') {
            return assetAmount === 0n;
          }
          if (typeof assetAmount === 'number') {
            return assetAmount === 0;
          }
          if (typeof assetAmount === 'string') {
            try {
              return BigInt(assetAmount) === 0n;
            } catch {
              return false;
            }
          }
          return false;
        })
      : walletUtxos;

    if (selectableWalletUtxos.length === 0) {
      throw new GrpcInternalException(
        `${context} failed: no spendable UTxOs found for ${address} after excluding asset ${excludeAssetUnit}`,
      );
    }

    if (excludeAssetUnit) {
      const walletSelectionView = walletUtxos.map((utxo) => {
        const assetAmount = (utxo.assets as Record<string, unknown>)[excludeAssetUnit];
        const amountString =
          typeof assetAmount === 'bigint' ? assetAmount.toString() : assetAmount === undefined ? 'none' : String(assetAmount);
        return `${utxo.txHash}#${utxo.outputIndex}:${amountString}`;
      });
      this.logger.log(
        `[walletContext] ${context} exclude_asset=${excludeAssetUnit} candidates=${walletSelectionView.join(', ')}`,
      );
    }

    this.lucidService.selectWalletFromAddress(address, selectableWalletUtxos);
    this.logger.log(
      `[walletContext] ${context} selecting wallet from ${address}, utxos=${selectableWalletUtxos.length}/${walletUtxos.length}, lovelace_total=${sumLovelaceFromUtxos(selectableWalletUtxos)}`,
    );
  }

  private extractAcknowledgementResult(acknowledgementResponse: unknown): string | null {
    if (!acknowledgementResponse || typeof acknowledgementResponse !== 'object') {
      return null;
    }
    const result = (acknowledgementResponse as Record<string, unknown>).result;
    if (typeof result !== 'string' || result.length === 0) {
      return null;
    }
    return result;
  }

  private extractAcknowledgementError(acknowledgementResponse: unknown): string | null {
    if (!acknowledgementResponse || typeof acknowledgementResponse !== 'object') {
      return null;
    }
    const parsed = acknowledgementResponse as Record<string, unknown>;
    const err = parsed.err;
    if (typeof err === 'string' && err.length > 0) {
      return err;
    }
    const error = parsed.error;
    if (typeof error === 'string' && error.length > 0) {
      return error;
    }
    return null;
  }

  /**
   * Build the HostState STT update required for any packet-related channel update.
   *
   * Every packet operation mutates some part of ChannelDatum (sequence counters and/or
   * packet maps). The HostState commitment root must be updated in the same transaction,
   * and the HostState redeemer must carry sibling hashes proving the root transition.
   */
  private async buildHostStateUpdateForHandlePacket(
    inputChannelDatum: ChannelDatum,
    outputChannelDatum: ChannelDatum,
    channelIdForRoot: string,
  ): Promise<{
    hostStateUtxo: UTxO;
    encodedHostStateRedeemer: string;
    encodedUpdatedHostStateDatum: string;
    newRoot: string;
    commit: () => void;
  }> {
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }

    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );

    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root);

    const portId = convertHex2String(inputChannelDatum.port);

    const {
      newRoot,
      channelSiblings,
      nextSequenceSendSiblings,
      nextSequenceRecvSiblings,
      nextSequenceAckSiblings,
      packetCommitmentSiblings,
      packetReceiptSiblings,
      packetAcknowledgementSiblings,
      commit,
    } = await computeRootWithHandlePacketUpdate(
      hostStateDatum.state.ibc_state_root,
      portId,
      channelIdForRoot,
      inputChannelDatum,
      outputChannelDatum,
      this.lucidService.LucidImporter,
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

    const hostStateRedeemer = {
      HandlePacket: {
        channel_siblings: channelSiblings,
        next_sequence_send_siblings: nextSequenceSendSiblings,
        next_sequence_recv_siblings: nextSequenceRecvSiblings,
        next_sequence_ack_siblings: nextSequenceAckSiblings,
        packet_commitment_siblings: packetCommitmentSiblings,
        packet_receipt_siblings: packetReceiptSiblings,
        packet_acknowledgement_siblings: packetAcknowledgementSiblings,
      },
    };

    const encodedHostStateRedeemer: string = await this.lucidService.encode(hostStateRedeemer, 'host_state_redeemer');
    const encodedUpdatedHostStateDatum: string = await this.lucidService.encode(updatedHostStateDatum, 'host_state');

    return {
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      newRoot,
      commit,
    };
  }

  async recvPacket(data: MsgRecvPacket): Promise<MsgRecvPacketResponse> {
    try {
      this.logger.log('RecvPacket data: ', data);
      const { constructedAddress, recvPacketOperator } = validateAndFormatRecvPacketParams(data);
      // Build and complete the unsigned transaction
      const { unsignedTx: unsignedRecvPacketTx, pendingTreeUpdate } = await this.buildUnsignedRecvPacketTx(
        recvPacketOperator,
        constructedAddress,
      );

      const nowMs = Date.now();
      let validToTime = nowMs + TRANSACTION_TIME_TO_LIVE;
      if (recvPacketOperator.timeoutTimestamp > 0n) {
        // On-chain requires tx_valid_to * 1_000_000 < packet.timeout_timestamp.
        // Clamp validTo under packet timeout so recv stays valid even near deadline.
        const maxValidToMs = recvPacketOperator.timeoutTimestamp / 10n ** 6n - 1n;
        if (maxValidToMs <= BigInt(nowMs)) {
          throw new GrpcInternalException('recv packet failed: packet timeout too close or already expired');
        }
        if (BigInt(validToTime) > maxValidToMs) {
          validToTime = Number(maxValidToMs);
        }
      }
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('recv packet failed: tx time invalid');
      }

      if (
        recvPacketOperator.timeoutTimestamp > 0 &&
        BigInt(validToTime) * 10n ** 6n >= recvPacketOperator.timeoutTimestamp
      ) {
        throw new GrpcInternalException('recv packet failed: tx_valid_to * 1_000_000 >= packet.timeout_timestamp');
      }
      const unsignedRecvPacketTxValidTo: TxBuilder = unsignedRecvPacketTx.validTo(validToTime);

      await this.refreshWalletContext(constructedAddress, 'recvPacket');
      
      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedRecvPacketTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);

      this.logger.log('Returning unsigned tx for recv packet');
      const response: MsgTransferResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
        },
      };
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

      const { unsignedTx: unsignedSendPacketTx, pendingTreeUpdate, walletOverride } =
        await this.buildUnsignedSendPacketTx(sendPacketOperator);
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const validToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      const currentSlot = this.lucidService.lucid.currentSlot();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('channel init failed: tx time invalid');
      }

      const unsignedSendPacketTxValidTo: TxBuilder = unsignedSendPacketTx.validTo(validToTime);

      if (walletOverride) {
        // Ensure the sender's UTxOs are used right before completion to avoid wallet drift
        // between build and complete (e.g., concurrent tx builds with different wallets).
        const refreshedUtxos = await this.lucidService.tryFindUtxosAt(walletOverride.address, {
          maxAttempts: 6,
          retryDelayMs: 1000,
        });
        const mergedUtxos = this.dedupeUtxos([...(walletOverride.utxos ?? []), ...refreshedUtxos]);
        const utxosToUse = mergedUtxos.length > 0 ? mergedUtxos : walletOverride.utxos;
        this.lucidService.selectWalletFromAddress(walletOverride.address, utxosToUse);
        this.logger.log(
          `[walletOverride] sendPacket selecting wallet from ${walletOverride.address}, utxos=${utxosToUse.length}, refreshed=${refreshedUtxos.length}, lovelace_total=${sumLovelaceFromUtxos(
            utxosToUse,
          )}`,
        );
      }

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedSendPacketTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);

      this.logger.log('Returning unsigned tx for send packet');
      const response: MsgTransferResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
        },
      };
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
      const { unsignedTx: unsignedSendPacketTx, pendingTreeUpdate } = await this.buildUnsignedTimeoutPacketTx(
        timeoutPacketOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedSendPacketTxValidTo: TxBuilder = unsignedSendPacketTx.validTo(validToTime);

      await this.refreshWalletContext(constructedAddress, 'timeoutPacket');

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedSendPacketTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);

      this.logger.log('Returning unsigned tx for timeout packet');
      const response: MsgTimeoutResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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

      await this.refreshWalletContext(constructedAddress, 'timeoutRefresh');

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedTimeoutRefreshTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));

      this.logger.log('Returning unsigned tx for timeout refresh');
      const response: MsgTimeoutRefreshResponse = {
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
      const { unsignedTx: unsignedAckPacketTx, pendingTreeUpdate } = await this.buildUnsignedAcknowlegementPacketTx(
        ackPacketOperator,
        constructedAddress,
      );
      const validToTime = Date.now() + TRANSACTION_TIME_TO_LIVE;
      const unsignedAckPacketTxValidTo: TxBuilder = unsignedAckPacketTx.validTo(validToTime);

      // Return unsigned transaction for Hermes to sign
      const completedUnsignedTx = await unsignedAckPacketTxValidTo.complete({
        localUPLCEval: false,
        setCollateral: TRANSACTION_SET_COLLATERAL,
      });
      const unsignedTxCbor = completedUnsignedTx.toCBOR();
      const cborHexBytes = new Uint8Array(Buffer.from(unsignedTxCbor, 'utf-8'));
      const unsignedTxHash = completedUnsignedTx.toHash();

      this.ibcTreePendingUpdatesService.register(unsignedTxHash, pendingTreeUpdate);

      this.logger.log('Returning unsigned tx for ack packet');
      const response: MsgAcknowledgementResponse = {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
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
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
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

    if (!isValidProofHeight(heightsArray, recvPacketOperator.proofHeight)) {
      throw new GrpcInternalException(
        `Invalid proof height: ${recvPacketOperator.proofHeight.revisionNumber}/${recvPacketOperator.proofHeight.revisionHeight}`,
      );
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
    const isOrderedChannel = ORDER_MAPPING_CHANNEL[channelDatum.state.channel.ordering] === ChannelOrder.ORDER_ORDERED;
    const nextSequenceRecv = isOrderedChannel
      ? channelDatum.state.next_sequence_recv + 1n
      : channelDatum.state.next_sequence_recv;
    const packetReceipt = isOrderedChannel
      ? channelDatum.state.packet_receipt
      : prependToMap(channelDatum.state.packet_receipt, packet.sequence, '');

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
    const consensusEntry = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) =>
        key.revisionNumber === recvPacketOperator.proofHeight.revisionNumber &&
        key.revisionHeight === recvPacketOperator.proofHeight.revisionHeight,
    );
    if (!consensusEntry) {
      throw new GrpcInternalException(
        `Missing consensus state at proof height ${recvPacketOperator.proofHeight.revisionNumber}/${recvPacketOperator.proofHeight.revisionHeight}`,
      );
    }
    const consensusState = consensusEntry[1];
    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: recvPacketOperator.proofHeight,
        delay_time_period: connectionDatum.state.delay_period,
        delay_block_period: getBlockDelay(connectionDatum.state.delay_period),
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

    if (stringData.startsWith('{') && stringData.endsWith('}')) {
      let jsonData: unknown;
      try {
        jsonData = JSON.parse(stringData);
      } catch (error) {
        this.logger.error('Error in parsing JSON packet data: ' + stringData, error);
        throw new GrpcInvalidArgumentException(`Invalid JSON packet data: ${error?.message ?? error}`);
      }

      if (typeof jsonData === 'object' && jsonData !== null && 'denom' in jsonData && jsonData.denom !== undefined) {
          // Packet data seems to be ICS-20 related. Build transfer module redeemer.
          const fungibleTokenPacketData: FungibleTokenPacketDatum = jsonData as FungibleTokenPacketDatum;
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

          const packetSourcePort = convertHex2String(packet.source_port);
          const packetSourceChannel = convertHex2String(packet.source_channel);

          if (this._hasVoucherPrefix(fungibleTokenPacketData.denom, packetSourcePort, packetSourceChannel)) {
            // Handle recv packet unescrow
            const updatedChannelDatum: ChannelDatum = {
              ...channelDatum,
              state: {
                ...channelDatum.state,
                next_sequence_recv: nextSequenceRecv,
                packet_receipt: packetReceipt,
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

            const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
              await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, recvPacketOperator.channelId);
            const unescrowDenom = this._unwrapVoucherDenom(
              fungibleTokenPacketData.denom,
              packetSourcePort,
              packetSourceChannel,
            );
            const transferAmount = BigInt(fungibleTokenPacketData.amount);
            const denomToken = this._resolveAssetUnitFromUtxoAssets(
              transferModuleUtxo.assets,
              mapLovelaceDenom(unescrowDenom, 'packet_to_asset'),
            );
            const escrowedAmount = transferModuleUtxo.assets[denomToken] ?? 0n;
            if (escrowedAmount < transferAmount) {
              throw new GrpcInvalidArgumentException(
                `Insufficient escrowed amount for ${denomToken}: have ${escrowedAmount}, need ${transferAmount}`,
              );
            }

            const unsignedRecvPacketUnescrowParams: UnsignedRecvPacketUnescrowDto = {
              hostStateUtxo,
              channelUtxo,
              connectionUtxo,
              clientUtxo,
              transferModuleUtxo,

              encodedHostStateRedeemer,
              encodedUpdatedHostStateDatum,
              encodedSpendChannelRedeemer,
              encodedSpendTransferModuleRedeemer,
              channelTokenUnit,
              encodedUpdatedChannelDatum,
              transferAmount,
              denomToken,
              receiverAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.receiver),
              constructedAddress,

              recvPacketPolicyId,
              channelToken,

              verifyProofPolicyId,
              encodedVerifyProofRedeemer,
            };
            const unsignedTx = this.lucidService.createUnsignedRecvPacketUnescrowTx(unsignedRecvPacketUnescrowParams);
            return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
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

            // MintVoucher validator computes token name from destination port/channel + packet denom
            // Use the same prefix here so voucher hash stays consistent even when channel ids differ by side
            const destPrefix = getDenomPrefix(
              convertHex2String(packet.destination_port),
              convertHex2String(packet.destination_channel),
            );

            const prefixedDenom = convertString2Hex(destPrefix + fungibleTokenPacketData.denom);
            const voucherTokenName = hashSha3_256(prefixedDenom);
            const voucherTokenUnit =
              this.configService.get('deployment').validators.mintVoucher.scriptHash + voucherTokenName;
            
            // Track denom trace mapping (required for later ibc/<hash> burn resolution).
            const fullDenomPath = destPrefix + fungibleTokenPacketData.denom;
            const trace = this._splitDenomTraceForPersistence(fullDenomPath, 'recv_mint');

            await this.denomTraceService.saveDenomTrace({
              hash: voucherTokenName,
              path: trace.path,
              base_denom: trace.baseDenom,
              voucher_policy_id: this.configService.get('deployment').validators.mintVoucher.scriptHash,
              tx_hash: null, // Filled after confirmed submission.
            });

            const updatedChannelDatum: ChannelDatum = {
              ...channelDatum,
              state: {
                ...channelDatum.state,
                next_sequence_recv: nextSequenceRecv,
                packet_receipt: packetReceipt,
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

            const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
              await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, recvPacketOperator.channelId);

            const receiverAddress = this._resolveVoucherReceiverAddress(fungibleTokenPacketData.receiver);
            const unsignedRecvPacketMintParams: UnsignedRecvPacketMintDto = {
              hostStateUtxo,
              channelUtxo,
              connectionUtxo,
              clientUtxo,
              transferModuleUtxo,

              encodedHostStateRedeemer,
              encodedUpdatedHostStateDatum,
              encodedSpendChannelRedeemer,
              encodedSpendTransferModuleRedeemer,
              encodedMintVoucherRedeemer,
              encodedUpdatedChannelDatum,

              channelTokenUnit,
              voucherTokenUnit,
              transferAmount: BigInt(fungibleTokenPacketData.amount),
              receiverAddress,
              constructedAddress,

              recvPacketPolicyId,
              channelToken,

              verifyProofPolicyId,
              encodedVerifyProofRedeemer,
            };

            const unsignedTx = this.lucidService.createUnsignedRecvPacketMintTx(unsignedRecvPacketMintParams);
            return {
              unsignedTx,
              pendingTreeUpdate: {
                expectedNewRoot: newRoot,
                commit,
                denomTraceHashes: [voucherTokenName],
              },
            };
          }
      }
    }
    // Packet data is not related to an ICS-20 token transfer
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        next_sequence_recv: nextSequenceRecv,
        packet_receipt: packetReceipt,
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

    const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
      await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, recvPacketOperator.channelId);

    const unsignedRecvPacketMintParams: UnsignedRecvPacketDto = {
      hostStateUtxo,
      channelUtxo,
      connectionUtxo,
      clientUtxo,

      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
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
    const unsignedTx = this.lucidService.createUnsignedRecvPacketTx(unsignedRecvPacketMintParams);
    return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
  }
  async buildUnsignedTimeoutPacketTx(
    timeoutPacketOperator: TimeoutPacketOperator,
    constructedAddress: string,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
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
    if (!isValidProofHeight(heightsArray, timeoutPacketOperator.proofHeight)) {
      throw new GrpcInternalException(
        `Invalid proof height: ${timeoutPacketOperator.proofHeight.revisionNumber}/${timeoutPacketOperator.proofHeight.revisionHeight}`,
      );
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
    const denom = mapLovelaceDenom(timeoutPacketOperator.fungibleTokenPacketData.denom, 'packet_to_asset');
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

    const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
      await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, convertHex2String(packet.source_channel));
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

    const consensusEntry = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) =>
        key.revisionNumber === timeoutPacketOperator.proofHeight.revisionNumber &&
        key.revisionHeight === timeoutPacketOperator.proofHeight.revisionHeight,
    );
    if (!consensusEntry) {
      throw new GrpcInternalException(
        `Missing consensus state at proof height ${timeoutPacketOperator.proofHeight.revisionNumber}/${timeoutPacketOperator.proofHeight.revisionHeight}`,
      );
    }
    const consensusState = consensusEntry[1];
    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyNonMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: timeoutPacketOperator.proofHeight,
        delay_time_period: connectionDatum.state.delay_period,
        delay_block_period: getBlockDelay(connectionDatum.state.delay_period),
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
        hostStateUtxo: hostStateUtxo,
        channelUtxo: channelUtxo,
        transferModuleUtxo: transferModuleUtxo,
        connectionUtxo: connectionUtxo,
        clientUtxo: clientUtxo,

        encodedHostStateRedeemer: encodedHostStateRedeemer,
        encodedUpdatedHostStateDatum: encodedUpdatedHostStateDatum,
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
      const unsignedTx = this.lucidService.createUnsignedTimeoutPacketUnescrowTx(unsignedSendPacketParams);
      return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
    }
    this.logger.log(timeoutPacketOperator.fungibleTokenPacketData.denom, 'mint timeout processing');
    const prefixedDenom = convertString2Hex(denom);
    const mintVoucherRedeemer: MintVoucherRedeemer = {
      RefundVoucher: {
        packet_source_port: packet.source_port,
        packet_source_channel: packet.source_channel,
      },
    };
    const voucherTokenName = hashSha3_256(prefixedDenom);
    const voucherTokenUnit = this.getMintVoucherScriptHash() + voucherTokenName;

    // Track denom trace mapping for timeout refund voucher.
    const fullDenomPath = convertHex2String(prefixedDenom);
    const trace = this._splitDenomTraceForPersistence(fullDenomPath, 'timeout_refund');

    await this.denomTraceService.saveDenomTrace({
      hash: voucherTokenName,
      path: trace.path,
      base_denom: trace.baseDenom,
      voucher_policy_id: this.getMintVoucherScriptHash(),
      tx_hash: null, // Filled after confirmed submission.
    });

    const encodedMintVoucherRedeemer: string = await this.lucidService.encode(
      mintVoucherRedeemer,
      'mintVoucherRedeemer',
    );
    const unsignedTimeoutPacketMintDto: UnsignedTimeoutPacketMintDto = {
      hostStateUtxo: hostStateUtxo,
      channelUtxo: channelUtxo,
      transferModuleUtxo: transferModuleUtxo,
      connectionUtxo: connectionUtxo,
      clientUtxo: clientUtxo,

      encodedHostStateRedeemer: encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum: encodedUpdatedHostStateDatum,
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
    const unsignedTx = this.lucidService.createUnsignedTimeoutPacketMintTx(unsignedTimeoutPacketMintDto);
    return {
      unsignedTx,
      pendingTreeUpdate: {
        expectedNewRoot: newRoot,
        commit,
        denomTraceHashes: [voucherTokenName],
      },
    };
  }

  async buildUnsignedSendPacketTx(
    sendPacketOperator: SendPacketOperator,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate; walletOverride?: { address: string; utxos: UTxO[] } }> {
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

    // Normalize the incoming denom once and carry that canonical representation through the
    // entire send path. This keeps the packet denom, branch decision, and voucher token-name
    // hashing aligned even when callers pass different user-facing formats.
    //
    // In practice this means:
    // - `ibc/<hash>` is resolved to its full trace before any branching
    // - voucher detection uses the resolved trace, not the raw input
    // - packet data and transfer redeemer use the same final denom string
    const inputDenom = normalizeDenomTokenTransfer(sendPacketOperator.token.denom);
    const resolvedDenom = await this._resolvePacketDenomForSend(inputDenom);
    const packetDenom = this._normalizePacketDenom(
      resolvedDenom,
      sendPacketOperator.sourcePort,
      sendPacketOperator.sourceChannel,
    );
    const isVoucher = this._hasVoucherPrefix(
      resolvedDenom,
      sendPacketOperator.sourcePort,
      sendPacketOperator.sourceChannel,
    );
    // fungible token packet data
    const fTokenPacketData: FungibleTokenPacketDatum = {
      denom: packetDenom,
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
          denom: convertString2Hex(packetDenom),
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

    const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
      await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, sendPacketOperator.sourceChannel);
    const deploymentConfig = this.configService.get('deployment');

    const sendPacketPolicyId = deploymentConfig.validators.spendChannel.refValidator.send_packet.scriptHash;
    const channelToken = {
      policyId: mintChannelPolicyId,
      name: channelTokenName,
    };

    if (isVoucher) {
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

      const voucherTokenName = this._buildVoucherTokenName(resolvedDenom);
      const voucherTokenUnit = deploymentConfig.validators.mintVoucher.scriptHash + voucherTokenName;
      const senderAddress = sendPacketOperator.sender;

      const senderVoucherTokenUtxo = await this.lucidService.findUtxoAtWithUnit(senderAddress, voucherTokenUnit);
      const senderWalletUtxos = await this.lucidService.tryFindUtxosAt(senderAddress, {
        maxAttempts: 6,
        retryDelayMs: 1000,
      });
      // Keep the explicit voucher UTxO in the wallet set.
      // Indexers can lag right after recent transactions, so this guarantees coin selection
      // can still see the token we intend to burn in this transaction.
      const walletUtxos = this.dedupeUtxos([...senderWalletUtxos, senderVoucherTokenUtxo]);

      // send burn
      const unsignedSendPacketParams: UnsignedSendPacketBurnDto = {
        hostStateUtxo,
        channelUTxO: channelUtxo,
        connectionUTxO: connectionUtxo,
        clientUTxO: clientUtxo,
        transferModuleUTxO: transferModuleUtxo,
        senderVoucherTokenUtxo,
        walletUtxos,

        encodedHostStateRedeemer,
        encodedUpdatedHostStateDatum,
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
        denomToken: inputDenom,

        sendPacketPolicyId,
        channelToken,
      };

      const unsignedTx = this.lucidService.createUnsignedSendPacketBurnTx(unsignedSendPacketParams);
      return {
        unsignedTx,
        pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
        walletOverride: {
          address: senderAddress,
          utxos: walletUtxos,
        },
      };
    }
    // escrow
    this.logger.log('send escrow');
    const senderAddress = sendPacketOperator.sender;
    const senderWalletUtxos = await this.lucidService.tryFindUtxosAt(senderAddress, {
      maxAttempts: 6,
      retryDelayMs: 1000,
    });
    if (senderWalletUtxos.length === 0) {
      throw new GrpcInternalException(`No spendable UTxOs found for sender ${senderAddress}`);
    }
    const walletUtxos = this.dedupeUtxos(senderWalletUtxos);
    const denomToken = this._resolveEscrowDenomToken(inputDenom, resolvedDenom, walletUtxos);
    const unsignedSendPacketParams: UnsignedSendPacketEscrowDto = {
      hostStateUtxo,
      channelUTxO: channelUtxo,
      connectionUTxO: connectionUtxo,
      clientUTxO: clientUtxo,
      transferModuleUTxO: transferModuleUtxo,

      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      encodedSpendChannelRedeemer: encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer: encodedSpendTransferModuleRedeemer,
      encodedUpdatedChannelDatum: encodedUpdatedChannelDatum,

      transferAmount: BigInt(sendPacketOperator.token.amount),
      senderAddress,
      receiverAddress: sendPacketOperator.receiver,
      walletUtxos,

      constructedAddress: sendPacketOperator.signer,

      spendChannelAddress: deploymentConfig.validators.spendChannel.address,
      channelTokenUnit: channelTokenUnit,
      transferModuleAddress: deploymentConfig.modules.transfer.address,
      denomToken,

      sendPacketPolicyId,
      channelToken,
    };

    const unsignedTx = this.lucidService.createUnsignedSendPacketEscrowTx(unsignedSendPacketParams);
    return {
      unsignedTx,
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
      walletOverride: {
        address: senderAddress,
        utxos: walletUtxos,
      },
    };
  }

  async buildUnsignedAcknowlegementPacketTx(
    ackPacketOperator: AckPacketOperator,
    constructedAddress: string,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
    await this.refreshWalletContext(constructedAddress, 'acknowledgementPacket');

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

    if (!isValidProofHeight(heightsArray, ackPacketOperator.proofHeight)) {
      throw new GrpcInternalException(
        `Invalid proof height: ${ackPacketOperator.proofHeight.revisionNumber}/${ackPacketOperator.proofHeight.revisionHeight}`,
      );
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

    // build transfer module redeemer
    const fTokenPacketData: FungibleTokenPacketDatum = {
      denom: convertString2Hex(fungibleTokenPacketData.denom),
      amount: convertString2Hex(fungibleTokenPacketData.amount),
      sender: convertString2Hex(fungibleTokenPacketData.sender),
      receiver: convertString2Hex(fungibleTokenPacketData.receiver),
      memo: convertString2Hex(fungibleTokenPacketData.memo),
    };

    const acknowledgementResponse: unknown = JSON.parse(convertHex2String(ackPacketOperator.acknowledgement));
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
    const consensusEntry = [...clientDatum.state.consensusStates.entries()].find(
      ([key]) =>
        key.revisionNumber === ackPacketOperator.proofHeight.revisionNumber &&
        key.revisionHeight === ackPacketOperator.proofHeight.revisionHeight,
    );
    if (!consensusEntry) {
      throw new GrpcInternalException(
        `Missing consensus state at proof height ${ackPacketOperator.proofHeight.revisionNumber}/${ackPacketOperator.proofHeight.revisionHeight}`,
      );
    }
    const consensusState = consensusEntry[1];
    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: ackPacketOperator.proofHeight,
        delay_time_period: connectionDatum.state.delay_period,
        delay_block_period: getBlockDelay(connectionDatum.state.delay_period),
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
    const acknowledgementResult = this.extractAcknowledgementResult(acknowledgementResponse);
    if (acknowledgementResult) {
      // build update channel datum
      const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
        createIBCModuleRedeemer(channelId, fTokenPacketData, {
          AcknowledgementResult: {
            result: convertString2Hex(acknowledgementResult),
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
      const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
        await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, ackPacketOperator.channelId);
      const unsignedAckPacketSucceedParams: UnsignedAckPacketSucceedDto = {
        hostStateUtxo,
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        transferModuleUtxo,
        encodedHostStateRedeemer,
        encodedUpdatedHostStateDatum,
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
      const unsignedTx = this.lucidService.createUnsignedAckPacketSucceedTx(unsignedAckPacketSucceedParams);
      return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
    }

    const acknowledgementError = this.extractAcknowledgementError(acknowledgementResponse);
    if (!acknowledgementError) {
      const acknowledgementResponseKeys =
        acknowledgementResponse && typeof acknowledgementResponse === 'object'
          ? Object.keys(acknowledgementResponse as Record<string, unknown>).join(',')
          : '';
      throw new GrpcInternalException(
        `Acknowledgement Response invalid: unknown result (keys=${acknowledgementResponseKeys})`,
      );
    }
    const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
      createIBCModuleRedeemer(channelId, fTokenPacketData, {
        AcknowledgementError: {
          err: convertString2Hex(acknowledgementError),
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
      const denomToken = mapLovelaceDenom(fungibleTokenPacketData.denom, 'packet_to_asset');
      await this.refreshWalletContext(
        constructedAddress,
        'acknowledgementPacket(unescrow)',
        denomToken === LOVELACE
          ? undefined
          : {
              excludeAssetUnit: denomToken,
            },
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
      const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
        await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, ackPacketOperator.channelId);
      const unsignedAckPacketUnescrowParams: UnsignedAckPacketUnescrowDto = {
        hostStateUtxo,
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        transferModuleUtxo,

        encodedHostStateRedeemer,
        encodedUpdatedHostStateDatum,
        encodedSpendChannelRedeemer,
        encodedSpendTransferModuleRedeemer,
        channelTokenUnit,
        encodedUpdatedChannelDatum,
        transferAmount: BigInt(fungibleTokenPacketData.amount),
        senderAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.sender),

        denomToken,
        constructedAddress,

        ackPacketPolicyId,
        channelToken,

        verifyProofPolicyId,
        encodedVerifyProofRedeemer,
      };
      const unsignedTx = this.lucidService.createUnsignedAckPacketUnescrowTx(unsignedAckPacketUnescrowParams);
      return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
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

    // RefundVoucher token name must hash exactly the denom carried by packet data.
    // We do not prepend an extra source prefix here because packet data already carries
    // the canonical trace string for this refund path.
    const denomToHash = fungibleTokenPacketData.denom;
    const voucherTokenName = this._buildVoucherTokenName(denomToHash);
    const voucherTokenUnit = this.configService.get('deployment').validators.mintVoucher.scriptHash + voucherTokenName;

    // Track denom trace mapping for acknowledgement refund voucher.
    const fullDenomPath = denomToHash;
    const trace = this._splitDenomTraceForPersistence(fullDenomPath, 'ack_refund');

    await this.denomTraceService.saveDenomTrace({
      hash: voucherTokenName,
      path: trace.path,
      base_denom: trace.baseDenom,
      voucher_policy_id: this.configService.get('deployment').validators.mintVoucher.scriptHash,
      tx_hash: null, // Filled after confirmed submission.
    });

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
    const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
      await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, ackPacketOperator.channelId);
    const unsignedAckPacketMintParams: UnsignedAckPacketMintDto = {
      hostStateUtxo,
      channelUtxo,
      connectionUtxo,
      clientUtxo,
      transferModuleUtxo,

      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      encodedSpendChannelRedeemer,
      encodedSpendTransferModuleRedeemer,
      encodedMintVoucherRedeemer,
      encodedUpdatedChannelDatum,

      channelTokenUnit,
      voucherTokenUnit,
      transferAmount: BigInt(fungibleTokenPacketData.amount),
      senderAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.sender),

      constructedAddress,

      ackPacketPolicyId,
      channelToken,

      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
    };

    // handle recv packet mint
    const unsignedTx = this.lucidService.createUnsignedAckPacketMintTx(unsignedAckPacketMintParams);
    return {
      unsignedTx,
      pendingTreeUpdate: {
        expectedNewRoot: newRoot,
        commit,
        denomTraceHashes: [voucherTokenName],
      },
    };
  }
  private _hasVoucherPrefix(denom: string, portId: string, channelId: string): boolean {
    const voucherPrefix = getDenomPrefix(portId, channelId);
    return denom.startsWith(voucherPrefix);
  }
  private _unwrapVoucherDenom(denom: string, portId: string, channelId: string): string {
    const voucherPrefix = getDenomPrefix(portId, channelId);
    if (!denom.startsWith(voucherPrefix)) {
      return denom;
    }

    const baseDenom = denom.slice(voucherPrefix.length);
    if (!baseDenom) {
      throw new GrpcInvalidArgumentException('Voucher denom is missing base denom after transfer/channel prefix');
    }
    return baseDenom;
  }
  /**
   * Convert a full denom trace string into `(path, baseDenom)` for persistence.
   *
   * We intentionally use a dedicated parser instead of `split('/') + last-segment`.
   * Base denoms can contain `/` on Cosmos chains, so last-segment parsing silently corrupts
   * stored trace rows and breaks semantic round-tripping for denom queries and reverse lookup.
   */
  private _splitDenomTraceForPersistence(
    fullDenomPath: string,
    context: 'recv_mint' | 'timeout_refund' | 'ack_refund',
  ): { path: string; baseDenom: string } {
    try {
      return splitFullDenomTrace(fullDenomPath);
    } catch (error) {
      throw new GrpcInvalidArgumentException(
        `Invalid denom trace for ${context}: ${fullDenomPath}. ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  private _resolveAssetUnitFromUtxoAssets(assets: Record<string, bigint>, requestedDenomToken: string): string {
    const normalized = requestedDenomToken.trim();
    if (!normalized) {
      throw new GrpcInvalidArgumentException('Denom token for transfer-module update cannot be empty');
    }

    const matchedUnit = this._tryResolveAssetUnitFromAssets(assets, normalized);
    if (matchedUnit !== null) {
      return matchedUnit;
    }

    throw new GrpcInvalidArgumentException(
      `Denom token ${normalized} not found in transfer-module UTxO assets`,
    );
  }
  private _tryResolveAssetUnitFromAssets(assets: Record<string, bigint>, requestedDenomToken: string): string | null {
    const normalized = requestedDenomToken.trim();
    if (!normalized) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(assets, normalized)) {
      return normalized;
    }

    const normalizedLower = normalized.toLowerCase();
    const matchedUnit = Object.keys(assets).find((unit) => unit.toLowerCase() === normalizedLower);
    return matchedUnit ?? null;
  }
  private _sumAssetsFromUtxos(utxos: UTxO[]): Record<string, bigint> {
    const summedAssets: Record<string, bigint> = {};
    for (const utxo of utxos) {
      for (const [assetUnit, amount] of Object.entries(utxo.assets)) {
        summedAssets[assetUnit] = (summedAssets[assetUnit] ?? 0n) + amount;
      }
    }
    return summedAssets;
  }
  /**
   * Resolve the ledger asset unit to use for escrow spends from sender wallet assets.
   *
   * We check both input and resolved forms because callers may submit either a direct
   * Cardano asset unit or a denomination that was normalized earlier in the send flow.
   * This keeps lookup strict while still accepting the valid external input forms.
   */
  private _resolveEscrowDenomToken(inputDenom: string, resolvedDenom: string, senderWalletUtxos: UTxO[]): string {
    const senderAssets = this._sumAssetsFromUtxos(senderWalletUtxos);

    const directInputMatch = this._tryResolveAssetUnitFromAssets(senderAssets, inputDenom);
    if (directInputMatch !== null) {
      return directInputMatch;
    }

    const directResolvedMatch = this._tryResolveAssetUnitFromAssets(senderAssets, resolvedDenom);
    if (directResolvedMatch !== null) {
      return directResolvedMatch;
    }

    throw new GrpcInvalidArgumentException(
      `Escrow asset unit not found in sender wallet UTxOs for denom ${inputDenom} (resolved as ${resolvedDenom})`,
    );
  }
  /**
   * Convert a local denom representation into packet-denom representation.
   *
   * Rules:
   * - lovelace is mapped to its packet wire representation
   * - voucher traces already prefixed for this hop are preserved
   * - cardano token units are preserved
   * - plain denoms are hex-encoded for packet data
   *
   * Guardrails:
   * - `ibc/<hash>` must already be resolved before this stage
   * - pre-hex input is rejected to avoid double encoding
   */
  private _normalizePacketDenom(denom: string, portId: string, channelId: string): string {
    const normalizedDenom = normalizeDenomTokenTransfer(denom).trim();
    const packetMappedDenom = mapLovelaceDenom(normalizedDenom, 'asset_to_packet');
    if (packetMappedDenom !== normalizedDenom) {
      return packetMappedDenom;
    }

    if (this._hasVoucherPrefix(normalizedDenom, portId, channelId)) {
      return normalizedDenom;
    }
    if (normalizedDenom.startsWith('ibc/')) {
      throw new GrpcInvalidArgumentException(
        `IBC hash denom ${normalizedDenom} must be reverse-resolved to a full denom trace before packet normalization`,
      );
    }
    if (this._isCardanoTokenUnitDenom(normalizedDenom)) {
      return normalizedDenom;
    }
    if (this._isHexDenom(normalizedDenom)) {
      // Others may wish to disable this at their own discretion but I consider this an extremely valuable fail-safe. Practically speaking this should never happen.
      throw new GrpcInvalidArgumentException('Denom appears to be already hex-encoded; refusing to hex-encode twice');
    }
    return convertString2Hex(normalizedDenom);
  }
  private _isCardanoTokenUnitDenom(denom: string): boolean {
    // Cardano token unit = 28-byte policy id (56 hex chars) + optional asset name (0..32 bytes => 0..64 hex chars).
    return /^[0-9a-fA-F]{56}(?:[0-9a-fA-F]{0,64})$/.test(denom);
  }
  private _isHexDenom(denom: string): boolean {
    return denom.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(denom);
  }
  private _buildVoucherTokenName(denom: string): string {
    if (denom.startsWith('ibc/')) {
      throw new GrpcInvalidArgumentException(
        `IBC hash denom ${denom} must be reverse-resolved before voucher token-name hashing`,
      );
    }
    // Others may wish to disable this at their own discretion but I consider this an extremely valuable fail-safe. Practically speaking this should never happen.
    if (this._isHexDenom(denom)) {
      throw new GrpcInvalidArgumentException(
        'Voucher denom appears to be already hex-encoded; refusing to hash a double-encoded denom',
      );
    }
    return hashSha3_256(convertString2Hex(denom));
  }
  /**
   * Resolve `ibc/<hash>` into a full denom trace before voucher burn hashing.
   *
   * Burn token names are computed from the full trace string, not the short hash form.
   * If mapping is missing we fail explicitly because a fallback would risk burning or
   * routing the wrong asset.
   */
  private async _resolveVoucherDenomForBurn(denom: string): Promise<string> {
    if (!denom.startsWith('ibc/')) {
      return denom;
    }
    const denomHash = denom.slice(4).toLowerCase();
    const match = await this.denomTraceService.findByIbcDenomHash(denomHash);
    if (!match) {
      throw new GrpcInvalidArgumentException(`IBC denom ${denom} not found in denom traces; cannot derive voucher token name`);
    }
    return match.path ? `${match.path}/${match.base_denom}` : match.base_denom;
  }
  /**
   * Resolve the send denom into the canonical representation used by packet construction.
   * This currently delegates to voucher reverse lookup for `ibc/<hash>` inputs.
   */
  private async _resolvePacketDenomForSend(denom: string): Promise<string> {
    return this._resolveVoucherDenomForBurn(denom);
  }
  private getTransferModuleAddress(): string {
    return this.configService.get('deployment').modules.transfer.address;
  }
  private getMintVoucherScriptHash(): string {
    return this.configService.get('deployment').validators.mintVoucher.scriptHash;
  }

  private _resolveVoucherReceiverAddress(receiver: string): string {
    const trimmed = receiver.trim();
    if (trimmed.startsWith('addr') || trimmed.startsWith('addr_test')) {
      const credential = this.lucidService.getPaymentCredential(trimmed);
      if (!credential || credential.type !== 'Key') {
        // We only support key-payment credentials for voucher receivers.
        //
        // Rationale:
        // - Vouchers minted to a key address are spendable with a normal wallet signature.
        // - Hermes/Lucid can handle those UTxOs with standard coin-selection and signing.
        //
        // Script payment credentials are different:
        // - Spending requires the validator script, datum, redeemer, and collateral selection.
        // - Hermes/Lucid do not build those script-spend transactions in this flow.
        // - So a voucher minted to a script address would be effectively stuck.
        //
        // If we want script receivers there would be a more complex coin selection logic, which for now will remain a TO-DO.
        throw new GrpcInvalidArgumentException('Voucher receiver must be a key address (no script/ref-script UTxO)');
      }
      return trimmed;
    }
    // Mint vouchers directly to the key address derived from the payment credential (avoids coin-selection overrides).
    return this.lucidService.credentialToAddress(trimmed);
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
