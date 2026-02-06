/* eslint-disable @typescript-eslint/no-unused-vars */
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  QueryBlockDataRequest,
  QueryBlockDataResponse,
  QueryClientStateRequest,
  QueryClientStateResponse,
  QueryConsensusStateRequest,
  QueryConsensusStateResponse,
  QueryLatestHeightRequest,
  QueryLatestHeightResponse,
  QueryNewClientRequest,
  QueryNewClientResponse,
} from '@plus/proto-types/build/ibc/core/client/v1/query';
import { BlockData } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';
import {
  ClientState as ClientStateTendermint,
  ConsensusState as ConsensusStateTendermint,
} from '@plus/proto-types/build/ibc/lightclients/tendermint/v1/tendermint';
import {
  ClientState as ClientStateMithril,
  ConsensusState as ConsensusStateMithril,
  MithrilCertificate,
  MithrilHeader,
} from '@plus/proto-types/build/ibc/lightclients/mithril/v1/mithril';
import { TransactionBody, hash_transaction } from '@dcspark/cardano-multiplatform-lib-nodejs';
import { BlockDto } from '../dtos/block.dto';
import { Any } from '@plus/proto-types/build/google/protobuf/any';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import { KupoService } from '@shared/modules/kupo/kupo.service';
import { ConfigService } from '@nestjs/config';
import { decodeHandlerDatum } from '@shared/types/handler-datum';
import { HostStateDatum } from '@shared/types/host-state-datum';
import { normalizeClientStateFromDatum } from '@shared/helpers/client-state';
import { normalizeConsensusStateFromDatum } from '@shared/helpers/consensus-state';
import { ClientDatum, decodeClientDatum } from '@shared/types/client-datum';
import { normalizeBlockDataFromOuroboros } from '@shared/helpers/block-data';
import {
  GrpcInternalException,
  GrpcInvalidArgumentException,
  GrpcNotFoundException,
} from '~@/exception/grpc_exceptions';
import {
  QueryBlockResultsRequest,
  QueryBlockResultsResponse,
  QueryBlockSearchRequest,
  QueryBlockSearchResponse,
  QueryTransactionByHashRequest,
  QueryTransactionByHashResponse,
  QueryIBCHeaderRequest,
  QueryIBCHeaderResponse,
} from '@plus/proto-types/build/ibc/core/types/v1/query';
import { UtxoDto } from '../dtos/utxo.dto';
import {
  CHANNEL_ID_PREFIX,
  CHANNEL_TOKEN_PREFIX,
  CLIENT_PREFIX,
  CONNECTION_TOKEN_PREFIX,
  EVENT_TYPE_CHANNEL,
  EVENT_TYPE_CLIENT,
  EVENT_TYPE_CONNECTION,
  EVENT_TYPE_SPO,
  REDEEMER_EMPTY_DATA,
  REDEEMER_TYPE,
} from '../../constant';
import { AuthToken } from '@shared/types/auth-token';
import { ConnectionDatum, decodeConnectionDatum } from '@shared/types/connection/connection-datum';
import {
  normalizeTxsResultFromChannelDatum,
  normalizeTxsResultFromClientDatum,
  normalizeTxsResultFromConnDatum,
  normalizeTxsResultFromChannelRedeemer,
  normalizeTxsResultFromModuleRedeemer,
} from '@shared/helpers/block-results';
import {
  ResponseDeliverTx,
  ResultBlockResults,
  ResultBlockSearch,
} from '@plus/proto-types/build/ibc/core/types/v1/block';
import { DbSyncService } from './db-sync.service';
import { ChannelDatum, decodeChannelDatum } from '@shared/types/channel/channel-datum';
import { getChannelIdByTokenName, getConnectionIdFromConnectionHops } from '@shared/helpers/channel';
import cbor from 'cbor';
import { getConnectionIdByTokenName } from '@shared/helpers/connection';
import { UTxO } from '@lucid-evolution/lucid';
import { bytesFromBase64 } from '@plus/proto-types/build/helpers';
import { getIdByTokenName } from '@shared/helpers/helper';
import { decodeMintChannelRedeemer, decodeSpendChannelRedeemer } from '../../shared/types/channel/channel-redeemer';
import {
  decodeMintConnectionRedeemer,
  decodeSpendConnectionRedeemer,
} from '../../shared/types/connection/connection-redeemer';
import { decodeIBCModuleRedeemer } from '../../shared/types/port/ibc_module_redeemer';
import { Packet } from '@shared/types/channel/packet';
import { decodeSpendClientRedeemer } from '@shared/types/client-redeemer';
import { validQueryClientStateParam, validQueryConsensusStateParam } from '../helpers/client.validate';
import { MiniProtocalsService } from '../../shared/modules/mini-protocals/mini-protocals.service';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { getNanoseconds } from '../../shared/helpers/time';
import { doubleToFraction } from '../../shared/helpers/number';
import {
  normalizeMithrilStakeDistribution,
  normalizeMithrilStakeDistributionCertificate,
} from '../../shared/helpers/mithril-header';
import { getCurrentTree, isTreeAligned, alignTreeWithChain } from '../../shared/helpers/ibc-state-root';
import { serializeExistenceProof } from '../../shared/helpers/ics23-proof-serialization';
import {
  QueryDenomTraceRequest,
  QueryDenomTraceResponse,
  QueryDenomTracesRequest,
  QueryDenomTracesResponse,
} from '@plus/proto-types/build/ibc/applications/transfer/v1/query';
import { DenomTrace } from '@plus/proto-types/build/ibc/applications/transfer/v1/transfer';
import { DenomTraceService } from './denom-trace.service';

@Injectable()
export class QueryService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(KupoService) private kupoService: KupoService,
    @Inject(DbSyncService) private dbService: DbSyncService,
    @Inject(MiniProtocalsService) private miniProtocalsService: MiniProtocalsService,
    @Inject(MithrilService) private mithrilService: MithrilService,
    @Inject(DenomTraceService) private denomTraceService: DenomTraceService,
  ) {}

  /**
   * Ensure the in-memory ICS-23 Merkle tree is aligned with on-chain state.
   * 
   * This is part of the Gateway's selfphealing mechanism. After a crash or restart,
   * No manual intervention is required - this method automatically detects stale state
   * and triggers a rebuild from on-chain data.
   * 
   * The Gateway maintains an in-memory Merkle tree for generating ICS-23 proofs.
   * This tree can become out of sync in several scenarios:
   *   1. Gateway restarts - the in-memory tree is lost (most common case)
   *   2. A transaction fails after we speculatively updated the tree (should not happen
   *      since we work on a clone and only `commit()` after tx is confirmed)
   *   3. Another Gateway instance (or direct on-chain interaction) modified state
   * 
   * HOW IT WORKS:
   * We query the HostState UTXO (identified by a unique NFT in the STT architecture)
   * and compare its stored ibc_state_root with our in-memory tree's root.
   * If they don't match, we call alignTreeWithChain() to rebuild from on-chain UTXOs.
   * 
   * CRASH RECOVERY FLOW:
   * 1. Gateway restarts -> in-memory tree is empty
   * 2. First query arrives (e.g., Hermes calls queryClientState)
   * 3. This method detects root mismatch (empty tree vs on-chain root)
   * 4. alignTreeWithChain() queries all IBC UTXOs and rebuilds the tree
   * 5. Proof generation proceeds normally
   * 6. Subsequent queries find the tree aligned (cheap root comparison)
   * TO-DO: Will a growing amount of IBC UTXOs be a problem in the future for this recovery but also for any in-memory limits?
   * PERFORMANCE NOTE:
   * Tree rebuilding is expensive (queries all IBC UTXOs), but it only happens when
   * the tree is actually stale. In normal operation, this is a cheap root comparison.
   * 
   * @returns Promise that resolves when tree is aligned (may trigger rebuild)
   * @throws GrpcInternalException if HostState UTXO is missing or invalid
   */
  private async ensureTreeAligned(): Promise<void> {
    // Query the HostState UTXO to get the authoritative on-chain root.
    // The HostState UTXO is identified by a unique NFT (STT architecture)
    // which guarantees exactly one canonical state exists at any time.
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    
    if (!hostStateUtxo?.datum) {
      // This should never happen in a properly deployed system.
      // If it does, there's a fundamental issue with the IBC deployment.
      this.logger.error('HostState UTXO has no datum - cannot verify tree alignment');
      throw new GrpcInternalException('IBC infrastructure error: HostState UTXO missing datum');
    }
    
    // Decode the datum to extract the committed ibc_state_root.
    // This root is the Merkle commitment over all IBC state (clients, connections, channels, etc.)
    const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
    const onChainRoot = hostStateDatum.state.ibc_state_root;
    
    // Check if our in-memory tree matches the on-chain commitment.
    // If it does, we're good to go - proofs generated from our tree will verify correctly.
    if (isTreeAligned(onChainRoot)) {
      this.logger.debug(`Tree aligned with on-chain root ${onChainRoot.substring(0, 16)}...`);
      return;
    }
    
    // Tree is stale. This happens after Gateway restart, failed transactions, etc.
    // We need to rebuild the tree from on-chain UTXOs before we can generate valid proofs.
    this.logger.warn(
      `Tree out of sync with on-chain root ${onChainRoot.substring(0, 16)}..., rebuilding from chain...`
    );
    
    // alignTreeWithChain() queries all IBC UTXOs (clients, connections, channels)
    // and rebuilds the Merkle tree from scratch. This is expensive but necessary.
    const result = await alignTreeWithChain();
    
    this.logger.log(`Tree rebuilt successfully, new root: ${result.root.substring(0, 16)}...`);
  }

	  async queryNewMithrilClient(request: QueryNewClientRequest): Promise<QueryNewClientResponse> {
	    const { height } = request;
	    if (!height) {
	      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
	    }

	    // NOTE: Do not use the WASM Mithril client here.
	    //
	    // Our local Mithril aggregator returns certificate JSON that does not include the legacy `beacon`
    // field (it instead encodes coordinates inside `signed_entity_type`). The WASM client performs
    // strict JSON deserialization and fails with errors like:
    // "missing field `beacon` at line ...".
    //
	    // For the Gateway's purposes (building a Mithril IBC client/consensus state), we only need the
	    // raw REST payloads and can avoid strict deserialization entirely.
	    const mithrilStakeDistributionsList = await this.mithrilService.getMostRecentMithrilStakeDistributions();

	    const snapshots = await this.mithrilService.getCardanoTransactionsSetSnapshot();
	    const snapshot =
	      snapshots.find((snapshot) => BigInt(snapshot.block_number) === BigInt(height)) ?? snapshots[0];
	    if (!snapshot) {
	      throw new GrpcNotFoundException('Not found: no Mithril transaction snapshots available');
	    }

	    const snapshotCertificate = await this.mithrilService.getCertificateByHash(snapshot.certificate_hash);
	    const stakeDistributionCertHash = snapshotCertificate.previous_hash;
	    if (!stakeDistributionCertHash) {
	      throw new GrpcNotFoundException('Not found: transaction snapshot certificate is missing previous_hash');
	    }

	    const stakeDistribution = mithrilStakeDistributionsList.find(
	      (d) => d.certificate_hash === stakeDistributionCertHash,
	    );
	    if (!stakeDistribution) {
	      throw new GrpcNotFoundException(
	        `Not found: no Mithril stake distribution found for certificate ${stakeDistributionCertHash}`,
	      );
	    }
	    const stakeDistributionCertificate = await this.mithrilService.getCertificateByHash(stakeDistributionCertHash);

	    const phifFraction = doubleToFraction(stakeDistributionCertificate.metadata.parameters.phi_f);
	    const clientStateMithril: ClientStateMithril = {
	      /** Chain id */
	      chain_id: this.configService.get('cardanoChainId'),
	      /** Latest height the client was updated to */
	      latest_height: {
	        revision_number: 0n,
	        // We treat "height" as the Mithril transaction snapshot block number (see QueryLatestHeight).
	        revision_height: BigInt(snapshot.block_number),
	      },
      /** Block height when the client was frozen due to a misbehaviour */
	      frozen_height: {
	        revision_number: 0n,
	        revision_height: 0n,
	      },
	      /** Epoch number of current chain state */
	      current_epoch: BigInt(stakeDistribution.epoch),
	      trusting_period: {
	        // The Cosmos-side light client rejects a zero trusting period.
	        //
        // This value is a policy choice. For local devnet testing we just need a non-zero period
        // so the client doesn't immediately expire. In production this should be derived from
        // the security assumptions of the Cardano/Mithril verification model.
        seconds: 86_400n, // 24 hours
	        nanos: 0,
	      },
	      protocol_parameters: {
	        /** Quorum parameter */
	        k: BigInt(stakeDistributionCertificate.metadata.parameters.k),
	        /** Security parameter (number of lotteries) */
	        m: BigInt(stakeDistributionCertificate.metadata.parameters.m),
	        /** f in phi(w) = 1 - (1 - f)^w, where w is the stake of a participant */
	        phi_f: {
	          numerator: phifFraction.numerator,
          denominator: phifFraction.denominator,
        },
      },
      /** Path at which next upgraded client will be committed. */
      upgrade_path: [],

      // HostState NFT identification for this Cardano deployment (STT architecture).
      //
      // Cosmos-side verification uses this to locate the HostState output inside the
      // certified transaction body and extract the `ibc_state_root` from its datum.
      //
      // This is a safety property: even if the transaction body has multiple outputs, the counterparty
      // only accepts the output that carries this NFT.
      host_state_nft_policy_id: Buffer.from(this.configService.get('deployment').hostStateNFT.policyId, 'hex'),
      host_state_nft_token_name: Buffer.from(this.configService.get('deployment').hostStateNFT.name, 'hex'),
	    } as unknown as ClientStateMithril;

	    // ConsensusState timestamp is expressed in nanoseconds since Unix epoch.
	    const timestampMs = new Date(snapshotCertificate.metadata.sealed_at).valueOf();
	    const consensusTimestampNs = BigInt(timestampMs) * 1_000_000n;

    // For the initial client, we include the current on-chain `ibc_state_root`.
    //
    // This is the trust anchor at client creation time (similar to other IBC clients).
    // For subsequent updates, the counterparty does not "trust the Gateway's root":
    // it authenticates the root per-height via `queryIBCHeader()` evidence
    // (Mithril-certified transaction inclusion + HostState output datum extraction).
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo?.datum) {
      throw new GrpcInternalException('IBC infrastructure error: HostState UTxO missing datum');
    }
    const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
    const ibcStateRootBytes = Buffer.from(hostStateDatum.state.ibc_state_root, 'hex');

	    const consensusStateMithril: ConsensusStateMithril = {
	      timestamp: consensusTimestampNs,
	      first_cert_hash_latest_epoch: normalizeMithrilStakeDistributionCertificate(
	        stakeDistribution,
	        stakeDistributionCertificate,
	      ),
	      latest_cert_hash_tx_snapshot: snapshot.certificate_hash,
	      ibc_state_root: ibcStateRootBytes,
	    } as unknown as ConsensusStateMithril;

    const clientStateAny: Any = {
      type_url: '/ibc.lightclients.mithril.v1.ClientState',
      value: ClientStateMithril.encode(clientStateMithril).finish(),
    };

    const consensusStateAny: Any = {
      type_url: '/ibc.lightclients.mithril.v1.ConsensusState',
      value: ConsensusStateMithril.encode(consensusStateMithril).finish(),
    };

    const response: QueryNewClientResponse = {
      client_state: clientStateAny,
      consensus_state: consensusStateAny,
    };

    return response;
  }

  async latestHeight(request: QueryLatestHeightRequest): Promise<QueryLatestHeightResponse> {
    // Prefer Mithril snapshots when available; fall back to db-sync for devnet/when Mithril is disabled.
    try {
      const listSnapshots = await this.mithrilService.getCardanoTransactionsSetSnapshot();
      if (listSnapshots?.length) {
        const latestHeightResponse = {
          height: listSnapshots[0].block_number,
        };
        this.logger.log(latestHeightResponse.height, 'QueryLatestHeight');
        return latestHeightResponse as unknown as QueryLatestHeightResponse;
      }
    } catch (error) {
      this.logger.warn(
        `Mithril snapshot unavailable, falling back to db-sync latest block height: ${error?.message ?? error}`,
        'QueryLatestHeight',
      );
    }

    const latestBlockNo = await this.dbService.queryLatestBlockNo();
    const latestHeightResponse = {
      height: latestBlockNo,
    };
    this.logger.log(latestHeightResponse.height, 'QueryLatestHeight');
    return latestHeightResponse as unknown as QueryLatestHeightResponse;
  }

  private async getClientDatum(clientId: string): Promise<[ClientDatum, UTxO]> {
    // Get handlerUTXO
    const handlerAuthToken = this.configService.get('deployment').handlerAuthToken;
    const handlerAuthTokenUnit = handlerAuthToken.policyId + handlerAuthToken.name;
    const handlerUtxo = await this.lucidService.findUtxoByUnit(handlerAuthTokenUnit);
    const handlerDatum = await decodeHandlerDatum(handlerUtxo.datum, this.lucidService.LucidImporter);

    const clientAuthTokenUnit = this.lucidService.getClientAuthTokenUnit(handlerDatum, BigInt(clientId));
    const spendClientUTXO = await this.lucidService.findUtxoByUnit(clientAuthTokenUnit);

    const clientDatum = await decodeClientDatum(spendClientUTXO.datum, this.lucidService.LucidImporter);
    return [clientDatum, spendClientUTXO];
  }

  /**
   * Query client state for a given client ID.
   *
   * Note on heights:
   * - In canonical IBC/Cosmos gRPC, "query height" (state snapshot height) is passed via gRPC metadata
   *   (commonly `x-cosmos-block-height`), not as a request field.
   * - The Gateway currently serves proofs from its latest aligned in-memory tree. Until historical
   *   snapshots are implemented, callers should treat this as "latest only" even if they have their
   *   own notion of query height.
   */
  async queryClientState(request: QueryClientStateRequest): Promise<QueryClientStateResponse> {
    this.logger.log(request.client_id, 'queryClientState');
    const { client_id: clientId } = validQueryClientStateParam(request);

    const [clientDatum, spendClientUTXO] = await this.getClientDatum(clientId);
    const clientStateTendermint = normalizeClientStateFromDatum(clientDatum.state.clientState);

    // NOTE: The Gateway currently serves proofs from the latest aligned in-memory tree.
    // Therefore `proof_height` must correspond to the height of the root that those proofs
    // verify against (i.e., the Mithril-certified height the counterparty will update to),
    // not the height of the UTxO that happens to store this datum.
    const latestSnapshotsForProof = await this.mithrilService.getCardanoTransactionsSetSnapshot();
    const latestSnapshotForProof = latestSnapshotsForProof?.[0];
    if (!latestSnapshotForProof) {
      throw new GrpcInternalException('Mithril transaction snapshots unavailable for proof_height');
    }
    const proofHeight = BigInt(latestSnapshotForProof.block_number);
    const clientStateAny: Any = {
      type_url: '/ibc.lightclients.tendermint.v1.ClientState',
      value: ClientStateTendermint.encode(clientStateTendermint).finish(),
    };

    // Generate ICS-23 proof from the IBC state tree.
    // The request `client_id` is the canonical IBC identifier (e.g., `07-tendermint-36`);
    // `clientId` here is the sequence number after prefix stripping.
    const ibcPath = `clients/07-tendermint-${clientId}/clientState`;
    
    // CRITICAL: Ensure the in-memory Merkle tree is aligned with on-chain state before
    // generating proofs. The tree can become stale after Gateway restarts, failed
    // transactions, or if state was modified by another process. If we generate a proof
    // from a stale tree, the proof won't verify against the on-chain commitment.
    await this.ensureTreeAligned();
    
    const tree = getCurrentTree();
    
    let clientProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      clientProof = serializeExistenceProof(existenceProof);
      
      this.logger.log(`Generated ICS-23 proof for client ${clientId}, proof size: ${clientProof.length} bytes`);
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response = {
      client_state: clientStateAny,
      proof: clientProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
      },
    };

    return response as unknown as QueryClientStateResponse;
  }

  /**
   * Query consensus state for a given client ID at a specific height.
   * 
   * The `height` parameter here is the "consensus height" (counterparty height / data identifier),
   * NOT the "query height" (state snapshot height). This identifies WHICH specific consensus state
   * entry to retrieve, not which version of the state tree to read from.
   * 
   * Height behavior:
   * - If height is not provided or is 0: Returns the latest consensus state for this client
   * - If height is provided: Returns the consensus state at that specific revision height
   * 
   * This is different from the "query height" concept in queryClientState.
   * See the documentation in client.validate.ts for the full explanation of the two height types.
   */
  async queryConsensusState(request: QueryConsensusStateRequest): Promise<QueryConsensusStateResponse> {
    this.logger.log(
      `client_id = ${request.client_id}, revision_number = ${request.revision_number}, revision_height = ${request.revision_height}, latest_height = ${request.latest_height}`,
      'queryConsensusState',
    );
    const { client_id: clientId } = validQueryConsensusStateParam(request);
    const [clientDatum, spendClientUTXO] = await this.getClientDatum(clientId);
    
    // Consensus height: identifies which consensus state entry to retrieve
    // If latest_height is true, use the latest consensus state for this client.
    let heightReq: bigint;
    if (request.latest_height) {
      heightReq = clientDatum.state.clientState.latestHeight.revisionHeight;
      this.logger.log(`queryConsensusState: Using latest consensus height: ${heightReq}`);
    } else {
      // Canonical IBC request provides revision_number + revision_height.
      // We key consensus states by revision_height in the on-chain datum.
      heightReq = request.revision_height;
    }
    const consensusStateTendermint = normalizeConsensusStateFromDatum(clientDatum.state.consensusStates, heightReq);
    if (!consensusStateTendermint)
      throw new GrpcNotFoundException(`Unable to find Consensus State at height ${heightReq}`);
    const consensusStateAny: Any = {
      type_url: '/ibc.lightclients.tendermint.v1.ConsensusState',
      value: ConsensusStateTendermint.encode(consensusStateTendermint).finish(),
    };
    const latestSnapshotsForProof = await this.mithrilService.getCardanoTransactionsSetSnapshot();
    const latestSnapshotForProof = latestSnapshotsForProof?.[0];
    if (!latestSnapshotForProof) {
      throw new GrpcInternalException('Mithril transaction snapshots unavailable for proof_height');
    }
    const proofHeight = BigInt(latestSnapshotForProof.block_number);
    
    // Generate ICS-23 proof from the IBC state tree.
    const ibcPath = `clients/07-tendermint-${clientId}/consensusStates/${heightReq}`;
    
    // CRITICAL: Ensure the in-memory Merkle tree is aligned with on-chain state before
    // generating proofs. See ensureTreeAligned() for detailed explanation of why this
    // is necessary and when the tree can become stale.
    await this.ensureTreeAligned();
    
    const tree = getCurrentTree();
    
    let consensusProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      consensusProof = serializeExistenceProof(existenceProof);
      
      this.logger.log(`Generated ICS-23 proof for consensus state ${clientId}@${heightReq}, proof size: ${consensusProof.length} bytes`);
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }
    
    const response = {
      consensus_state: consensusStateAny,
      proof: consensusProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
      },
    };
    return response as unknown as QueryConsensusStateResponse;
  }

  async queryBlockData(request: QueryBlockDataRequest): Promise<QueryBlockDataResponse> {
    // Legacy query used by the old Ouroboros/Cardano light client implementation.
    //
    // The production Cosmos-side Cardano client is the Mithril client, and Hermes uses
    // `queryIBCHeader()` + ICS-23 proofs for verification. Keeping this endpoint around is
    // useful when comparing historical approaches, but it is not part of the relaying path.
    const { height } = request;
    this.logger.log(height, 'queryBlockData');
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }

    const blockDto: BlockDto = await this.dbService.findBlockByHeight(height);
    let blockHeader = null;
    try {
      blockHeader = await this.miniProtocalsService.fetchBlockHeader(blockDto.hash, BigInt(blockDto.slot));
    } catch (err) {
      this.logger.warn(
        `Failed to fetch block header via mini-protocols for height=${height} slot=${blockDto.slot}: ${err?.message ?? err}`,
        'queryBlockData',
      );
    }
    try {
      const blockDataOuroboros = normalizeBlockDataFromOuroboros(blockDto, blockHeader);
      blockDataOuroboros.chain_id = `${this.configService.get('cardanoChainNetworkMagic')}`;
      blockDataOuroboros.epoch_nonce = this.configService.get('cardanoEpochNonceGenesis');
      if (blockDto.epoch > 0) {
        const epochParam = await this.dbService.findEpochParamByEpochNo(BigInt(blockDto.epoch));
        blockDataOuroboros.epoch_nonce = epochParam.nonce;
      }

      const blockData: QueryBlockDataResponse = {
        block_data: {
          type_url: '/ibc.clients.cardano.v1.BlockData',
          value: BlockData.encode(blockDataOuroboros).finish(),
        },
      } as unknown as QueryBlockDataResponse;
      return blockData;
    } catch (err) {
      this.logger.error('queryBlockData ERR:', err);

      this.logger.error(err.message, 'queryBlockData ERR:');

      throw new GrpcInternalException(err.message);
    }
  }

  async queryBlockResults(request: QueryBlockResultsRequest): Promise<QueryBlockResultsResponse> {
    const { height } = request;
    this.logger.log(height, 'queryBlockResults');
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }
    // const listBlockNo = await this.dbService.queryListBlockByImmutableFileNo(Number(height));

    // const blockDto: BlockDto = await this.dbService.findBlockByHeight(request.height);
    // if (!listBlockNo.length) {
    //   // throw new GrpcNotFoundException(`Not found: "height" ${request.height} not found`);
    //   return {
    //     block_results: {
    //       height: {
    //         revision_height: request.height,
    //         revision_number: BigInt(0),
    //       },
    //       txs_results: [],
    //     },
    //   } as unknown as QueryBlockResultsResponse;
    // }

    try {
      const deploymentConfig = this.configService.get('deployment');
      const handlerAuthToken = deploymentConfig.handlerAuthToken as unknown as AuthToken;
      const hostStateNFT = deploymentConfig.hostStateNFT as unknown as AuthToken;

      const mintConnScriptHash =
        deploymentConfig.validators.mintConnectionStt?.scriptHash || deploymentConfig.validators.mintConnection.scriptHash;
      const mintChannelScriptHash =
        deploymentConfig.validators.mintChannelStt?.scriptHash || deploymentConfig.validators.mintChannel.scriptHash;

      const connectionBaseToken = deploymentConfig.validators.mintConnectionStt?.scriptHash ? hostStateNFT : handlerAuthToken;
      const channelBaseToken = deploymentConfig.validators.mintChannelStt?.scriptHash ? hostStateNFT : handlerAuthToken;

      const totalEventResults: ResponseDeliverTx[] = [];
      for (const blockNo of [height]) {
        // connection +channel
        const utxosInBlock = await this.dbService.findUtxosByBlockNo(parseInt(blockNo.toString()));
        const txsResults = await Promise.all(
          utxosInBlock
            .filter((utxo) => [mintConnScriptHash, mintChannelScriptHash].includes(utxo.assetsPolicy))
            .map(async (utxo) => {
              switch (utxo.assetsPolicy) {
                case mintConnScriptHash:
                  return await this._parseEventConnection(utxo, connectionBaseToken, mintConnScriptHash);
                case mintChannelScriptHash:
                  return await this._parseEventChannel(utxo, channelBaseToken, mintChannelScriptHash);
              }
            }),
        );

        // client state + consensus state
        const authOrClientUTxos = await this.dbService.findUtxoClientOrAuthHandler(parseInt(blockNo.toString()));
        const txsAuthOrClientsResults = await this._parseEventClient(authOrClientUTxos);

        // register/unregister event spo
        const spoEvents = await this._querySpoEvents(BigInt(blockNo));
        const eventInBlock = [...txsAuthOrClientsResults, ...txsResults, ...spoEvents];
        totalEventResults.push(...eventInBlock);
      }

      const blockResults: ResultBlockResults = {
        height: {
          revision_height: request.height,
          revision_number: BigInt(0),
        },
        txs_results: totalEventResults,
      } as unknown as ResultBlockResults;

      const responseBlockResults: QueryBlockResultsResponse = {
        block_results: blockResults,
      } as unknown as QueryBlockResultsResponse;

      return responseBlockResults;
    } catch (err) {
      console.error(err);

      this.logger.error(err);

      this.logger.error(err.message, 'queryBlockResults');
      throw new GrpcInternalException(err.message);
    }
  }

  async queryEvents(request: { since_height: bigint }): Promise<{
    current_height: bigint;
    events: Array<{ height: bigint; events: ResponseDeliverTx[] }>;
  }> {
    const { since_height } = request;

    if (since_height === undefined || since_height === null) {
      throw new GrpcInvalidArgumentException('Invalid argument: "since_height" must be provided');
    }

    try {
      // Get current height
      const latestHeight = await this.latestHeight({});
      const currentHeight = Number(latestHeight.height);

      // If since_height >= current, return empty
      if (Number(since_height) >= currentHeight) {
        return {
          current_height: BigInt(currentHeight),
          events: [],
        };
      }

      // Query events for each block from since_height+1 to current
      const blockEvents: Array<{ height: bigint; events: ResponseDeliverTx[] }> = [];
      const startHeight = Number(since_height) + 1;

      // Limit to reasonable range (e.g., 100 blocks at a time)
      const endHeight = Math.min(currentHeight, startHeight + 100);

      for (let height = startHeight; height <= endHeight; height++) {
        try {
          // Reuse existing queryBlockResults logic
          const blockResult = await this.queryBlockResults({ height: BigInt(height) });

          if (blockResult.block_results.txs_results.length > 0) {
            blockEvents.push({
              height: BigInt(height),
              events: blockResult.block_results.txs_results,
            });
          }
        } catch (err) {
          this.logger.warn(`Failed to query events at height ${height}: ${err.message}`);
          // Continue with next block
        }
      }

      return {
        current_height: BigInt(currentHeight),
        events: blockEvents,
      };
    } catch (err) {
      this.logger.error(err);
      this.logger.error(err.message, 'queryEvents');
      throw new GrpcInternalException(err.message);
    }
  }

  private async _querySpoEvents(height: BigInt): Promise<ResponseDeliverTx[]> {
    const txsResults: ResponseDeliverTx[] = [];
    const hasEventRegister = await this.dbService.checkExistPoolUpdateByBlockNo(parseInt(height.toString()));
    if (hasEventRegister) {
      txsResults.push(<ResponseDeliverTx>{
        code: 0,
        events: [
          {
            type: EVENT_TYPE_SPO.REGISTER,
            event_attribute: [],
          },
        ],
      });
    }

    const hasEventUnRegister = await this.dbService.checkExistPoolRetireByBlockNo(parseInt(height.toString()));
    if (hasEventUnRegister) {
      txsResults.push(<ResponseDeliverTx>{
        code: 0,
        events: [
          {
            type: EVENT_TYPE_SPO.UNREGISTER,
            event_attribute: [],
          },
        ],
      });
    }

    return txsResults;
  }

  private async _parseEventConnection(
    utxo: UtxoDto,
    tokenBase: AuthToken,
    mintScriptHash: string,
  ): Promise<ResponseDeliverTx> {
    const connDatumDecoded: ConnectionDatum = await decodeConnectionDatum(utxo.datum!, this.lucidService.LucidImporter);
    const currentConnectionId = getConnectionIdByTokenName(utxo.assetsName, tokenBase, CONNECTION_TOKEN_PREFIX);
    const txsResult = normalizeTxsResultFromConnDatum(connDatumDecoded, currentConnectionId);

    const spendAddress = this.configService.get('deployment').validators.spendConnection.address;
    const redeemers = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
      utxo.txId.toString(),
      mintScriptHash,
      spendAddress,
    );
    redeemers
      .filter((redeemer) => redeemer.data !== REDEEMER_EMPTY_DATA && redeemer.data.length > 10)
      .map((redeemer) => {
        switch (redeemer.type) {
          case REDEEMER_TYPE.MINT:
            const mintRedeemer = decodeMintConnectionRedeemer(redeemer.data, this.lucidService.LucidImporter);
            if (mintRedeemer.hasOwnProperty('ConnOpenInit')) txsResult.events[0].type = EVENT_TYPE_CONNECTION.OPEN_INIT;
            if (mintRedeemer.hasOwnProperty('ConnOpenTry')) txsResult.events[0].type = EVENT_TYPE_CONNECTION.OPEN_TRY;
            break;
          case REDEEMER_TYPE.SPEND:
            const spendRedeemer = decodeSpendConnectionRedeemer(redeemer.data, this.lucidService.LucidImporter);
            if (spendRedeemer.hasOwnProperty('ConnOpenAck')) txsResult.events[0].type = EVENT_TYPE_CONNECTION.OPEN_ACK;
            if (spendRedeemer.hasOwnProperty('ConnOpenConfirm'))
              txsResult.events[0].type = EVENT_TYPE_CONNECTION.OPEN_CONFIRM;
            break;
          default:
        }
      });
    console.dir(
      {
        txsResult,
      },
      { depth: 10 },
    );
    return txsResult as unknown as ResponseDeliverTx;
  }

  private async _parseEventChannel(
    utxo: UtxoDto,
    tokenBase: AuthToken,
    mintScriptHash: string,
  ): Promise<ResponseDeliverTx> {
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);

    const currentChannelId = getChannelIdByTokenName(utxo.assetsName, tokenBase, CHANNEL_TOKEN_PREFIX);
    const currentConnectionId = getConnectionIdFromConnectionHops(channelDatumDecoded.state.channel.connection_hops[0]);

    const txsResult = normalizeTxsResultFromChannelDatum(channelDatumDecoded, currentConnectionId, currentChannelId);

    const spendAddress = this.configService.get('deployment').validators.spendChannel.address;
    let redeemers = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
      utxo.txId.toString(),
      mintScriptHash,
      spendAddress,
    );

    redeemers = redeemers.filter((redeemer) => ![REDEEMER_EMPTY_DATA].includes(redeemer.data));
    for (const redeemer of redeemers) {
      switch (redeemer.type) {
        case REDEEMER_TYPE.MINT:
          const mintRedeemer = decodeMintChannelRedeemer(redeemer.data, this.lucidService.LucidImporter);

          if (mintRedeemer.hasOwnProperty('ChanOpenInit')) txsResult.events[0].type = EVENT_TYPE_CHANNEL.OPEN_INIT;
          if (mintRedeemer.hasOwnProperty('ChanOpenTry')) txsResult.events[0].type = EVENT_TYPE_CHANNEL.OPEN_TRY;
          break;
        case REDEEMER_TYPE.SPEND:
          const spendRedeemer = decodeSpendChannelRedeemer(redeemer.data, this.lucidService.LucidImporter);

          if (spendRedeemer.hasOwnProperty('ChanOpenAck')) txsResult.events[0].type = EVENT_TYPE_CHANNEL.OPEN_ACK;
          if (spendRedeemer.hasOwnProperty('ChanOpenConfirm'))
            txsResult.events[0].type = EVENT_TYPE_CHANNEL.OPEN_CONFIRM;
          if (spendRedeemer.hasOwnProperty('RecvPacket') || spendRedeemer.hasOwnProperty('SendPacket')) {
            // find redeemer module recv packet -> get packet ack
            const spendTransferModuleAddress = this.configService.get('deployment').modules.transfer.address;
            const spendMockModuleAddress = this.configService.get('deployment').modules?.mock?.address;
            const packetEvent = normalizeTxsResultFromChannelRedeemer(spendRedeemer, channelDatumDecoded);
            txsResult.events = packetEvent.events;
            if (spendRedeemer.hasOwnProperty('SendPacket')) break;

            const moduleRedeemer = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
              utxo.txId.toString(),
              '',
              spendTransferModuleAddress,
            );
            if (moduleRedeemer.length > 0) {
              const moduleRedeemerDecoded = decodeIBCModuleRedeemer(
                moduleRedeemer[0].data,
                this.lucidService.LucidImporter,
              );
              const writeAckTxsResult = normalizeTxsResultFromModuleRedeemer(
                moduleRedeemerDecoded,
                spendRedeemer,
                channelDatumDecoded,
              );
              txsResult.events.push(...writeAckTxsResult.events);
            }

            if (spendMockModuleAddress) {
              const mockModuleRedeemer = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
                utxo.txId.toString(),
                '',
                spendMockModuleAddress,
              );
              if (mockModuleRedeemer.length > 0) {
                const mockModuleRedeemerDecoded = decodeIBCModuleRedeemer(
                  mockModuleRedeemer[0].data,
                  this.lucidService.LucidImporter,
                );
                const writeAckTxsResult = normalizeTxsResultFromModuleRedeemer(
                  mockModuleRedeemerDecoded,
                  spendRedeemer,
                  channelDatumDecoded,
                );
                txsResult.events.push(...writeAckTxsResult.events);
              }
            }
          }
          if (spendRedeemer.hasOwnProperty('AcknowledgePacket')) {
            const packetEvent = normalizeTxsResultFromChannelRedeemer(spendRedeemer, channelDatumDecoded);
            txsResult.events = packetEvent.events;
          }
          if (spendRedeemer.hasOwnProperty('TimeoutPacket')) {
            const packetEvent = normalizeTxsResultFromChannelRedeemer(spendRedeemer, channelDatumDecoded);
            txsResult.events = packetEvent.events;
          }
          if (spendRedeemer === 'ChanCloseInit') {
            txsResult.events[0].type = EVENT_TYPE_CHANNEL.CLOSE_INIT;
          }
          if (spendRedeemer.hasOwnProperty('ChanCloseConfirm')) {
            txsResult.events[0].type = EVENT_TYPE_CHANNEL.CLOSE_CONFIRM;
          }
          break;
        default:
      }
    }

    console.dir(
      {
        txsResult,
      },
      { depth: 10 },
    );

    return txsResult as unknown as ResponseDeliverTx;
  }

  private async _parseEventClient(utxos: UtxoDto[]): Promise<ResponseDeliverTx[]> {
    const deploymentConfig = this.configService.get('deployment');
    const mintClientScriptHash =
      deploymentConfig.validators.mintClientStt?.scriptHash || deploymentConfig.validators.mintClient.scriptHash;
    const spendClientAddress = deploymentConfig.validators.spendClient.address;
    const handlerAuthToken = deploymentConfig.handlerAuthToken;
    const tokenBase = deploymentConfig.validators.mintClientStt?.scriptHash ? deploymentConfig.hostStateNFT : handlerAuthToken;
    const hasHandlerUtxo = utxos.find((utxo) => utxo.assetsPolicy === handlerAuthToken.policyId);

    const txsResults = await Promise.all(
      utxos
        .filter((utxo) => [mintClientScriptHash].includes(utxo.assetsPolicy))
        .map(async (clientUtxo) => {
          const eventClient = hasHandlerUtxo ? EVENT_TYPE_CLIENT.CREATE_CLIENT : EVENT_TYPE_CLIENT.UPDATE_CLIENT;
          const clientId = getIdByTokenName(clientUtxo.assetsName, tokenBase, CLIENT_PREFIX);
          const clientDatum = await decodeClientDatum(clientUtxo.datum, this.lucidService.LucidImporter);

          const redeemers = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
            clientUtxo.txId.toString(),
            mintClientScriptHash,
            spendClientAddress,
          );
          const spendClientRedeemer = redeemers.find((e) => e.type == 'spend');
          let spendClientRedeemerData = null;
          if (spendClientRedeemer) {
            spendClientRedeemerData = decodeSpendClientRedeemer(
              spendClientRedeemer.data,
              this.lucidService.LucidImporter,
            );
          }

          const txsResult = normalizeTxsResultFromClientDatum(
            clientDatum,
            eventClient,
            clientId,
            spendClientRedeemerData,
          );
          return txsResult as unknown as ResponseDeliverTx;
        }),
    );
    console.dir(
      {
        txsResults,
      },
      { depth: 10 },
    );

    return txsResults;
  }

  async queryBlockSearch(request: QueryBlockSearchRequest): Promise<QueryBlockSearchResponse> {
    this.logger.log(
      `packet_src_channel = ${request.packet_src_channel}, packet_sequence=${request.packet_sequence}`,
      'QueryBlockSearch',
    );
    try {
      const { packet_sequence, packet_src_channel: srcChannelId, limit, page } = request;
      const handlerAuthToken = this.configService.get('deployment').handlerAuthToken as unknown as AuthToken;
      const minChannelScriptHash = this.configService.get('deployment').validators.mintChannel.scriptHash;
      const spendAddress = this.configService.get('deployment').validators.spendChannel.address;
      if (!request.packet_src_channel.startsWith(`${CHANNEL_ID_PREFIX}-`))
        throw new GrpcInvalidArgumentException(
          `Invalid argument: "channel_id". Please use the prefix "${CHANNEL_ID_PREFIX}-"`,
        );
      const channelId = srcChannelId.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');

      const channelTokenName = this.lucidService.generateTokenName(
        handlerAuthToken,
        CHANNEL_TOKEN_PREFIX,
        BigInt(channelId),
      );
      const utxosOfChannel = await this.dbService.findUtxosByPolicyIdAndPrefixTokenName(
        minChannelScriptHash,
        channelTokenName,
      );
      let blockResults: ResultBlockSearch[] = await Promise.all(
        utxosOfChannel.map(async (utxo) => {
          let redeemers = await this.dbService.getRedeemersByTxIdAndMintScriptOrSpendAddr(
            utxo.txId.toString(),
            minChannelScriptHash,
            spendAddress,
          );
          redeemers = redeemers.filter(
            (redeemer) => redeemer.data !== REDEEMER_EMPTY_DATA && redeemer.data.length > 10,
          );
          let isMatched = false;
          for (const redeemer of redeemers) {
            if (redeemer.type !== REDEEMER_TYPE.SPEND) continue;
            const spendRedeemer = decodeSpendChannelRedeemer(redeemer.data, this.lucidService.LucidImporter);
            let packet: Packet = null;
            if (spendRedeemer['RecvPacket']) packet = spendRedeemer['RecvPacket']?.packet as unknown as Packet;
            if (spendRedeemer['AcknowledgePacket'])
              packet = spendRedeemer['AcknowledgePacket']?.packet as unknown as Packet;
            if (spendRedeemer['TimeoutPacket']) packet = spendRedeemer['TimeoutPacket']?.packet as unknown as Packet;
            if (spendRedeemer['SendPacket']) packet = spendRedeemer['SendPacket']?.packet as unknown as Packet;
            if (!packet) continue;
            if (packet.sequence === BigInt(packet_sequence)) {
              isMatched = true;
              break;
            }
          }
          if (!isMatched) return null;

          return {
            block_id: utxo.blockId,
            block: {
              height: utxo.blockNo,
            },
          } as unknown as ResultBlockSearch;
        }),
      );
      blockResults = blockResults.filter((e) => e);
      let blockResultsResp = blockResults;
      if (blockResults.length > limit) {
        const offset = page <= 0 ? 0 : limit * (page - 1n);
        const from = parseInt(offset.toString());
        const to = parseInt(offset.toString()) + parseInt(limit.toString());
        blockResultsResp = blockResults.slice(from, to);
      }

      const responseBlockSearch: QueryBlockSearchResponse = {
        blocks: blockResultsResp,
        total_count: blockResultsResp.length,
      } as unknown as QueryBlockSearchResponse;

      return responseBlockSearch;
    } catch (error) {
      console.error(error);

      this.logger.error(error.message, 'queryChannel');
      throw new GrpcInternalException(error.message);
    }
  }

  async queryTransactionByHash(request: QueryTransactionByHashRequest): Promise<QueryTransactionByHashResponse> {
    this.logger.log(`hash = ${request.hash}`, 'queryTransactionByHash');
    const { hash } = request;
    if (!hash) throw new GrpcInvalidArgumentException(`Invalid argument: "hash" must be provided`);

    const tx = await this.dbService.findTxByHash(hash);
    if (!tx) {
      throw new GrpcNotFoundException(`Not found: "hash" ${hash} not found`);
    }
    this.logger.log(`found tx for hash = ${request.hash}`, 'queryTransactionByHash');

    // get create_client events from tx
    const authOrClientUTxos = await this.dbService.findUtxoClientOrAuthHandler(tx.height);
    let createClientEvent = null;
    if (authOrClientUTxos.length) {
      const txsAuthOrClientsResults = await this._parseEventClient(authOrClientUTxos);
      createClientEvent = txsAuthOrClientsResults.find((e) => e.events[0].type === EVENT_TYPE_CLIENT.CREATE_CLIENT);
    }

    this.logger.log(
      `create client events related to tx hash = ${request.hash} createClientEvent = ${createClientEvent}`,
      'queryTransactionByHash',
    );

    const response: QueryTransactionByHashResponse = {
      hash: tx.hash,
      height: tx.height,
      gas_fee: tx.gas_fee,
      tx_size: tx.tx_size,
      events: createClientEvent ? createClientEvent.events : [],
    } as unknown as QueryTransactionByHashResponse;
    return response;
  }

  async queryIBCHeader(request: QueryIBCHeaderRequest): Promise<QueryIBCHeaderResponse> {
    this.logger.log(`height = ${request.height}`, 'queryIBCHeader');
    const { height } = request;
    if (!height) {
      throw new GrpcInvalidArgumentException('Invalid argument: "height" must be provided');
    }

    // This endpoint bridges two different proof systems:
    //
    // 1) Mithril can certify transaction inclusion at a given Cardano block number.
    //    It does not certify "arbitrary ledger state" in the sense of a single global state root
    //    that a counterparty can directly use for IBC membership proofs.
    //
    // 2) In our Cardano IBC design, the commitment root (`ibc_state_root`) is stored in the inline
    //    datum of the HostState UTxO. So if we can prove "the HostState update transaction was included
    //    at height H", the counterparty can authenticate the root at height H by:
    //      - parsing the certified transaction body,
    //      - locating the HostState output (by the HostState NFT),
    //      - extracting `ibc_state_root` from the output datum.
    //
    // After the counterparty stores this authenticated root in its on-chain light client consensus state
    // for height H, membership/non-membership proofs provided by the Gateway (for clients, connections,
    // channels, packet state, etc.) can be verified against it without trusting the relayer/Gateway to
    // supply a truthful root off-chain.

    // Identify the HostState update at this height.
    //
    // The counterparty will verify:
    // - the transaction is included in the Mithril-certified transaction set for this height
    // - the transaction body hashes to `host_state_tx_hash`
    // - the output at `host_state_tx_output_index` holds the HostState NFT and carries the inline datum
    // `height` refers to the Mithril-certified height Hermes is operating on (latest stable block).
    // The HostState UTxO may not change at every certified height, so we locate the most recent
    // HostState output at or before the certified snapshot height we are actually going to use.

    // This endpoint supplies the Cosmos-side Mithril light client with everything
    // it needs to authenticate Cardano's IBC commitment root at `height`:
    // - a Mithril transaction snapshot certificate (trust anchor)
    // - a Mithril inclusion proof for the HostState update transaction
    // - the HostState transaction body CBOR + output index so the client can extract `ibc_state_root`
    //
    // TODO(ibc): Support heights where the HostState does not change (root carried forward),
    // and ensure the selected HostState output is the one live at end-of-block if multiple
    // updates occur within a single block.
    // Note: Use the HTTP Mithril API for listing artifacts and fetching certificates.
    //
    // The WASM mithril client performs strict JSON deserialization which can break if our
    // local aggregator version changes its certificate JSON shape (we've observed runtime
	    // errors like "missing field `beacon`"). For the Gateway's purpose (transporting
	    // Mithril data to the Cosmos-side light client), we only need the raw certificate payload.
	    const mithrilStakeDistributionsList = await this.mithrilService.getMostRecentMithrilStakeDistributions();
	    if (!mithrilStakeDistributionsList?.length) {
	      throw new GrpcNotFoundException('Not found: no Mithril stake distributions available');
	    }

	    // Mithril stake distribution certificate chain (epoch catch-up).
	    //
    // The Cosmos-side Mithril light client verifies certificate chains epoch-by-epoch.
    // If the client is updated after missing one or more epochs, it needs the intervening
    // stake distribution certificates in order to verify the `previous_hash` chain.
    //
    // The Gateway includes a bounded list of previous stake distribution certificates so the
    // light client can "catch up" across epochs in a single update.
    const stakeDistributionByCertificateHash = new Map<string, any>();
	    for (const stakeDistribution of mithrilStakeDistributionsList) {
	      if (stakeDistribution?.certificate_hash) {
	        stakeDistributionByCertificateHash.set(stakeDistribution.certificate_hash, stakeDistribution);
	      }
	    }

    // IMPORTANT: Mithril `cardano-transaction` proofs are currently served against the latest
    // available CardanoTransactions snapshot (as exposed by the aggregator).
    //
    // If we pair:
    // - a TransactionSnapshot at height H, with
    // - a proof computed against a different snapshot height,
    // then the Cosmos-side Mithril light client will reject the update with a merkle root mismatch.
    //
    // Therefore we align the header's TransactionSnapshot + certificate to the snapshot referenced
    // by the returned proof.
    const listSnapshots = await this.mithrilService.getCardanoTransactionsSetSnapshot();
    const latestSnapshot = listSnapshots[0];
    if (!latestSnapshot) {
      throw new GrpcNotFoundException('Not found: no Mithril transaction snapshots available');
    }

    // We always anchor to a certified snapshot height. If the caller requested a future height,
    // fail early (this matches the expectation that "height" is a Mithril-certified height).
    if (BigInt(height) > BigInt(latestSnapshot.block_number)) {
      throw new GrpcNotFoundException(`Not found: "height" ${height} not found`);
    }

    // Start from the latest certified height (proof endpoint certifies against latest).
    let snapshot = latestSnapshot;
    let hostStateUtxo = await this.dbService.findHostStateUtxoAtOrBeforeBlockNo(BigInt(snapshot.block_number));
    let hostStateTxProof: any;

    // Ensure snapshot/proof/HostState tx are mutually consistent (best-effort, bounded attempts).
    for (let attempt = 0; attempt < 2; attempt++) {
      hostStateTxProof = await this.mithrilService.getProofsCardanoTransactionList([hostStateUtxo.txHash]);
      const proofSnapshotHeight = hostStateTxProof?.latest_block_number ?? snapshot.block_number;
      const proofCertificateHash = hostStateTxProof?.certificate_hash;

      const snapshotForProof =
        listSnapshots.find((s) => BigInt(s.block_number) === BigInt(proofSnapshotHeight)) ??
        (proofCertificateHash
          ? listSnapshots.find((s) => s.certificate_hash === proofCertificateHash)
          : undefined);

      if (!snapshotForProof) {
        throw new GrpcNotFoundException(`Not found: Mithril transaction snapshot for proof height ${proofSnapshotHeight} not found`);
      }

      snapshot = snapshotForProof;
      const hostStateAtSnapshot = await this.dbService.findHostStateUtxoAtOrBeforeBlockNo(BigInt(snapshot.block_number));
      if (hostStateAtSnapshot.txHash === hostStateUtxo.txHash) {
        hostStateUtxo = hostStateAtSnapshot;
        break;
      }
      hostStateUtxo = hostStateAtSnapshot;
    }

	    const snapshotCertificate = await this.mithrilService.getCertificateByHash(snapshot.certificate_hash);
	    const hostStateTxProofBytes = Buffer.from(JSON.stringify(hostStateTxProof), 'utf8');

	    // Align the stake distribution certificate with the chosen transaction snapshot.
	    //
	    // The Cosmos-side verifier expects:
	    // - TransactionSnapshotCertificate.previous_hash == MithrilStakeDistributionCertificate.hash
	    // - Both certificates to refer to the same epoch progression.
	    const stakeDistributionCertHash = snapshotCertificate.previous_hash;
	    if (!stakeDistributionCertHash) {
	      throw new GrpcNotFoundException('Not found: transaction snapshot certificate is missing previous_hash');
	    }

	    const mithrilStakeDistribution = stakeDistributionByCertificateHash.get(stakeDistributionCertHash);
	    if (!mithrilStakeDistribution) {
	      throw new GrpcNotFoundException(
	        `Not found: no Mithril stake distribution found for certificate ${stakeDistributionCertHash}`,
	      );
	    }
	    const distributionCertificate = await this.mithrilService.getCertificateByHash(stakeDistributionCertHash);

	    // Build a bounded chain of previous stake distribution certificates to support epoch catch-up.
	    const previousMithrilStakeDistributionCertificates: MithrilCertificate[] = [];
	    let previousCertificateHash = distributionCertificate.previous_hash;
	    const maxPreviousCertificates = 20;
	    for (let depth = 0; depth < maxPreviousCertificates && previousCertificateHash; depth++) {
	      const previousCertificate = await this.mithrilService.getCertificateByHash(previousCertificateHash);
	      const previousStakeDistribution = stakeDistributionByCertificateHash.get(previousCertificate.hash);

	      if (!previousStakeDistribution) {
	        this.logger.warn(
	          `Mithril stake distribution artifact missing for certificate ${previousCertificate.hash}; stopping certificate chain construction`,
	          'queryIBCHeader',
	        );
	        break;
	      }

	      previousMithrilStakeDistributionCertificates.push(
	        normalizeMithrilStakeDistributionCertificate(previousStakeDistribution, previousCertificate),
	      );

	      previousCertificateHash = previousCertificate.previous_hash;
	    }

	    // Older -> newer as expected by the Cosmos-side verifier (it may still sort defensively).
	    previousMithrilStakeDistributionCertificates.reverse();

    const hostStateTxHash = hostStateUtxo.txHash;

    // Fetch the block body that contains the HostState transaction and locate the transaction body CBOR.
    //
    // The HostState transaction can occur earlier than the requested certified height (root carried forward),
    // so we must scan the block where that transaction actually appears.
    const block = await this.dbService.findBlockByHeight(BigInt(hostStateUtxo.blockNo));
    const blockHeader = await this.miniProtocalsService.fetchBlockHeader(block.hash, BigInt(block.slot));
    if (!blockHeader?.bodyCbor) {
      throw new GrpcInternalException(`Unable to fetch block body for height ${height.toString()}`);
    }
    const hostStateTxBodyHex = this.findTxBodyHexInBlock(blockHeader.bodyCbor, hostStateTxHash);
    const hostStateTxBodyCbor = Buffer.from(hostStateTxBodyHex, 'hex');

    const mithrilHeader: MithrilHeader = {
      mithril_stake_distribution: normalizeMithrilStakeDistribution(mithrilStakeDistribution, distributionCertificate),
      mithril_stake_distribution_certificate: normalizeMithrilStakeDistributionCertificate(
        mithrilStakeDistribution,
        distributionCertificate,
      ),
      transaction_snapshot: {
        merkle_root: snapshot.merkle_root,
        hash: snapshot.hash,
        certificate_hash: snapshot.certificate_hash,
        epoch: BigInt(snapshotCertificate.epoch),
        block_number: BigInt(snapshot.block_number),
        created_at: snapshot.created_at,
      },
      transaction_snapshot_certificate: normalizeMithrilStakeDistributionCertificate(
        {
          epoch: snapshot.epoch,
          hash: snapshot.hash,
          certificate_hash: snapshot.certificate_hash,
          created_at: snapshot.created_at,
        },
        snapshotCertificate,
      ),
      previous_mithril_stake_distribution_certificates: previousMithrilStakeDistributionCertificates,

      host_state_tx_hash: hostStateTxHash,
      host_state_tx_body_cbor: hostStateTxBodyCbor,
      host_state_tx_output_index: hostStateUtxo.outputIndex,
      host_state_tx_proof: hostStateTxProofBytes,
    };

    const mithrilHeaderAny: Any = {
      type_url: '/ibc.lightclients.mithril.v1.MithrilHeader',
      value: MithrilHeader.encode(mithrilHeader).finish(),
    };
    const response: QueryIBCHeaderResponse = {
      header: mithrilHeaderAny,
    };
    return response;
  }

  private findTxBodyHexInBlock(blockBodyCborHex: string, txHashHex: string): string {
    const decoded = cbor.decodeFirstSync(Buffer.from(blockBodyCborHex, 'hex'));
    if (!Array.isArray(decoded)) {
      throw new Error('Unexpected block body format: expected CBOR array');
    }

    const wanted = txHashHex.toLowerCase();
    for (const entry of decoded) {
      if (!Array.isArray(entry) || entry.length < 1) continue;
      const txBodyHex = entry[0];
      if (typeof txBodyHex !== 'string' || txBodyHex.length === 0) continue;

      const computedHash = hash_transaction(TransactionBody.from_cbor_hex(txBodyHex)).to_hex().toLowerCase();
      if (computedHash === wanted) {
        return txBodyHex;
      }
    }

    throw new Error(`Transaction body not found in block for tx hash ${txHashHex}`);
  }

  /**
   * Query the IBC state root at a specific height
   * This is used by the Mithril light client on Cosmos to retrieve the ICS-23 Merkle root
   * that has been certified by Mithril snapshot inclusion
   * 
   * Architecture:
   * - Locates the HostState UTxO at or before the requested block height via DbSync
   * - Extracts ibc_state_root from the inline datum
   *
   * IMPORTANT:
   * - This method is height-specific, but on its own it is NOT an authenticated root source.
   *   It relies on DbSync being correct and in sync.
   * - For an authenticated root (bound to Mithril-certified data), use the IBC Header query
   *   which returns the HostState update tx body + Mithril inclusion proof.
   * 
   * @param height - The Cardano block height to query
   * @returns The IBC state root (32-byte hex string) at the specified height
   */
  async queryIBCStateRoot(height: number): Promise<{ root: string, height: number }> {
    this.logger.log(`Querying IBC state root at height ${height}`);
    
    try {
      if (!Number.isFinite(height) || !Number.isInteger(height) || height <= 0) {
        throw new GrpcInvalidArgumentException('Invalid argument: "height" must be a positive integer');
      }

      // DbSync can answer "HostState UTxO at or before block height" deterministically.
      // This supports the common case where the HostState/root is carried forward across blocks.
      const hostStateUtxo = await this.dbService.findHostStateUtxoAtOrBeforeBlockNo(BigInt(height));
      if (!hostStateUtxo?.datum) {
        throw new GrpcInternalException('IBC infrastructure error: HostState UTxO missing datum');
      }

      const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
      const root = hostStateDatum.state.ibc_state_root;
      
      return {
        root: root,
        // The root is taken from the HostState UTxO that was live at (or before) the requested height.
        // Return the actual height we sourced it from for transparency.
        height: hostStateUtxo.blockNo ?? height,
      };
    } catch (error) {
      this.logger.error(`Failed to query IBC state root at height ${height}: ${error?.message ?? error}`);
      if (error instanceof GrpcNotFoundException || error instanceof GrpcInvalidArgumentException) {
        throw error;
      }
      throw new GrpcInternalException(`Failed to query IBC state root: ${error.message}`);
    }
  }

  /**
   * Query a denom trace by its hash
   */
  async queryDenomTrace(request: QueryDenomTraceRequest): Promise<QueryDenomTraceResponse> {
    this.logger.log(`Querying denom trace for hash: ${request.hash}`);
    
    try {
      if (!request.hash) {
        throw new GrpcInvalidArgumentException('Invalid argument: "hash" must be provided');
      }

      const denomTrace = await this.denomTraceService.findByHash(request.hash);
      
      if (!denomTrace) {
        throw new GrpcNotFoundException(`Denom trace not found for hash: ${request.hash}`);
      }

      const response: QueryDenomTraceResponse = {
        denom_trace: {
          path: denomTrace.path,
          base_denom: denomTrace.base_denom,
        },
      };

      return response;
    } catch (error) {
      this.logger.error(`Failed to query denom trace: ${error.message}`);
      if (error instanceof GrpcNotFoundException || error instanceof GrpcInvalidArgumentException) {
        throw error;
      }
      throw new GrpcInternalException(`Failed to query denom trace: ${error.message}`);
    }
  }

  /**
   * Query all denom traces with optional pagination
   */
  async queryDenomTraces(request: QueryDenomTracesRequest): Promise<QueryDenomTracesResponse> {
    this.logger.log('Querying all denom traces');
    
    try {
      const pagination = request.pagination ? { offset: Number(request.pagination.offset || 0) } : undefined;
      const denomTraces = await this.denomTraceService.findAll(pagination);
      
      const response: QueryDenomTracesResponse = {
        denom_traces: denomTraces.map(trace => ({
          path: trace.path,
          base_denom: trace.base_denom,
        })),
        pagination: {
          next_key: new Uint8Array(),
          total: BigInt(await this.denomTraceService.getCount()),
        },
      };

      return response;
    } catch (error) {
      this.logger.error(`Failed to query denom traces: ${error.message}`);
      throw new GrpcInternalException(`Failed to query denom traces: ${error.message}`);
    }
  }
}
