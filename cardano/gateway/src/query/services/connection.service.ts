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
import { alignTreeWithChain, getCurrentTree, isTreeAligned } from '../../shared/helpers/ibc-state-root';
import { serializeExistenceProof } from '../../shared/helpers/ics23-proof-serialization';
import { HostStateDatum } from '../../shared/types/host-state-datum';

@Injectable()
export class ConnectionService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(DbSyncService) private dbService: DbSyncService,
    @Inject(MithrilService) private mithrilService: MithrilService,
  ) {}

  private async ensureTreeAligned(): Promise<void> {
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo?.datum) {
      throw new GrpcInternalException('IBC infrastructure error: HostState UTxO missing datum');
    }
    const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
    const onChainRoot = hostStateDatum.state.ibc_state_root;

    if (isTreeAligned(onChainRoot)) return;

    this.logger.warn(
      `Tree out of sync with on-chain root ${onChainRoot.substring(0, 16)}..., rebuilding from chain...`,
    );
    await alignTreeWithChain();
  }

  private async getQueryHeight(): Promise<bigint> {
    try {
      const snapshots = await this.mithrilService.getCardanoTransactionsSetSnapshot();
      const latestSnapshot = snapshots?.[0];
      if (latestSnapshot) {
        const height = BigInt(latestSnapshot.block_number);
        return height > 0n ? height : 1n;
      }
    } catch {
      // Ignore and fall back.
    }

    try {
      const latestBlockNo = await this.dbService.queryLatestBlockNo();
      const height = BigInt(latestBlockNo);
      return height > 0n ? height : 1n;
    } catch {
      return 1n;
    }
  }

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

    const deploymentConfig = this.configService.get('deployment');
    const handlerAuthToken = deploymentConfig.handlerAuthToken as unknown as AuthToken;
    const hostStateNFT = deploymentConfig.hostStateNFT as unknown as AuthToken;

    const baseToken = deploymentConfig.validators.mintConnectionStt?.scriptHash ? hostStateNFT : handlerAuthToken;
    const mintConnScriptHash =
      deploymentConfig.validators.mintConnectionStt?.scriptHash || deploymentConfig.validators.mintConnection.scriptHash;

    const sampleConnectionTokenName = this.lucidService.generateTokenName(baseToken, CONNECTION_TOKEN_PREFIX, 0n);
    const connectionTokenPrefix = sampleConnectionTokenName.slice(0, 48);

    const utxos = await this.dbService.findUtxosByPolicyIdAndPrefixTokenName(
      mintConnScriptHash,
      connectionTokenPrefix,
    );

    const identifiedConnections = await Promise.all(
      utxos.map(async (utxo) => {
        const connDatumDecoded: ConnectionDatum = await decodeConnectionDatum(
          utxo.datum!,
          this.lucidService.LucidImporter,
        );
        const identifiedConnection = {
          id: `${CONNECTION_ID_PREFIX}-${getConnectionIdByTokenName(utxo.assetsName, baseToken, CONNECTION_TOKEN_PREFIX)}`,
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
	            prefix: { key_prefix: fromHex(connDatumDecoded.state.counterparty.prefix.key_prefix) },
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

    const queryHeight = await this.getQueryHeight();
    const response = {
      connections: connections,
      pagination: {
        next_key: nextKey,
        total: count_total ? Object.values(connectionFilters).length : 0,
      },
      height: {
        revision_number: BigInt(0), // TODO
        revision_height: queryHeight,
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
      const deploymentConfig = this.configService.get('deployment');
      const handlerAuthToken = deploymentConfig.handlerAuthToken as unknown as AuthToken;
      const hostStateNFT = deploymentConfig.hostStateNFT as unknown as AuthToken;

      const baseToken = deploymentConfig.validators.mintConnectionStt?.scriptHash ? hostStateNFT : handlerAuthToken;
      const mintConnScriptHash =
        deploymentConfig.validators.mintConnectionStt?.scriptHash || deploymentConfig.validators.mintConnection.scriptHash;

      const connectionTokenName = this.lucidService.generateTokenName(
        baseToken,
        CONNECTION_TOKEN_PREFIX,
        BigInt(connectionId),
      );

      const connTokenUnit = mintConnScriptHash + connectionTokenName;
      const utxo = await this.lucidService.findUtxoByUnit(connTokenUnit);
      const connDatumDecoded: ConnectionDatum = await decodeConnectionDatum(
        utxo.datum!,
        this.lucidService.LucidImporter,
      );
      const latestSnapshotsForProof = await this.mithrilService.getCardanoTransactionsSetSnapshot();
      const latestSnapshotForProof = latestSnapshotsForProof?.[0];
      if (!latestSnapshotForProof) {
        throw new GrpcInternalException('Mithril transaction snapshots unavailable for proof_height');
      }
      const proofHeight = BigInt(latestSnapshotForProof.block_number);

      await this.ensureTreeAligned();

      // Generate ICS-23 proof from the IBC state tree
      // 
      // The proof contains sibling hashes that let Cosmos verify this connection state
      // is authentic by reconstructing the Merkle root (which is certified by Mithril).
      // Even if Gateway is compromised, it cannot forge valid proofs.
      const ibcPath = `connections/${CONNECTION_ID_PREFIX}-${connectionId}`;
      const tree = getCurrentTree();
      
      let connectionProof: Buffer;
      try {
        const existenceProof = tree.generateProof(ibcPath);
        connectionProof = serializeExistenceProof(existenceProof);
        
        this.logger.log(`Generated ICS-23 proof for connection ${connectionId}, proof size: ${connectionProof.length} bytes`);
      } catch (error) {
        this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
        throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
      }

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
	            prefix: { key_prefix: fromHex(connDatumDecoded.state.counterparty.prefix.key_prefix) },
	          },
          delay_period: connDatumDecoded.state.delay_period,
        } as unknown as ConnectionEnd,
        proof: connectionProof, // ICS-23 Merkle proof
        proof_height: {
          revision_number: 0,
          revision_height: proofHeight,
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
