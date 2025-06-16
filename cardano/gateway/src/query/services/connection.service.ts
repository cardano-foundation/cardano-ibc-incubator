import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionDatum, decodeConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';

import { CONNECTION_ID_PREFIX, CONNECTION_TOKEN_PREFIX, STATE_MAPPING_CONNECTION } from '../../constant';
import {
  QueryConnectionRequest,
  QueryConnectionResponse,
  QueryConnectionsRequest,
  QueryConnectionsResponse,
} from '@plus/proto-types/build/ibc/core/connection/v1/query';
import { decodePaginationKey, generatePaginationKey, getPaginationParams } from '../../shared/helpers/pagination';
import { PaginationKeyDto } from '../dtos/pagination.dto';
import { AuthToken } from '../../shared/types/auth-token';
import {
  ConnectionEnd,
  IdentifiedConnection,
  State as StateConnectionEnd,
  stateFromJSON,
} from '@plus/proto-types/build/ibc/core/connection/v1/connection';
import { getConnectionIdByTokenName } from '../../shared/helpers/connection';
import { DbSyncService } from './db-sync.service';
import { validPagination } from '../helpers/helper';
import { convertHex2String, fromHex } from '../../shared/helpers/hex';
import { validQueryConnectionParam } from '../helpers/connection.validate';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { GrpcInternalException, GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';

@Injectable()
export class ConnectionService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(DbSyncService) private dbService: DbSyncService,
    @Inject(MithrilService) private mithrilService: MithrilService,
  ) {}

  async queryConnections(request: QueryConnectionsRequest): Promise<QueryConnectionsResponse> {
    this.logger.log('', 'queryConnections');
    const pagination = getPaginationParams(validPagination(request.pagination));
    const {
      'pagination.key': key,
      'pagination.limit': limit,
      'pagination.count_total': count_total,
      'pagination.reverse': reverse,
    } = pagination;
    let { 'pagination.offset': offset } = pagination;
    if (key) offset = decodePaginationKey(key);

    const mintConnScriptHash = this.configService.get('deployment').validators.mintConnection.scriptHash;
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
    const connectionTokenName = this.lucidService.generateTokenName(
      handlerAuthToken,
      CONNECTION_TOKEN_PREFIX,
      BigInt(0),
    );
    const utxos = await this.dbService.findUtxosByPolicyIdAndPrefixTokenName(
      mintConnScriptHash,
      connectionTokenName.slice(0, 20),
    );

    const identifiedConnections = await Promise.all(
      utxos.map(async (utxo) => {
        const connDatumDecoded: ConnectionDatum = await decodeConnectionDatum(
          utxo.datum!,
          this.lucidService.LucidImporter,
        );
        const identifiedConnection = {
          id: `${CONNECTION_ID_PREFIX}-${getConnectionIdByTokenName(utxo.assetsName, handlerAuthToken, CONNECTION_TOKEN_PREFIX)}`,
          /** client associated with this connection. */
          client_id: convertHex2String(connDatumDecoded.state.client_id),
          /**
           * IBC version which can be utilised to determine encodings or protocols for
           * channels or packets utilising this connection
           */
          versions: connDatumDecoded.state.versions.map((version) => ({
            identifier: convertHex2String(version.identifier),
            features: version.features.map((feature) => convertHex2String(feature)),
          })),
          /** current state of the connection end. */
          state: stateFromJSON(STATE_MAPPING_CONNECTION[connDatumDecoded.state.state]),
          /** counterparty chain associated with this connection. */
          counterparty: {
            client_id: convertHex2String(connDatumDecoded.state.counterparty.client_id),
            // identifies the connection end on the counterparty chain associated with a given connection.
            connection_id: convertHex2String(connDatumDecoded.state.counterparty.connection_id),
            // commitment merkle prefix of the counterparty chain.
            prefix: connDatumDecoded.state.counterparty.prefix,
          },
          /** delay period associated with this connection. */
          delay_period: connDatumDecoded.state.delay_period,
        };

        return identifiedConnection as unknown as IdentifiedConnection;
      }),
    );

    const connectionFilters = identifiedConnections.reduce((accumulator, currentValue) => {
      const key = `${currentValue.client_id}_${currentValue.id}`;
      if (!accumulator[key] || accumulator[key].state < currentValue.state) accumulator[key] = currentValue;
      return accumulator;
    }, {});

    let nextKey = null;
    let connections = reverse ? Object.values(connectionFilters).reverse() : Object.values(connectionFilters);
    if (connections.length > +limit) {
      const from = parseInt(offset);
      const to = parseInt(offset) + parseInt(limit);
      connections = connections.slice(from, to);

      const pageKeyDto: PaginationKeyDto = {
        offset: to,
      };
      nextKey = to < Object.values(connectionFilters).length ? generatePaginationKey(pageKeyDto) : '';
    }

    const response = {
      connections: connections,
      pagination: {
        next_key: nextKey,
        total: count_total ? Object.values(connectionFilters).length : 0,
      },
      height: {
        revision_number: BigInt(0), // TODO
        revision_height: BigInt(0), // TODO
      },
    } as unknown as QueryConnectionsResponse;

    return response;
  }

  async queryConnection(request: QueryConnectionRequest): Promise<QueryConnectionResponse> {
    const { connection_id: connectionId } = validQueryConnectionParam(request);
    if (!connectionId) {
      throw new GrpcInvalidArgumentException('Invalid argument: "connection_id" must be provided');
    }
    this.logger.log(connectionId, 'queryConnection');
    try {
      const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
      const mintConnScriptHash = this.configService.get('deployment').validators.mintConnection.scriptHash;

      const connectionTokenName = this.lucidService.generateTokenName(
        handlerAuthToken,
        CONNECTION_TOKEN_PREFIX,
        BigInt(connectionId),
      );

      const connTokenUnit = mintConnScriptHash + connectionTokenName;
      const utxo = await this.lucidService.findUtxoByUnit(connTokenUnit);
      const connDatumDecoded: ConnectionDatum = await decodeConnectionDatum(
        utxo.datum!,
        this.lucidService.LucidImporter,
      );

      const proof = await this.dbService.findUtxoByPolicyAndTokenNameAndState(
        mintConnScriptHash,
        connectionTokenName,
        connDatumDecoded.state.state,
      );

      const cardanoTxProof = await this.mithrilService.getProofsCardanoTransactionList([proof.txHash]);
      const connectionProof = cardanoTxProof?.certified_transactions[0]?.proof;

      const response: QueryConnectionResponse = {
        connection: {
          client_id: convertHex2String(connDatumDecoded.state.client_id),
          versions: connDatumDecoded.state.versions.map((version) => ({
            identifier: convertHex2String(version.identifier),
            features: version.features.map((feature) => convertHex2String(feature)),
          })),
          state:
            STATE_MAPPING_CONNECTION[connDatumDecoded.state.state] ??
            StateConnectionEnd.STATE_UNINITIALIZED_UNSPECIFIED,
          counterparty: {
            client_id: convertHex2String(connDatumDecoded.state.counterparty.client_id),
            // identifies the connection end on the counterparty chain associated with a given connection.
            connection_id: convertHex2String(connDatumDecoded.state.counterparty.connection_id),
            // commitment merkle prefix of the counterparty chain.
            prefix: connDatumDecoded.state.counterparty.prefix,
          },
          delay_period: connDatumDecoded.state.delay_period,
        } as unknown as ConnectionEnd,
        // proof: bytesFromBase64(btoa(`0-${proof.blockNo}/connection/${proof.txHash}/${proof.index}`)), // TODO
        proof: fromHex(connectionProof), // TODO
        proof_height: {
          revision_number: 0,
          revision_height: proof.blockNo, // TODO
        },
      } as unknown as QueryConnectionResponse;
      return response;
    } catch (error) {
      this.logger.error(error, 'queryConnection');
      this.logger.error(error.message, 'queryConnection');
      throw new GrpcInternalException(error.message);
    }
  }
}
