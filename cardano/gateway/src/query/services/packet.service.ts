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
import { AuthToken } from '../../shared/types/auth-token';
import { CHANNEL_ID_PREFIX, CHANNEL_TOKEN_PREFIX } from '../../constant';
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
import { convertHex2String, fromHex, toHex } from '../../shared/helpers/hex';
import { Acknowledgement } from '@plus/proto-types/build/ibc/core/channel/v1/channel';
import { GrpcInvalidArgumentException, GrpcInternalException } from '~@/exception/grpc_exceptions';
import { MithrilService } from '../../shared/modules/mithril/mithril.service';
import { alignTreeWithChain, getCurrentTree, isTreeAligned } from '../../shared/helpers/ibc-state-root';
import { serializeExistenceProof, serializeNonExistenceProof } from '../../shared/helpers/ics23-proof-serialization';
import { HostStateDatum } from '../../shared/types/host-state-datum';

@Injectable()
export class PacketService {
  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
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

    this.logger.warn(`Tree out of sync with on-chain root ${onChainRoot.substring(0, 16)}..., rebuilding from chain...`);
    await alignTreeWithChain();
  }

  private async getProofHeight(): Promise<bigint> {
    // IBC queries that return proofs must also return the height of the commitment root those
    // proofs were built against (`proof_height`).
    //
    // In this implementation we use the latest Mithril CardanoTransactions snapshot block number.
    // This value is a Cardano block height (not a slot), and Hermes may wait until this height is
    // certified before proceeding with handshake/packet flows.
    const snapshots = await this.mithrilService.getCardanoTransactionsSetSnapshot();
    const latestSnapshot = snapshots?.[0];
    if (!latestSnapshot) {
      throw new GrpcInternalException('Mithril transaction snapshots unavailable for proof_height');
    }
    return BigInt(latestSnapshot.block_number);
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

  async queryPacketAcknowledgement(
    request: QueryPacketAcknowledgementRequest,
  ): Promise<QueryPacketAcknowledgementResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketAcknowledgementParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`, 'QueryPacketAcknowledgement');

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetAcknowledgement =
      channelDatumDecoded.state.packet_acknowledgement.get(BigInt(sequence)) || JSON.stringify({ result: '01' });
    const ackData = {
      result: Buffer.from('01').toString('base64'),
    } as unknown as Acknowledgement;

    // if (!packetAcknowledgement) throw new GrpcNotFoundException("Not found: 'Packet Acknowledgement' not found");
    const proofHeight = await this.getProofHeight();
    await this.ensureTreeAligned();

    // Generate ICS-23 proof from the IBC state tree
    // Path: acks/ports/{portId}/channels/{channelId}/sequences/{sequence}
    const ibcPath = `acks/ports/${portId}/channels/channel-${channelId}/sequences/${sequence}`;
    const tree = getCurrentTree();
    
    let ackProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      ackProof = serializeExistenceProof(existenceProof);
      
      this.logger.log(`Generated ICS-23 proof for packet ack ${channelId}/${sequence}, proof size: ${ackProof.length} bytes`);
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryPacketAcknowledgementResponse = {
      acknowledgement: toHex(Acknowledgement.encode(ackData).finish()),
      proof: ackProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
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

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
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
        revision_number: BigInt(0), // TODO
        revision_height: queryHeight,
      },
    } as unknown as QueryPacketAcknowledgementsResponse;
    return response;
  }

  async queryPacketCommitment(request: QueryPacketCommitmentRequest): Promise<QueryPacketCommitmentResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketCommitmentParam(request);
    this.logger.log(
      `channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`,
      'QueryPacketCommitmentRequest',
    );

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetCommitment = channelDatumDecoded.state.packet_commitment.get(BigInt(sequence));
    // if (!packetCommitment) throw new GrpcNotFoundException("Not found: 'Packet Commitment' not found");
    const proofHeight = await this.getProofHeight();
    await this.ensureTreeAligned();

    // Generate ICS-23 proof from the IBC state tree
    // Path: commitments/ports/{portId}/channels/{channelId}/sequences/{sequence}
    const ibcPath = `commitments/ports/${portId}/channels/channel-${channelId}/sequences/${sequence}`;
    const tree = getCurrentTree();
    
    let commitmentProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      commitmentProof = serializeExistenceProof(existenceProof);
      
      this.logger.log(`Generated ICS-23 proof for packet commitment ${channelId}/${sequence}, proof size: ${commitmentProof.length} bytes`);
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryPacketCommitmentResponse = {
      commitment: packetCommitment,
      proof: commitmentProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
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

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
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
        revision_number: BigInt(0), // TODO
        revision_height: queryHeight,
      },
    } as unknown as QueryPacketCommitmentsResponse;
    return response;
  }

  // write api service logic api grpc PacketReceiptb with request params QueryPacketReceiptRequest and return Promise QueryPacketReceiptResponse
  async queryPacketReceipt(request: QueryPacketReceiptRequest): Promise<QueryPacketReceiptResponse> {
    const { channel_id: channelId, port_id: portId, sequence } = validQueryPacketReceiptParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}, sequence=${sequence}`, 'QueryPacketReceiptRequest');

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetReceipt = channelDatumDecoded.state.packet_receipt.has(BigInt(sequence));

    // if (!packetReceipt) throw new GrpcNotFoundException("Not found: 'Packet Receipt' not found");
    const proofHeight = await this.getProofHeight();
    await this.ensureTreeAligned();

    // Generate ICS-23 proof from the IBC state tree
    // Path: receipts/ports/{portId}/channels/{channelId}/sequences/{sequence}
    // If received=true: ExistenceProof showing receipt marker exists
    // If received=false: NonExistenceProof showing receipt marker doesn't exist
    const ibcPath = `receipts/ports/${portId}/channels/channel-${channelId}/sequences/${sequence}`;
    const tree = getCurrentTree();
    
    let receiptProof: Buffer;
    try {
      if (packetReceipt) {
        const existenceProof = tree.generateProof(ibcPath);
        receiptProof = serializeExistenceProof(existenceProof);
        this.logger.log(`Generated ICS-23 existence proof for packet receipt ${channelId}/${sequence}, proof size: ${receiptProof.length} bytes`);
      } else {
        const nonExistenceProof = tree.generateNonExistenceProof(ibcPath);
        receiptProof = serializeNonExistenceProof(nonExistenceProof);
        this.logger.log(`Generated ICS-23 non-existence proof for packet receipt ${channelId}/${sequence}, proof size: ${receiptProof.length} bytes`);
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
        revision_height: proofHeight,
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

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetReceiptSeqs = channelDatumDecoded.state.packet_receipt;
    const sequences = request.packet_commitment_sequences.filter((seq) => !packetReceiptSeqs.has(BigInt(seq)));

    const queryHeight = await this.getQueryHeight();
    const response: QueryUnreceivedPacketsResponse = {
      /** list of unreceived packet sequences */
      sequences: sequences,
      /** query block height */
      height: {
        revision_number: BigInt(0), // TODO
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

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatumDecoded: ChannelDatum = await decodeChannelDatum(utxo.datum!, this.lucidService.LucidImporter);
    const packetCommitsSeqs = channelDatumDecoded.state.packet_commitment;
    const sequences = packetAcksSequences.filter((seq) => packetCommitsSeqs.has(BigInt(seq)));

    const queryHeight = await this.getQueryHeight();
    const response: QueryUnreceivedAcksResponse = {
      /** list of unreceived packet sequences */
      sequences: sequences,
      /** query block height */
      height: {
        revision_number: BigInt(0), // TODO
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

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const utxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
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
    const proofHeight = await this.getProofHeight();
    await this.ensureTreeAligned();
    // if (BigInt(proof.blockNo) > revisionHeight) {
    //   throw new GrpcInvalidArgumentException(
    //     `Invalid proof height, revision height ${revisionHeight} not match with proof height ${proof.blockNo}`,
    //   );
    // }

    // Generate ICS-23 non-existence proof from the IBC state tree
    // This proves that the receipt does NOT exist (packet is unreceived)
    // Path: receipts/ports/{portId}/channels/{channelId}/sequences/{sequence}
    const ibcPath = `receipts/ports/${portId}/channels/channel-${channelId}/sequences/${sequence}`;
    const tree = getCurrentTree();
    
    let unreceivedProof: Buffer;
    try {
      const nonExistenceProof = tree.generateNonExistenceProof(ibcPath);
      unreceivedProof = serializeNonExistenceProof(nonExistenceProof);
      
      this.logger.log(`Generated ICS-23 non-existence proof for unreceived packet ${channelId}/${sequence}, proof size: ${unreceivedProof.length} bytes`);
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryPacketAcknowledgementResponse = {
      proof: unreceivedProof, // ICS-23 non-existence proof
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
      },
    } as unknown as QueryPacketAcknowledgementResponse;
    return response;
  }
  async queryNextSequenceReceive(request: QueryNextSequenceReceiveRequest): Promise<QueryNextSequenceReceiveResponse> {
    const { channel_id: channelId, port_id: portId } = validQueryNextSequenceReceiveParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryNextSequenceReceiveRequest');

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelUtxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');

    console.dir({ channelDatum }, { depth: 10 });

    const nextSequenceRecv = channelDatum.state.next_sequence_recv;

    const proofHeight = await this.getProofHeight();
    await this.ensureTreeAligned();

    // Generate ICS-23 proof from the IBC state tree
    // Path: nextSequenceRecv/ports/{portId}/channels/{channelId}
    const ibcPath = `nextSequenceRecv/ports/${portId}/channels/channel-${channelId}`;
    const tree = getCurrentTree();
    
    let nextSeqProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      nextSeqProof = serializeExistenceProof(existenceProof);
      
      this.logger.log(`Generated ICS-23 proof for next sequence receive ${channelId}, proof size: ${nextSeqProof.length} bytes`);
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryNextSequenceReceiveResponse = {
      next_sequence_receive: nextSequenceRecv.toString(),
      proof: nextSeqProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
      },
    } as unknown as QueryNextSequenceReceiveResponse;
    return response;
  }
  async QueryNextSequenceAck(request: QueryNextSequenceReceiveRequest): Promise<QueryNextSequenceReceiveResponse> {
    const { channel_id: channelId, port_id: portId } = validQueryNextSequenceReceiveParam(request);
    this.logger.log(`channelId = ${channelId}, portId = ${portId}`, 'QueryNextSequenceAckRequest');

    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelId));
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelUtxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    const nextSequenceAck = channelDatum.state.next_sequence_ack;

    const proofHeight = await this.getProofHeight();
    await this.ensureTreeAligned();

    // Generate ICS-23 proof from the IBC state tree
    // Path: nextSequenceAck/ports/{portId}/channels/{channelId}
    const ibcPath = `nextSequenceAck/ports/${portId}/channels/channel-${channelId}`;
    const tree = getCurrentTree();
    
    let nextAckProof: Buffer;
    try {
      const existenceProof = tree.generateProof(ibcPath);
      nextAckProof = serializeExistenceProof(existenceProof);
      
      this.logger.log(`Generated ICS-23 proof for next sequence ack ${channelId}, proof size: ${nextAckProof.length} bytes`);
    } catch (error) {
      this.logger.error(`Failed to generate ICS-23 proof for ${ibcPath}: ${error.message}`);
      throw new GrpcInternalException(`Proof generation failed: ${error.message}`);
    }

    const response: QueryNextSequenceReceiveResponse = {
      next_sequence_receive: nextSequenceAck.toString(),
      proof: nextAckProof, // ICS-23 Merkle proof
      proof_height: {
        revision_number: 0,
        revision_height: proofHeight,
      },
    } as unknown as QueryNextSequenceReceiveResponse;
    return response;
  }
}
