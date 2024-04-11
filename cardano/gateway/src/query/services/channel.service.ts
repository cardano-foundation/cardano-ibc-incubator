import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import {
  QueryChannelRequest,
  QueryChannelResponse,
  QueryChannelsRequest,
  QueryChannelsResponse,
  QueryConnectionChannelsRequest,
  QueryConnectionChannelsResponse,
  QueryPacketAcknowledgementRequest,
  QueryPacketAcknowledgementResponse,
  QueryPacketAcknowledgementsRequest,
  QueryPacketAcknowledgementsResponse,
  QueryPacketCommitmentRequest,
  QueryPacketCommitmentResponse,
  QueryPacketCommitmentsRequest,
  QueryPacketCommitmentsResponse,
} from '@plus/proto-types/build/ibc/core/channel/v1/query';
import { decodePaginationKey, generatePaginationKey, getPaginationParams } from '../../shared/helpers/pagination';
import { AuthToken } from '../../shared/types/auth-token';
import { CHANNEL_TOKEN_PREFIX } from '../../constant';
import { DbSyncService } from './db-sync.service';
import { ChannelDatum, decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import {
  Channel,
  IdentifiedChannel,
  Order,
  State,
  orderFromJSON,
  stateFromJSON,
} from '@plus/proto-types/build/ibc/core/channel/v1/channel';
import { PaginationKeyDto } from '../dtos/pagination.dto';
import { getChannelIdByTokenName, getConnectionIdFromConnectionHops } from '../../shared/helpers/channel';
import { CHANNEL_ID_PREFIX, ORDER_MAPPING_CHANNEL, STATE_MAPPING_CHANNEL } from '../../constant/channel';
import { GrpcInternalException, GrpcNotFoundException } from 'nestjs-grpc-exceptions';
import { bytesFromBase64 } from '@plus/proto-types/build/helpers';
import { convertHex2String } from '../../shared/helpers/hex';
import { validQueryChannelParam, validQueryConnectionChannelsParam } from '../helpers/channel.validate';
import { validPagination } from '../helpers/helper';

@Injectable()
export class ChannelService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(DbSyncService) private dbService: DbSyncService,
  ) {}

  async queryChannels(request: QueryChannelsRequest): Promise<QueryChannelsResponse> {
    this.logger.log('', 'queryChannels');
    const pagination = getPaginationParams(validPagination(request.pagination));
    const {
      'pagination.key': key,
      'pagination.limit': limit,
      'pagination.count_total': count_total,
      'pagination.reverse': reverse,
    } = pagination;
    let { 'pagination.offset': offset } = pagination;
    if (key) offset = decodePaginationKey(key);

    const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
    const channelTokenName = this.lucidService.generateTokenName(handlerAuthToken, CHANNEL_TOKEN_PREFIX, BigInt(0));
    const utxos = await this.dbService.findUtxosByPolicyIdAndPrefixTokenName(
      minChannelScriptHash,
      channelTokenName.slice(0, 20),
    );

    const identifiedChannels = await Promise.all(
      utxos.map(async (utxo) => {
        const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(
          utxo.datum!,
          this.lucidService.LucidImporter,
        );

        const identifiedChannel = {
          /** current state of the channel end */
          state: stateFromJSON(STATE_MAPPING_CHANNEL[channelDatumDecoded.state.channel.state]),
          /** whether the channel is ordered or unordered */
          ordering: orderFromJSON(ORDER_MAPPING_CHANNEL[channelDatumDecoded.state.channel.ordering]),
          /** counterparty channel end */
          counterparty: {
            /** port on the counterparty chain which owns the other end of the channel. */
            port_id: convertHex2String(channelDatumDecoded.state.channel.counterparty.port_id),
            /** channel end on the counterparty chain */
            channel_id: convertHex2String(channelDatumDecoded.state.channel.counterparty.channel_id),
          },
          /**
           * list of connection identifiers, in order, along which packets sent on
           * this channel will travel
           */
          connection_hops: channelDatumDecoded.state.channel.connection_hops.map((connection_hop) =>
            convertHex2String(connection_hop),
          ),
          /** opaque channel version, which is agreed upon during the handshake */
          version: convertHex2String(channelDatumDecoded.state.channel.version),
          /** port identifier */
          port_id: convertHex2String(channelDatumDecoded.port),
          /** channel identifier */
          channel_id: `${CHANNEL_ID_PREFIX}-${getChannelIdByTokenName(utxo.assetsName, handlerAuthToken, CHANNEL_TOKEN_PREFIX)}`,
        };

        return identifiedChannel as unknown as IdentifiedChannel;
      }),
    );

    const channelFilters = identifiedChannels.reduce((accumulator, currentValue) => {
      const key = `${currentValue.channel_id}_${currentValue.port_id}`;
      if (!accumulator[key] || accumulator[key].state < currentValue.state) accumulator[key] = currentValue;
      return accumulator;
    }, {});

    let nextKey = null;
    let channels = reverse ? Object.values(channelFilters).reverse() : Object.values(channelFilters);
    if (channels.length > +limit) {
      const from = parseInt(offset);
      const to = parseInt(offset) + parseInt(limit);
      channels = channels.slice(from, to);

      const pageKeyDto: PaginationKeyDto = {
        offset: to,
      };

      nextKey = to < Object.values(channelFilters).length ? generatePaginationKey(pageKeyDto) : '';
    }

    const response = {
      channels: channels,
      pagination: {
        next_key: nextKey,
        total: count_total ? Object.values(channelFilters).length : 0,
      },
      height: {
        revision_number: BigInt(0), // TODO
        revision_height: BigInt(0), // TODO
      },
    } as unknown as QueryChannelsResponse;

    return response;
  }

  async queryChannel(request: QueryChannelRequest): Promise<QueryChannelResponse> {
    const { channel_id: channelId } = validQueryChannelParam(request);
    this.logger.log(channelId, 'queryChannel');
    try {
      const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
      const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;

      const channelTokenName = this.lucidService.generateTokenName(
        handlerAuthToken,
        CHANNEL_TOKEN_PREFIX,
        BigInt(channelId),
      );

      const channelTokenUnit = minChannelScriptHash + channelTokenName;
      const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
      const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
      const proof = await this.dbService.findUtxoByPolicyAndTokenNameAndState(
        minChannelScriptHash,
        channelTokenName,
        channelDatumDecoded.state.channel.state,
      );

      const response: QueryChannelResponse = {
        channel: {
          /** current state of the channel end */
          state:
            STATE_MAPPING_CHANNEL[channelDatumDecoded.state.channel.state] ?? State.STATE_UNINITIALIZED_UNSPECIFIED,
          /** whether the channel is ordered or unordered */
          ordering: ORDER_MAPPING_CHANNEL[channelDatumDecoded.state.channel.ordering] ?? Order.ORDER_NONE_UNSPECIFIED,
          /** counterparty channel end */
          counterparty: {
            /** port on the counterparty chain which owns the other end of the channel. */
            port_id: convertHex2String(channelDatumDecoded.state.channel.counterparty.port_id),
            /** channel end on the counterparty chain */
            channel_id: convertHex2String(channelDatumDecoded.state.channel.counterparty.channel_id),
          },
          /**
           * list of connection identifiers, in order, along which packets sent on
           * this channel will travel
           */
          connection_hops: channelDatumDecoded.state.channel.connection_hops.map((connection_hop) =>
            convertHex2String(connection_hop),
          ),
          /** opaque channel version, which is agreed upon during the handshake */
          version: convertHex2String(channelDatumDecoded.state.channel.version),
        } as unknown as Channel,
        proof: bytesFromBase64(btoa(`0-${proof.blockNo}/channel/${proof.txHash}/${proof.index}`)), // TODO
        proof_height: {
          revision_number: 0,
          revision_height: proof.blockNo, // TODO
        },
      } as unknown as QueryChannelResponse;
      return response;
    } catch (error) {
      this.logger.error(error.message, 'queryChannel');
      throw new GrpcInternalException(error.message);
    }
  }

  async queryConnectionChannels(request: QueryConnectionChannelsRequest): Promise<QueryConnectionChannelsResponse> {
    this.logger.log('queryConnectionChannels');
    const { connection: connectionId, pagination: paginationReq } = validQueryConnectionChannelsParam(request);
    const pagination = getPaginationParams(paginationReq);
    const {
      'pagination.key': key,
      'pagination.limit': limit,
      'pagination.count_total': count_total,
      'pagination.reverse': reverse,
    } = pagination;
    let { 'pagination.offset': offset } = pagination;
    if (key) offset = decodePaginationKey(key);

    const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
    const channelTokenName = this.lucidService.generateTokenName(handlerAuthToken, CHANNEL_TOKEN_PREFIX, BigInt(0));
    const utxos = await this.dbService.findUtxosByPolicyIdAndPrefixTokenName(
      minChannelScriptHash,
      channelTokenName.slice(0, 20),
    );

    const identifiedChannels = await Promise.all(
      utxos.map(async (utxo) => {
        const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(
          utxo.datum!,
          this.lucidService.LucidImporter,
        );

        const identifiedChannel = {
          /** current state of the channel end */
          state: stateFromJSON(STATE_MAPPING_CHANNEL[channelDatumDecoded.state.channel.state]),
          /** whether the channel is ordered or unordered */
          ordering: orderFromJSON(ORDER_MAPPING_CHANNEL[channelDatumDecoded.state.channel.ordering]),
          /** counterparty channel end */
          counterparty: {
            /** port on the counterparty chain which owns the other end of the channel. */
            port_id: convertHex2String(channelDatumDecoded.state.channel.counterparty.port_id),
            /** channel end on the counterparty chain */
            channel_id: convertHex2String(channelDatumDecoded.state.channel.counterparty.channel_id),
          },
          /**
           * list of connection identifiers, in order, along which packets sent on
           * this channel will travel
           */
          connection_hops: channelDatumDecoded.state.channel.connection_hops.map((connection_hop) =>
            convertHex2String(connection_hop),
          ),
          /** opaque channel version, which is agreed upon during the handshake */
          version: convertHex2String(channelDatumDecoded.state.channel.version),
          /** port identifier */
          port_id: convertHex2String(channelDatumDecoded.port),
          /** channel identifier */
          channel_id: `${CHANNEL_ID_PREFIX}-${getChannelIdByTokenName(utxo.assetsName, handlerAuthToken, CHANNEL_TOKEN_PREFIX)}`,
        };

        return identifiedChannel as unknown as IdentifiedChannel;
      }),
    );

    const channelFilters = identifiedChannels
      .filter((idChannel) => idChannel.connection_hops[0] === connectionId)
      .reduce((accumulator, currentValue) => {
        const key = `${currentValue.channel_id}_${currentValue.port_id}`;
        if (!accumulator[key] || accumulator[key].state < currentValue.state) accumulator[key] = currentValue;
        return accumulator;
      }, {});

    let nextKey = null;
    let channels = reverse ? Object.values(channelFilters).reverse() : Object.values(channelFilters);
    if (channels.length > +limit) {
      const from = parseInt(offset);
      const to = parseInt(offset) + parseInt(limit);
      channels = channels.slice(from, to);

      const pageKeyDto: PaginationKeyDto = {
        offset: to,
      };

      nextKey = to < Object.values(channelFilters).length ? generatePaginationKey(pageKeyDto) : '';
    }

    const response = {
      channels: channels,
      pagination: {
        next_key: nextKey,
        total: count_total ? Object.values(channelFilters).length : 0,
      },
      height: {
        revision_number: BigInt(0), // TODO
        revision_height: BigInt(0), // TODO
      },
    } as unknown as QueryConnectionChannelsResponse;

    return response;
  }
}
