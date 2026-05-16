import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LucidService } from '@shared/modules/lucid/lucid.service';
import {
  QueryPacketAcknowledgementRequest,
  QueryPacketAcknowledgementResponse,
  QueryPacketAcknowledgementsRequest,
  QueryPacketAcknowledgementsResponse,
  QueryPacketCommitmentRequest,
  QueryPacketCommitmentResponse,
  QueryPacketCommitmentsRequest,
  QueryPacketCommitmentsResponse,
  QueryPacketReceiptRequest,
  QueryPacketReceiptResponse,
  QueryUnreceivedPacketsRequest,
  QueryUnreceivedPacketsResponse,
  QueryUnreceivedAcksRequest,
  QueryUnreceivedAcksResponse,
  QueryProofUnreceivedPacketsRequest,
  QueryProofUnreceivedPacketsResponse,
  QueryNextSequenceReceiveRequest,
  QueryNextSequenceReceiveResponse,
} from '@plus/proto-types/build/ibc/core/channel/v1/query';
import { decodePaginationKey, generatePaginationKey, getPaginationParams } from '../../shared/helpers/pagination';
import { ACK_RESULT, CHANNEL_ID_PREFIX, CHANNEL_TOKEN_PREFIX, REDEEMER_EMPTY_DATA, REDEEMER_TYPE } from '../../constant';
import { ChannelDatum, decodeChannelDatum } from '../../shared/types/channel/channel-datum';
import { PaginationKeyDto } from '../dtos/pagination.dto';
import { bytesFromBase64 } from '@plus/proto-types/build/helpers';
import {
  validQueryPacketAcknowledgementParam,
  validQueryPacketAcknowledgementsParam,
  validQueryPacketCommitmentParam,
  validQueryPacketCommitmentsParam,
  validQueryPacketReceiptParam,
  validQueryUnreceivedPacketsParam,
  validQueryUnreceivedAcksParam,
  validQueryProofUnreceivedPacketsParam,
  validQueryNextSequenceReceiveParam,
} from '../helpers/channel.validate';
import { validPagination } from '../helpers/helper';
import { convertHex2String, convertString2Hex, hashSHA256 } from '../../shared/helpers/hex';
import { GrpcInvalidArgumentException, GrpcInternalException, GrpcNotFoundException } from '~@/exception/grpc_exceptions';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { alignTreeWithChain, getCurrentTree, isTreeAligned } from '../../shared/helpers/ibc-state-root';
import { serializeExistenceProof, serializeNonExistenceProof } from '../../shared/helpers/ics23-proof-serialization';
import { HostStateDatum } from '../../shared/types/host-state-datum';
import { HISTORY_SERVICE, HistoryService } from './history.service';
import { resolveProofContextForQuery, resolveProofHeightForCurrentRoot } from './proof-context';
import { IbcTreeCacheService } from '../../shared/services/ibc-tree-cache.service';
import { ProofQueryOptions } from '../helpers/query-height';
import { decodeSpendChannelRedeemer } from '../../shared/types/channel/channel-redeemer';
import { decodeIBCModuleRedeemer } from '../../shared/types/port/ibc_module_redeemer';
import {
  acknowledgementCommitmentFromResponse,
  acknowledgementHexFromResponse,
} from '../../shared/helpers/acknowledgement';

const SUCCESS_ACKNOWLEDGEMENT_HEX = convertString2Hex(JSON.stringify({ result: ACK_RESULT }));
const SUCCESS_ACKNOWLEDGEMENT_COMMITMENT = hashSHA256(SUCCESS_ACKNOWLEDGEMENT_HEX).toLowerCase();

@Injectable()
export class PacketService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    @Inject(MithrilService) private mithrilService: MithrilService,
    @Inject(HISTORY_SERVICE) private historyService: HistoryService,
    @Inject(IbcTreeCacheService) private ibcTreeCacheService: IbcTreeCacheService,
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

  private async getProofHeight(): Promise<bigint> {
    return resolveProofHeightForCurrentRoot({
      logger: this.logger,
      lucidService: this.lucidService,
      mithrilService: this.mithrilService,
      historyService: this.historyService,
      context: 'queryPacketProof',
      lightClientMode:
        this.configService.get<'mithril' | 'stake-weighted-stability'>('cardanoLightClientMode') ||
        'stake-weighted-stability',
    });
  }

  private async getQueryHeight(): Promise<bigint> {
    try {
      const height = await this.getProofHeight();
      return height > 0n ? height : 1n;
    } catch {
      // Avoid returning an invalid IBC height (revision_height=0), which Hermes rejects.
      return 1n;
    }
  }

  private async getProofContext(requestedHeight?: bigint) {
    const lightClientMode =
      this.configService.get<'mithril' | 'stake-weighted-stability'>('cardanoLightClientMode') ||
      'stake-weighted-stability';

    return resolveProofContextForQuery({
      logger: this.logger,
      lucidService: this.lucidService,
      mithrilService: this.mithrilService,
      historyService: this.historyService,
      ibcTreeCacheService: this.ibcTreeCacheService,
      context: 'queryPacketProof',
      requestedHeight,
      lightClientMode,
    });
  }

  private async findChannelUtxo(channelTokenUnit: string) {
    const deploymentConfig = this.configService.get('deployment');
    return this.lucidService.findUtxoAtWithUnit(
      deploymentConfig.validators.spendChannel.address,
      channelTokenUnit,
    );
  }

  private async getChannelUtxo(channelId: string, queryHeight?: bigint) {
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    return queryHeight
      ? this.historyService.findUtxoByUnitAtOrBeforeBlockNo(channelTokenUnit, queryHeight)
      : this.findChannelUtxo(channelTokenUnit);
  }

  private packetMatchesAcknowledgementQuery(
    packet: any,
    params: {
      portId: string;
      channelId: string;
      sequence: bigint;
      counterpartyPortId: string;
      counterpartyChannelId: string;
    },
  ): boolean {
    const packetSequence = BigInt(packet.sequence);
    const destinationPort = convertHex2String(packet.destination_port);
    const destinationChannel = convertHex2String(packet.destination_channel);
    const sourcePort = convertHex2String(packet.source_port);
    const sourceChannel = convertHex2String(packet.source_channel);

    return (
      packetSequence === params.sequence &&
      destinationPort === params.portId &&
      destinationChannel === `${CHANNEL_ID_PREFIX}-${params.channelId}` &&
      (!params.counterpartyPortId || sourcePort === params.counterpartyPortId) &&
      (!params.counterpartyChannelId || sourceChannel === params.counterpartyChannelId)
    );
  }

  private findMatchingRecvPacketRedeemer(
    redeemers: Array<{ type: string; data: string }>,
    params: {
      portId: string;
      channelId: string;
      sequence: bigint;
      counterpartyPortId: string;
      counterpartyChannelId: string;
    },
  ): boolean {
    for (const redeemer of redeemers.filter((candidate) => candidate.type === REDEEMER_TYPE.SPEND)) {
      try {
        const channelRedeemer = decodeSpendChannelRedeemer(redeemer.data, this.lucidService.LucidImporter);
        const packet = (channelRedeemer as any).RecvPacket?.packet;
        if (packet && this.packetMatchesAcknowledgementQuery(packet, params)) {
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }

  private findAcknowledgementHexInModuleRedeemers(
    redeemers: Array<{ type: string; data: string }>,
    committedAcknowledgement: string,
  ): string | null {
    const normalizedCommitment = committedAcknowledgement.toLowerCase();

    for (const redeemer of redeemers.filter((candidate) => candidate.type === REDEEMER_TYPE.SPEND)) {
      try {
        const moduleRedeemer = decodeIBCModuleRedeemer(redeemer.data, this.lucidService.LucidImporter) as any;
        const callbacks = Array.isArray(moduleRedeemer.Callback) ? moduleRedeemer.Callback : [];
        for (const callback of callbacks) {
          const acknowledgementResponse = callback.OnRecvPacket?.acknowledgement?.response;
          if (!acknowledgementResponse) continue;

          const acknowledgementCommitment = acknowledgementCommitmentFromResponse(acknowledgementResponse).toLowerCase();
          if (acknowledgementCommitment === normalizedCommitment) {
            return acknowledgementHexFromResponse(acknowledgementResponse);
          }
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async findRawAcknowledgementHexFromHistory(params: {
    channelId: string;
    portId: string;
    sequence: bigint;
    committedAcknowledgement: string;
    channelDatum: ChannelDatum;
    proofHeight?: bigint;
  }): Promise<string | null> {
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(params.channelId));
    const utxos = await this.historyService.findUtxosByPolicyIdAndPrefixTokenName(
      mintChannelPolicyId,
      channelTokenName || CHANNEL_TOKEN_PREFIX,
    );
    const counterpartyPortId = convertHex2String(params.channelDatum.state.channel.counterparty.port_id);
    const counterpartyChannelId = convertHex2String(params.channelDatum.state.channel.counterparty.channel_id);
    const seenTxs = new Set<string>();

    for (const utxo of utxos) {
      if (params.proofHeight !== undefined && BigInt(utxo.blockNo) > params.proofHeight) continue;
      const normalizedTxHash = utxo.txHash.toLowerCase();
      if (seenTxs.has(normalizedTxHash)) continue;
      seenTxs.add(normalizedTxHash);

      const evidence = await this.historyService.findTransactionEvidenceByHash(normalizedTxHash);
      if (!evidence) continue;

      const redeemers = evidence.redeemers.filter((redeemer) => redeemer.data !== REDEEMER_EMPTY_DATA);
      const recvPacketMatches = this.findMatchingRecvPacketRedeemer(redeemers, {
        portId: params.portId,
        channelId: params.channelId,
        sequence: params.sequence,
        counterpartyPortId,
        counterpartyChannelId,
      });
      if (!recvPacketMatches) continue;

      const acknowledgementHex = this.findAcknowledgementHexInModuleRedeemers(
        redeemers,
        params.committedAcknowledgement,
      );
      if (acknowledgementHex) return acknowledgementHex;
    }

    return null;
  }

  private async resolveAcknowledgementHex(params: {
    channelId: string;
    portId: string;
    sequence: bigint;
    committedAcknowledgement: string;
    channelDatum: ChannelDatum;
    proofHeight?: bigint;
  }): Promise<string> {
    const normalizedCommitment = params.committedAcknowledgement.toLowerCase();
    if (normalizedCommitment === SUCCESS_ACKNOWLEDGEMENT_COMMITMENT) {
      return SUCCESS_ACKNOWLEDGEMENT_HEX;
    }

    const acknowledgementHex = await this.findRawAcknowledgementHexFromHistory(params);
    if (acknowledgementHex) return acknowledgementHex;

    throw new GrpcInternalException(
      `IBC acknowledgement bytes for ${params.portId}/channel-${params.channelId}/${params.sequence.toString()} could not be resolved from history; only commitment ${params.committedAcknowledgement} is stored on-chain`,
    );
  }

  async queryPacketAcknowledgement(
    request: QueryPacketAcknowledgementRequest,
    options: ProofQueryOptions = {},
  ): Promise<QueryPacketAcknowledgementResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketAcknowledgementParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`, 'QueryPacketAcknowledgement');

    const proofContext = await this.getProofContext(options.queryHeight);
    const utxo = await this.getChannelUtxo(channelId, proofContext.historical ? proofContext.proofHeight : undefined);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetAcknowledgement = channelDatumDecoded.state.packet_acknowledgement.get(BigInt(sequence));
    if (!packetAcknowledgement) {
      throw new GrpcNotFoundException("Not found: 'Packet Acknowledgement' not found");
    }
    const acknowledgementHex = await this.resolveAcknowledgementHex({
      channelId,
      portId,
      sequence: BigInt(sequence),
      committedAcknowledgement: packetAcknowledgement,
      channelDatum: channelDatumDecoded,
      proofHeight: proofContext.historical ? proofContext.proofHeight : undefined,
    });

    if (!proofContext.historical) {
      await this.ensureTreeAligned();
    }

    // Generate ICS-23 proof from the IBC state tree
    // Path: acks/ports/{portId}/channels/{channelId}/sequences/{sequence}
    const ibcPath = `acks/ports/${portId}/channels/channel-${channelId}/sequences/${sequence}`;
    const tree = proofContext.historical ? proofContext.tree : getCurrentTree();
    let ackProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      ackProof = serializeExistenceProof(existenceProof);

      this.logger.log(
        `Generated ICS-23 proof for packet ack ${channelId}/${sequence}, proof size: ${ackProof.length} bytes`,
      );
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryPacketAcknowledgementResponse = {
      acknowledgement: acknowledgementHex,
      proof: ackProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofContext.proofHeight,
      },
    } as unknown as QueryPacketAcknowledgementResponse;
    return response;
  }

  async queryPacketAcknowledgements(
    request: QueryPacketAcknowledgementsRequest,
  ): Promise<QueryPacketAcknowledgementsResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      pagination: paginationReq,
    } = validQueryPacketAcknowledgementsParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryPacketAcknowledgements');
    const pagination = getPaginationParams(validPagination(paginationReq));
    const {
      'pagination.key': key,
      'pagination.limit': limit,
      'pagination.count_total': count_total,
      'pagination.reverse': reverse,
    } = pagination;
    let { 'pagination.offset': offset } = pagination;
    if (key) offset = decodePaginationKey(key);

    const utxo = await this.getChannelUtxo(channelId);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetAcknowledgementSeqs = [...channelDatumDecoded.state.packet_acknowledgement.keys()];

    let nextKey = null;
    let packetAckSeqs = reverse ? packetAcknowledgementSeqs.reverse() : packetAcknowledgementSeqs;
    if (packetAckSeqs.length > +limit) {
      const from = parseInt(offset);
      const to = parseInt(offset) + parseInt(limit);
      packetAckSeqs = packetAckSeqs.slice(from, to);

      const pageKeyDto: PaginationKeyDto = {
        offset: to,
      };
      nextKey = to < packetAcknowledgementSeqs.length ? generatePaginationKey(pageKeyDto) : '';
    }

    const queryHeight = await this.getQueryHeight();
    const response: QueryPacketAcknowledgementsResponse = {
      acknowledgements: packetAckSeqs.map((seq) => ({
        /** channel port identifier. */
        port_id: convertHex2String(channelDatumDecoded.port),
        /** channel unique identifier. */
        channel_id: `${CHANNEL_ID_PREFIX}-${request.channel_id}`,
        /** packet sequence. */
        sequence: seq.toString(),
        /** embedded data that represents packet state. */
        data: bytesFromBase64(channelDatumDecoded.state.packet_acknowledgement.get(seq)),
      })),
      /** pagination response */
      pagination: {
        next_key: nextKey,
        total: count_total ? packetAckSeqs.length : 0,
      },
      /** query block height */
      height: {
        revision_number: BigInt(0), // Cardano uses fixed revision 0; semantic height is Mithril snapshot block_number.
        revision_height: queryHeight,
      },
    } as unknown as QueryPacketAcknowledgementsResponse;
    return response;
  }

  async queryPacketCommitment(
    request: QueryPacketCommitmentRequest,
    options: ProofQueryOptions = {},
  ): Promise<QueryPacketCommitmentResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketCommitmentParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`,
      'QueryPacketCommitmentRequest',
    );

    const proofContext = await this.getProofContext(options.queryHeight);
    const utxo = await this.getChannelUtxo(channelId, proofContext.historical ? proofContext.proofHeight : undefined);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetCommitment = channelDatumDecoded.state.packet_commitment.get(BigInt(sequence));
    // if (!packetCommitment) throw new GrpcNotFoundException("Not found: 'Packet Commitment' not found");
    if (!proofContext.historical) {
      await this.ensureTreeAligned();
    }

    // Generate ICS-23 proof from the IBC state tree
    // Path: commitments/ports/{portId}/channels/{channelId}/sequences/{sequence}
    const ibcPath = `commitments/ports/${portId}/channels/channel-${channelId}/sequences/${sequence}`;
    const tree = proofContext.historical ? proofContext.tree : getCurrentTree();
    let commitmentProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      commitmentProof = serializeExistenceProof(existenceProof);

      this.logger.log(
        `Generated ICS-23 proof for packet commitment ${channelId}/${sequence}, proof size: ${commitmentProof.length} bytes`,
      );
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryPacketCommitmentResponse = {
      commitment: packetCommitment,
      proof: commitmentProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofContext.proofHeight,
      },
    } as unknown as QueryPacketCommitmentResponse;
    return response;
  }

  async queryPacketCommitments(request: QueryPacketCommitmentsRequest): Promise<QueryPacketCommitmentsResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      pagination: paginationReq,
    } = validQueryPacketCommitmentsParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryPacketCommitments');
    const pagination = getPaginationParams(validPagination(paginationReq));
    const {
      'pagination.key': key,
      'pagination.limit': limit,
      'pagination.count_total': count_total,
      'pagination.reverse': reverse,
    } = pagination;
    let { 'pagination.offset': offset } = pagination;
    if (key) offset = decodePaginationKey(key);

    const utxo = await this.getChannelUtxo(channelId);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetCommitmentSeqs = [...channelDatumDecoded.state.packet_commitment.keys()];

    let nextKey = null;
    let packetCmmSeqs = reverse ? packetCommitmentSeqs.reverse() : packetCommitmentSeqs;
    if (packetCmmSeqs.length > +limit) {
      const from = parseInt(offset);
      const to = parseInt(offset) + parseInt(limit);
      packetCmmSeqs = packetCmmSeqs.slice(from, to);

      const pageKeyDto: PaginationKeyDto = {
        offset: to,
      };
      nextKey = to < packetCommitmentSeqs.length ? generatePaginationKey(pageKeyDto) : '';
    }

    const queryHeight = await this.getQueryHeight();
    const response: QueryPacketCommitmentsResponse = {
      commitments: packetCmmSeqs.map((seq) => ({
        /** channel port identifier. */
        port_id: convertHex2String(channelDatumDecoded.port),
        /** channel unique identifier. */
        channel_id: `${CHANNEL_ID_PREFIX}-${request.channel_id}`,
        /** packet sequence. */
        sequence: seq.toString(),
        /** embedded data that represents packet state. */
        data: bytesFromBase64(channelDatumDecoded.state.packet_commitment.get(seq)),
      })),
      /** pagination response */
      pagination: {
        next_key: nextKey,
        total: count_total ? packetCmmSeqs.length : 0,
      },
      /** query block height */
      height: {
        revision_number: BigInt(0), // Cardano uses fixed revision 0; semantic height is Mithril snapshot block_number.
        revision_height: queryHeight,
      },
    } as unknown as QueryPacketCommitmentsResponse;
    return response;
  }

  // write api service logic api grpc PacketReceiptb with request params QueryPacketReceiptRequest and return Promise QueryPacketReceiptResponse
  async queryPacketReceipt(
    request: QueryPacketReceiptRequest,
    options: ProofQueryOptions = {},
  ): Promise<QueryPacketReceiptResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketReceiptParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`, 'QueryPacketReceiptRequest');

    const proofContext = await this.getProofContext(options.queryHeight);
    const utxo = await this.getChannelUtxo(channelId, proofContext.historical ? proofContext.proofHeight : undefined);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetReceipt = channelDatumDecoded.state.packet_receipt.has(BigInt(sequence));

    // if (!packetReceipt) throw new GrpcNotFoundException("Not found: 'Packet Receipt' not found");
    if (!proofContext.historical) {
      await this.ensureTreeAligned();
    }

    // Generate ICS-23 proof from the IBC state tree
    // Path: receipts/ports/{portId}/channels/{channelId}/sequences/{sequence}
    // If received=true: ExistenceProof showing receipt marker exists
    // If received=false: NonExistenceProof showing receipt marker doesn't exist
    const ibcPath = `receipts/ports/${portId}/channels/channel-${channelId}/sequences/${sequence}`;
    const tree = proofContext.historical ? proofContext.tree : getCurrentTree();
    let receiptProof: Buffer;
    try {
      if (packetReceipt) {
        const existenceProof = tree.generateProof(ibcPath);
        receiptProof = serializeExistenceProof(existenceProof);
        this.logger.log(
          `Generated ICS-23 existence proof for packet receipt ${channelId}/${sequence}, proof size: ${receiptProof.length} bytes`,
        );
      } else {
        const nonExistenceProof = tree.generateNonExistenceProof(ibcPath);
        receiptProof = serializeNonExistenceProof(nonExistenceProof);
        this.logger.log(
          `Generated ICS-23 non-existence proof for packet receipt ${channelId}/${sequence}, proof size: ${receiptProof.length} bytes`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryPacketReceiptResponse = {
      received: !!packetReceipt,
      proof: receiptProof, // ICS-23 Merkle proof (existence or non-existence)
      proof_height: {
        revision_number: 0,
        revision_height: proofContext.proofHeight,
      },
    } as unknown as QueryPacketReceiptResponse;
    return response;
  }

  // write logic service function queryUnreceivedPackets
  async queryUnreceivedPackets(request: QueryUnreceivedPacketsRequest): Promise<QueryUnreceivedPacketsResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      packet_commitment_sequences: packetCommitmentSequences,
    } = validQueryUnreceivedPacketsParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, packetCommitmentSequences=${packetCommitmentSequences}`,
      'QueryUnreceivedPacketsRequest',
    );

    const utxo = await this.getChannelUtxo(channelId);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetReceiptSeqs = channelDatumDecoded.state.packet_receipt;
    const sequences = request.packet_commitment_sequences.filter((seq) => !packetReceiptSeqs.has(BigInt(seq)));

    const queryHeight = await this.getQueryHeight();
    const response: QueryUnreceivedPacketsResponse = {
      /** list of unreceived packet sequences */
      sequences: sequences,
      /** query block height */
      height: {
        revision_number: BigInt(0), // Cardano uses fixed revision 0; semantic height is Mithril snapshot block_number.
        revision_height: queryHeight,
      },
    } as unknown as QueryUnreceivedPacketsResponse;
    return response;
  }

  async queryUnreceivedAcks(request: QueryUnreceivedAcksRequest): Promise<QueryUnreceivedAcksResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      packet_ack_sequences: packetAcksSequences,
    } = validQueryUnreceivedAcksParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, packetAcksSequences=${packetAcksSequences}`,
      'QueryUnreceivedAcksRequest',
    );

    const utxo = await this.getChannelUtxo(channelId);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetCommitsSeqs = channelDatumDecoded.state.packet_commitment;
    const sequences = packetAcksSequences.filter((seq) => packetCommitsSeqs.has(BigInt(seq)));

    const queryHeight = await this.getQueryHeight();
    const response: QueryUnreceivedAcksResponse = {
      /** list of unreceived packet sequences */
      sequences: sequences,
      /** query block height */
      height: {
        revision_number: BigInt(0), // Cardano uses fixed revision 0; semantic height is Mithril snapshot block_number.
        revision_height: queryHeight,
      },
    } as unknown as QueryUnreceivedAcksResponse;
    return response;
  }
  async queryProofUnreceivedPackets(
    request: QueryProofUnreceivedPacketsRequest,
  ): Promise<QueryProofUnreceivedPacketsResponse> {
    const {
      channel_id: channelId,
      port_id: portId,
      sequence,
      revision_height: revisionHeight,
    } = validQueryProofUnreceivedPacketsParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, sequence=${sequence}, revisionHeight=${revisionHeight}`,
      'QueryProofUnreceivedPacketsRequest',
    );

    const proofContext = await this.getProofContext(revisionHeight);
    const utxo = await this.getChannelUtxo(channelId, proofContext.historical ? proofContext.proofHeight : undefined);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    if (convertHex2String(channelDatumDecoded.port) !== portId) {
      throw new GrpcInvalidArgumentException(
        `Invalid port, found port ${channelDatumDecoded.port} instead of ${portId} in datum`,
      );
    }
    if (channelDatumDecoded.state.packet_receipt.has(sequence)) {
      throw new GrpcInvalidArgumentException(
        `Invalid sequence, sequence ${sequence} already exists in packet_receipt map`,
      );
    }
    if (!proofContext.historical) {
      await this.ensureTreeAligned();
    }
    // if (BigInt(proof.blockNo) > revisionHeight) {
    //   throw new GrpcInvalidArgumentException(
    //     `Invalid proof height, revision height ${revisionHeight} not match with proof height ${proof.blockNo}`,
    //   );
    // }

    // Generate ICS-23 non-existence proof from the IBC state tree
    // This proves that the receipt does NOT exist (packet is unreceived)
    // Path: receipts/ports/{portId}/channels/{channelId}/sequences/{sequence}
    const ibcPath = `receipts/ports/${portId}/channels/channel-${channelId}/sequences/${sequence}`;
    const tree = proofContext.historical ? proofContext.tree : getCurrentTree();
    let unreceivedProof: Buffer;
    try {
      const nonExistenceProof = tree.generateNonExistenceProof(ibcPath);
      unreceivedProof = serializeNonExistenceProof(nonExistenceProof);

      this.logger.log(
        `Generated ICS-23 non-existence proof for unreceived packet ${channelId}/${sequence}, proof size: ${unreceivedProof.length} bytes`,
      );
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryPacketAcknowledgementResponse = {
      proof: unreceivedProof, // ICS-23 non-existence proof
      proof_height: {
        revision_number: 0,
        revision_height: proofContext.proofHeight,
      },
    } as unknown as QueryPacketAcknowledgementResponse;
    return response;
  }
  async queryNextSequenceReceive(
    request: QueryNextSequenceReceiveRequest,
    options: ProofQueryOptions = {},
  ): Promise<QueryNextSequenceReceiveResponse> {
    const { channel_id: channelId, port_id: portId } = validQueryNextSequenceReceiveParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryNextSequenceReceiveRequest');

    const proofContext = await this.getProofContext(options.queryHeight);
    const channelUtxo = await this.getChannelUtxo(
      channelId,
      proofContext.historical ? proofContext.proofHeight : undefined,
    );
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    const nextSequenceRecv = channelDatum.state.next_sequence_recv;

    if (!proofContext.historical) {
      await this.ensureTreeAligned();
    }

    // Generate ICS-23 proof from the IBC state tree
    // Path: nextSequenceRecv/ports/{portId}/channels/{channelId}
    const ibcPath = `nextSequenceRecv/ports/${portId}/channels/channel-${channelId}`;
    const tree = proofContext.historical ? proofContext.tree : getCurrentTree();
    let nextSeqProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      nextSeqProof = serializeExistenceProof(existenceProof);

      this.logger.log(
        `Generated ICS-23 proof for next sequence receive ${channelId}, proof size: ${nextSeqProof.length} bytes`,
      );
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryNextSequenceReceiveResponse = {
      next_sequence_receive: nextSequenceRecv.toString(),
      proof: nextSeqProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofContext.proofHeight,
      },
    } as unknown as QueryNextSequenceReceiveResponse;
    return response;
  }
  async QueryNextSequenceAck(
    request: QueryNextSequenceReceiveRequest,
    options: ProofQueryOptions = {},
  ): Promise<QueryNextSequenceReceiveResponse> {
    const { channel_id: channelId, port_id: portId } = validQueryNextSequenceReceiveParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryNextSequenceAckRequest');

    const proofContext = await this.getProofContext(options.queryHeight);
    const channelUtxo = await this.getChannelUtxo(
      channelId,
      proofContext.historical ? proofContext.proofHeight : undefined,
    );
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    const nextSequenceAck = channelDatum.state.next_sequence_ack;

    if (!proofContext.historical) {
      await this.ensureTreeAligned();
    }

    // Generate ICS-23 proof from the IBC state tree
    // Path: nextSequenceAck/ports/{portId}/channels/{channelId}
    const ibcPath = `nextSequenceAck/ports/${portId}/channels/channel-${channelId}`;
    const tree = proofContext.historical ? proofContext.tree : getCurrentTree();
    let nextAckProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      nextAckProof = serializeExistenceProof(existenceProof);

      this.logger.log(
        `Generated ICS-23 proof for next sequence ack ${channelId}, proof size: ${nextAckProof.length} bytes`,
      );
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryNextSequenceReceiveResponse = {
      next_sequence_receive: nextSequenceAck.toString(),
      proof: nextAckProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofContext.proofHeight,
      },
    } as unknown as QueryNextSequenceReceiveResponse;
    return response;
  }
}
