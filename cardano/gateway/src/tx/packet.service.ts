import { Inject, Injectable, Logger } from '@nestjs/common';
import { appendFileSync } from 'fs';
import { inspect } from 'util';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { ConfigService } from '@nestjs/config';
import { DenomTraceService, TraceRegistryInsertContext } from 'src/query/services/denom-trace.service';
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

import { Network, TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { parseChannelSequence, parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ChannelDatum } from 'src/shared/types/channel/channel-datum';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { Packet } from 'src/shared/types/channel/packet';
import { SpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';
import { ACK_RESULT, CHANNEL_ID_PREFIX, LOVELACE, ORDER_MAPPING_CHANNEL } from 'src/constant';
import { ASYNC_ICQ_HOST_PORT } from '@shared/types/apps/async-icq/async-icq';
import { IBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import {
  deleteKeySortMap,
  deleteSortMap,
  getDenomPrefix,
  insertSortMapWithNumberKey,
  prependToMap,
  stringifyIcs20PacketData,
} from '@shared/helpers/helper';
import { RpcException } from '@nestjs/microservices';
import { FungibleTokenPacketDatum } from '@shared/types/apps/transfer/types/fungible-token-packet-data';
import { TransferModuleRedeemer } from '../shared/types/apps/transfer/transfer_module_redeemer/transfer-module-redeemer';
import { mapLovelaceDenom, normalizeDenomTokenTransfer, sumLovelaceFromUtxos } from './helper/helper';
import { convertHex2String, convertString2Hex, hashSHA256 } from '../shared/helpers/hex';
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
  SendModulePacketOperator,
  SendPacketOperator,
  TimeoutPacketOperator,
  TimeoutRefreshOperator,
} from './dto';
import { PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';
import {
  UnsignedAckPacketModuleDto,
  UnsignedAckPacketMintDto,
  UnsignedAckPacketSucceedDto,
  UnsignedAckPacketUnescrowDto,
  UnsignedRecvPacketDto,
  UnsignedRecvPacketModuleDto,
  UnsignedRecvPacketMintDto,
  UnsignedRecvPacketUnescrowDto,
  UnsignedSendPacketModuleDto,
  UnsignedSendPacketBurnDto,
  UnsignedSendPacketEscrowDto,
  UnsignedTimeoutPacketMintDto,
  UnsignedTimeoutPacketUnescrowDto,
  UnsignedTimeoutRefreshDto,
} from '~@/shared/modules/lucid/dtos';
import { acknowledgementCommitmentFromResponse } from '../shared/helpers/acknowledgement';
import { alignTreeWithChain, computeRootWithHandlePacketUpdate, isTreeAligned } from '../shared/helpers/ibc-state-root';
import { splitFullDenomTrace } from '../shared/helpers/denom-trace';
import { AsyncIcqHostService } from './async-icq-host.service';
import { TxOperationRunnerService } from './tx-operation-runner.service';
import { queryNetworkTipPoint } from '../shared/helpers/time';
import { getGatewayModuleConfigForPortId } from '@shared/helpers/module-port';
import { buildVoucherCip68Metadata, encodeVoucherCip68MetadataDatum } from '../shared/helpers/cip68-voucher-metadata';
import {
  buildVoucherDenomHashFromFullDenom,
  buildVoucherReferenceTokenNameFromDenomHash,
  buildVoucherUserTokenNameFromDenomHash,
} from '../shared/helpers/voucher-asset';
import { VOUCHER_METADATA_REGISTRY } from '../shared/helpers/voucher-metadata-registry';
import {
  buildUnsignedSendPacketTx as buildUnsignedSendPacketTxWithPackage,
  type SendPacketOperator as SharedSendPacketOperator,
} from '@cardano-ibc/tx-builder';

@Injectable()
export class PacketService {
  private static readonly RECV_PACKET_DEBUG_LOG = '/tmp/recv-packet-debug.log';
  private static readonly DEFAULT_ASYNC_ICQ_TIMEOUT_HEIGHT_DELTA = 1000n;

  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    private denomTraceService: DenomTraceService,
    private readonly txOperationRunnerService: TxOperationRunnerService,
    private readonly asyncIcqHostService: AsyncIcqHostService,
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

  private async resolveTraceRegistryUpdate(
    voucherHash: string,
    fullDenom: string,
    buildCandidateTx: (traceRegistryUpdate: TraceRegistryInsertContext) => TxBuilder,
    onInitialUpdate?: (traceRegistryUpdate: TraceRegistryInsertContext) => void,
  ): Promise<TraceRegistryInsertContext> {
    const initialUpdate = await this.denomTraceService.prepareOnChainInsert(
      voucherHash,
      fullDenom,
    );
    onInitialUpdate?.(initialUpdate);
    if (initialUpdate.kind !== 'append') {
      return initialUpdate;
    }

    const candidateTx = buildCandidateTx(initialUpdate);
    const shouldRollover = await this.denomTraceService.shouldRolloverForUnsignedTx(candidateTx);
    if (!shouldRollover) {
      return initialUpdate;
    }

    return await this.denomTraceService.prepareOnChainInsert(
      voucherHash,
      fullDenom,
      { forceRollover: true },
    );
  }

  private appendRecvPacketDebug(line: string): void {
    try {
      appendFileSync(PacketService.RECV_PACKET_DEBUG_LOG, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // Best-effort debugging only.
    }
  }

  private logRecvPacketDebug(line: string): void {
    this.logger.log(line);
    this.appendRecvPacketDebug(line);
  }

  private compareUtxoRef(a: UTxO, b: UTxO): number {
    const txHashCompare = a.txHash.localeCompare(b.txHash);
    if (txHashCompare !== 0) return txHashCompare;
    return a.outputIndex - b.outputIndex;
  }

  private toUtxoRef(utxo: UTxO): string {
    return `${utxo.txHash}#${utxo.outputIndex}`;
  }

  private debugLogRecvPacketPlan(
    context: string,
    params: {
      spendInputs: Array<{ label: string; utxo: UTxO }>;
      channelOutputAddress: string;
      hostStateOutputAddress: string;
      transferModuleInputAddress?: string;
      transferModuleOutputAddress?: string;
      updatedChannelDatumHex: string;
      recvPacketPolicyId: string;
      verifyProofPolicyId: string;
      channelTokenUnit: string;
      proofHeight: string;
      packetSequence: string;
      packetDataUtf8?: string;
      packetDataHex?: string;
      reencodedPacketDataUtf8?: string;
      reencodedPacketDataHex?: string;
      packetDataMatches?: boolean;
      receiverAddress?: string;
      voucherTokenUnit?: string;
      denomToken?: string;
      traceRegistryKind?: string;
    },
  ): void {
    const sortedSpendInputs = [...params.spendInputs].sort((a, b) => this.compareUtxoRef(a.utxo, b.utxo));
    const renderedSpendInputs = sortedSpendInputs
      .map((entry, index) => `Spend[${index}] ${this.toUtxoRef(entry.utxo)} (${entry.label})`)
      .join(', ');

    this.logRecvPacketDebug(`[DEBUG recvPacket] ${context} spend_inputs_sorted=${renderedSpendInputs}`);
    this.logRecvPacketDebug(
      `[DEBUG recvPacket] ${context} policy_ids recv_packet=${params.recvPacketPolicyId} verify_proof=${params.verifyProofPolicyId} channel_token_unit=${params.channelTokenUnit}`,
    );
    this.logRecvPacketDebug(
      `[DEBUG recvPacket] ${context} packet sequence=${params.packetSequence} proof_height=${params.proofHeight}`,
    );
    this.logRecvPacketDebug(
      `[DEBUG recvPacket] ${context} output_addresses channel=${params.channelOutputAddress} host_state=${params.hostStateOutputAddress}${params.receiverAddress ? ` receiver=${params.receiverAddress}` : ''}`,
    );
    if (params.transferModuleInputAddress || params.transferModuleOutputAddress) {
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} transfer_module_addresses input=${params.transferModuleInputAddress ?? 'n/a'} output=${params.transferModuleOutputAddress ?? 'n/a'}`,
      );
    }
    if (params.voucherTokenUnit) {
      this.logRecvPacketDebug(`[DEBUG recvPacket] ${context} voucher_token_unit=${params.voucherTokenUnit}`);
    }
    if (params.denomToken) {
      this.logRecvPacketDebug(`[DEBUG recvPacket] ${context} denom_token=${params.denomToken}`);
    }
    if (params.packetDataUtf8 !== undefined) {
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} packet_data match=${params.packetDataMatches ?? false} utf8=${params.packetDataUtf8}`,
      );
    }
    if (params.reencodedPacketDataUtf8 !== undefined) {
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} packet_data_reencoded utf8=${params.reencodedPacketDataUtf8}`,
      );
    }
    if (params.packetDataHex !== undefined || params.reencodedPacketDataHex !== undefined) {
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} packet_data_hex incoming=${params.packetDataHex ?? 'n/a'} reencoded=${params.reencodedPacketDataHex ?? 'n/a'}`,
      );
    }
    if (params.traceRegistryKind) {
      this.logRecvPacketDebug(`[DEBUG recvPacket] ${context} trace_registry_kind=${params.traceRegistryKind}`);
    }
    this.logRecvPacketDebug(
      `[DEBUG recvPacket] ${context} updated_channel_datum len=${params.updatedChannelDatumHex.length} head=${params.updatedChannelDatumHex.substring(0, 160)}`,
    );
  }

  private logRecvPacketRawConfig(
    context: string,
    tx: TxBuilder,
    knownRefs: Array<[string, UTxO | undefined]>,
  ): void {
    try {
      const raw = tx.rawConfig();
      const knownByRef = new Map<string, string>();
      for (const [label, utxo] of knownRefs) {
        if (!utxo) continue;
        knownByRef.set(this.toUtxoRef(utxo), label);
      }

      const renderRef = (utxo: UTxO, index: number) => {
        const ref = this.toUtxoRef(utxo);
        const label = knownByRef.get(ref);
        return label ? `#${index} ${ref} (${label})` : `#${index} ${ref}`;
      };

      const collected = raw.collectedInputs.map(renderRef);
      const reads = raw.readInputs.map(renderRef);
      const payToOutputs = raw.payToOutputs.map((output, index) => {
        return `#${index} ${inspect(output, { depth: 5, breakLength: 120 })}`;
      });

      this.logger.log(
        `[DEBUG recvPacket] ${context} raw.collectedInputs(${collected.length})=${collected.join(', ')}`,
      );
      this.logger.log(
        `[DEBUG recvPacket] ${context} raw.readInputs(${reads.length})=${reads.join(', ')}`,
      );
      this.logger.log(
        `[DEBUG recvPacket] ${context} raw.payToOutputs(${payToOutputs.length})=${payToOutputs.join(' || ')}`,
      );
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} raw.collectedInputs(${collected.length})=${collected.join(', ')}`,
      );
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} raw.readInputs(${reads.length})=${reads.join(', ')}`,
      );
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} raw.payToOutputs(${payToOutputs.length})=${payToOutputs.join(' || ')}`,
      );
    } catch (error) {
      this.logger.error(
        `[DEBUG recvPacket] ${context} rawConfig_error=${inspect(error, { depth: 5, breakLength: 120 })}`,
      );
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} rawConfig_error=${inspect(error, { depth: 5 })}`,
      );
    }
  }

  private debugLogVerifyMembershipInputs(
    context: string,
    params: {
      clientState: {
        latestHeight: { revisionNumber: bigint; revisionHeight: bigint };
        proofSpecs?: Array<{
          leaf_spec?: { prefix?: string; hash?: bigint; prehash_key?: bigint; prehash_value?: bigint; length?: bigint };
          inner_spec?: { child_size?: bigint; min_prefix_length?: bigint; max_prefix_length?: bigint; hash?: bigint };
        }>;
      };
      clientLatestHeight: { revisionNumber: bigint; revisionHeight: bigint };
      proofHeight: { revisionNumber: bigint; revisionHeight: bigint };
      consensusRoot: string;
      pathKeyPath: string[];
      expectedValue: string;
      proof: any;
    },
  ): void {
    const proofs = Array.isArray(params.proof?.proofs) ? params.proof.proofs : [];
    const firstProof = params.proof?.proofs?.[0]?.proof;
    const existenceProof =
      firstProof && typeof firstProof === 'object' && 'CommitmentProof_Exist' in firstProof
        ? firstProof.CommitmentProof_Exist.exist
        : null;
    const nonExistenceProof =
      firstProof && typeof firstProof === 'object' && 'CommitmentProof_Nonexist' in firstProof
        ? firstProof.CommitmentProof_Nonexist.non_exist
        : null;

    this.logRecvPacketDebug(
      `[DEBUG recvPacket] ${context} verify_membership client_latest_height=${params.clientLatestHeight.revisionNumber}/${params.clientLatestHeight.revisionHeight} proof_height=${params.proofHeight.revisionNumber}/${params.proofHeight.revisionHeight} consensus_root=${params.consensusRoot}`,
    );
    this.logRecvPacketDebug(
      `[DEBUG recvPacket] ${context} verify_membership proof_specs=${params.clientState.proofSpecs?.length ?? 0} proofs=${proofs.length}`,
    );
    params.clientState.proofSpecs?.forEach((spec, index) => {
      const canonicalSpec = this.getCanonicalProofSpecs()[index];
      const isIavlSpec = index === 0 && this.proofSpecEquals(spec, canonicalSpec);
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} verify_membership spec[${index}] leaf_prefix=${spec.leaf_spec?.prefix ?? 'n/a'} leaf_hash=${spec.leaf_spec?.hash ?? 'n/a'} prehash_key=${spec.leaf_spec?.prehash_key ?? 'n/a'} prehash_value=${spec.leaf_spec?.prehash_value ?? 'n/a'} length=${spec.leaf_spec?.length ?? 'n/a'} child_size=${spec.inner_spec?.child_size ?? 'n/a'} min_prefix=${spec.inner_spec?.min_prefix_length ?? 'n/a'} max_prefix=${spec.inner_spec?.max_prefix_length ?? 'n/a'} inner_hash=${spec.inner_spec?.hash ?? 'n/a'}`,
      );
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} verify_membership spec[${index}] canonical_match=${this.proofSpecEquals(spec, canonicalSpec)} iavl_mode=${isIavlSpec}`,
      );
    });
    this.logRecvPacketDebug(
      `[DEBUG recvPacket] ${context} verify_membership merkle_path=${params.pathKeyPath.join(' | ')}`,
    );
    const computedRoots: Array<string | null> = [];
    proofs.forEach((proofItem: any, index: number) => {
      const proofKind = proofItem?.proof;
      const exist =
        proofKind && typeof proofKind === 'object' && 'CommitmentProof_Exist' in proofKind
          ? proofKind.CommitmentProof_Exist.exist
          : null;
      const nonexist =
        proofKind && typeof proofKind === 'object' && 'CommitmentProof_Nonexist' in proofKind
          ? proofKind.CommitmentProof_Nonexist.non_exist
          : null;

      if (exist) {
        const computedRoot = this.computeExistenceProofRoot(exist);
        computedRoots[index] = computedRoot;
        const spec = params.clientState.proofSpecs?.[index];
        const canonicalSpec = this.getCanonicalProofSpecs()[index];
        const isIavlSpec = index === 0 && this.proofSpecEquals(spec, canonicalSpec);
        const leafCheck = this.checkAgainstSpecLeafOp(exist.leaf, spec, isIavlSpec);
        const innerChecks = Array.isArray(exist.path)
          ? exist.path.map((innerOp: any) => this.checkAgainstSpecInnerOp(innerOp, spec, isIavlSpec))
          : [];
        this.logRecvPacketDebug(
          `[DEBUG recvPacket] ${context} verify_membership proof[${index}] exist key=${exist.key} value=${exist.value} leaf_prefix=${exist.leaf?.prefix ?? 'n/a'} leaf_hash=${exist.leaf?.hash ?? 'n/a'} prehash_key=${exist.leaf?.prehash_key ?? 'n/a'} prehash_value=${exist.leaf?.prehash_value ?? 'n/a'} length=${exist.leaf?.length ?? 'n/a'} inner_ops=${exist.path?.length ?? 0} computed_root=${computedRoot ?? 'n/a'}`,
        );
        this.logRecvPacketDebug(
          `[DEBUG recvPacket] ${context} verify_membership proof[${index}] spec_checks leaf=${leafCheck} inner=${innerChecks.every(Boolean)} inner_detail=${innerChecks.join(',')}`,
        );
        return;
      }

      if (nonexist) {
        computedRoots[index] = null;
        this.logRecvPacketDebug(
          `[DEBUG recvPacket] ${context} verify_membership proof[${index}] nonexist key=${nonexist.key} left_key=${nonexist.left?.key ?? 'n/a'} right_key=${nonexist.right?.key ?? 'n/a'}`,
        );
        return;
      }

      computedRoots[index] = null;
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} verify_membership proof[${index}] kind=${String(proofKind)}`,
      );
    });
    if (computedRoots.length >= 2 && computedRoots[0]) {
      const secondProofValue =
        proofs[1]?.proof &&
        typeof proofs[1].proof === 'object' &&
        'CommitmentProof_Exist' in proofs[1].proof
          ? proofs[1].proof.CommitmentProof_Exist.exist?.value
          : null;
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} verify_membership proof_chain_match=${computedRoots[0] === secondProofValue} proof0_root=${computedRoots[0]} proof1_value=${secondProofValue ?? 'n/a'}`,
      );
    }
    const finalComputedRoot = computedRoots[computedRoots.length - 1];
    if (finalComputedRoot) {
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} verify_membership consensus_root_match=${finalComputedRoot === params.consensusRoot} final_proof_root=${finalComputedRoot}`,
      );
    }

    if (existenceProof) {
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} verify_membership existence key=${existenceProof.key} value=${existenceProof.value} expected_value=${params.expectedValue} value_match=${existenceProof.value === params.expectedValue} inner_ops=${existenceProof.path.length}`,
      );
      return;
    }

    if (nonExistenceProof) {
      this.logRecvPacketDebug(
        `[DEBUG recvPacket] ${context} verify_membership nonexist key=${nonExistenceProof.key} left_key=${nonExistenceProof.left?.key ?? 'n/a'} right_key=${nonExistenceProof.right?.key ?? 'n/a'}`,
      );
      return;
    }

    this.logRecvPacketDebug(
      `[DEBUG recvPacket] ${context} verify_membership first_proof_kind=${String(firstProof)}`,
    );
  }

  private computeExistenceProofRoot(existenceProof: any): string | null {
    if (!existenceProof?.leaf) return null;

    const applyHash = (hashOp: unknown, payload: Buffer): Buffer => {
      const op = Number(hashOp ?? 0);
      if (op === 0) return payload;
      if (op === 1) return Buffer.from(hashSHA256(payload.toString('hex')), 'hex');
      return Buffer.alloc(0);
    };

    const encodeVarint = (value: number): Buffer => {
      const bytes: number[] = [];
      let remaining = value >>> 0;
      while (remaining >= 0x80) {
        bytes.push((remaining & 0x7f) | 0x80);
        remaining >>>= 7;
      }
      bytes.push(remaining);
      return Buffer.from(bytes);
    };

    const applyLength = (lengthOp: unknown, payload: Buffer): Buffer => {
      const op = Number(lengthOp ?? 0);
      if (op === 0) return payload;
      if (op === 1) return Buffer.concat([encodeVarint(payload.length), payload]);
      if (op === 7 || op === 8) return payload;
      return Buffer.alloc(0);
    };

    const prepareLeafData = (hashOp: unknown, lengthOp: unknown, hexValue: string): Buffer => {
      const raw = Buffer.from(hexValue ?? '', 'hex');
      return applyLength(lengthOp, applyHash(hashOp, raw));
    };

    let current = applyHash(
      existenceProof.leaf.hash,
      Buffer.concat([
        Buffer.from(existenceProof.leaf.prefix ?? '', 'hex'),
        prepareLeafData(existenceProof.leaf.prehash_key, existenceProof.leaf.length, existenceProof.key ?? ''),
        prepareLeafData(existenceProof.leaf.prehash_value, existenceProof.leaf.length, existenceProof.value ?? ''),
      ]),
    );

    for (const innerOp of existenceProof.path ?? []) {
      current = applyHash(
        innerOp.hash,
        Buffer.concat([
          Buffer.from(innerOp.prefix ?? '', 'hex'),
          current,
          Buffer.from(innerOp.suffix ?? '', 'hex'),
        ]),
      );
    }

    return current.toString('hex');
  }

  private decodeHexBytes(hex: string | undefined | null): Buffer {
    return Buffer.from((hex ?? '').trim(), 'hex');
  }

  private readVarintFromBuffer(buffer: Buffer, offset: number): { value: number; nextOffset: number } {
    let result = 0;
    let shift = 0;
    let index = offset;

    while (index < buffer.length) {
      const byte = buffer[index];
      result |= (byte & 0x7f) << shift;
      index += 1;
      if ((byte & 0x80) === 0) {
        return { value: result, nextOffset: index };
      }
      shift += 7;
    }

    throw new Error('invalid varint encoding');
  }

  private hasHexPrefix(valueHex: string | undefined | null, prefixHex: string | undefined | null): boolean {
    const value = this.decodeHexBytes(valueHex);
    const prefix = this.decodeHexBytes(prefixHex);
    return value.subarray(0, prefix.length).equals(prefix);
  }

  private validateIavlLeafOp(prefixHex: string | undefined | null, b: number): boolean {
    try {
      const prefix = this.decodeHexBytes(prefixHex);
      let cursor = 0;
      const first = this.readVarintFromBuffer(prefix, cursor);
      cursor = first.nextOffset;
      const second = this.readVarintFromBuffer(prefix, cursor);
      cursor = second.nextOffset;
      const third = this.readVarintFromBuffer(prefix, cursor);
      cursor = third.nextOffset;
      const remainingLength = prefix.length - cursor;

      if (first.value < b || second.value < 0 || third.value < 0) {
        return false;
      }

      return b === 0 ? remainingLength === 0 : remainingLength === 1 || remainingLength === 34;
    } catch {
      return false;
    }
  }

  private validateIavlInnerOp(prefixHex: string | undefined | null, hashOp: unknown, b: number): boolean {
    try {
      const prefix = this.decodeHexBytes(prefixHex);
      let cursor = 0;
      const first = this.readVarintFromBuffer(prefix, cursor);
      cursor = first.nextOffset;
      const second = this.readVarintFromBuffer(prefix, cursor);
      cursor = second.nextOffset;
      const third = this.readVarintFromBuffer(prefix, cursor);
      cursor = third.nextOffset;
      const remainingLength = prefix.length - cursor;

      if (first.value < b || second.value < 0 || third.value < 0) {
        return false;
      }

      return (b === 0 ? remainingLength === 0 : remainingLength === 1 || remainingLength === 34) &&
        Number(hashOp ?? 0) === 1;
    } catch {
      return false;
    }
  }

  private proofSpecEquals(left: any, right: any): boolean {
    const normalize = (value: any): any => {
      if (Array.isArray(value)) {
        return value.map(normalize);
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entryValue]) => [key, normalize(entryValue)]),
        );
      }
      return value;
    };

    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  }

  private getCanonicalProofSpecs(): Array<any> {
    return [
      {
        leaf_spec: {
          hash: 1n,
          prehash_key: 0n,
          prehash_value: 1n,
          length: 1n,
          prefix: '00',
        },
        inner_spec: {
          child_order: [0n, 1n],
          child_size: 33n,
          min_prefix_length: 4n,
          max_prefix_length: 12n,
          empty_child: '',
          hash: 1n,
        },
        max_depth: 0n,
        min_depth: 0n,
        prehash_key_before_comparison: false,
      },
      {
        leaf_spec: {
          hash: 1n,
          prehash_key: 0n,
          prehash_value: 1n,
          length: 1n,
          prefix: '00',
        },
        inner_spec: {
          child_order: [0n, 1n],
          child_size: 32n,
          min_prefix_length: 1n,
          max_prefix_length: 1n,
          empty_child: '',
          hash: 1n,
        },
        max_depth: 0n,
        min_depth: 0n,
        prehash_key_before_comparison: false,
      },
    ];
  }

  private checkAgainstSpecLeafOp(op: any, spec: any, isIavlSpec: boolean): boolean {
    const leafSpec = spec?.leaf_spec;
    if (!leafSpec) {
      return false;
    }

    return (
      Number(op?.hash ?? -1) === Number(leafSpec.hash ?? -2) &&
      Number(op?.prehash_key ?? -1) === Number(leafSpec.prehash_key ?? -2) &&
      Number(op?.prehash_value ?? -1) === Number(leafSpec.prehash_value ?? -2) &&
      Number(op?.length ?? -1) === Number(leafSpec.length ?? -2) &&
      this.hasHexPrefix(op?.prefix, leafSpec.prefix) &&
      (!isIavlSpec || this.validateIavlLeafOp(op?.prefix, 0))
    );
  }

  private checkAgainstSpecInnerOp(op: any, spec: any, isIavlSpec: boolean): boolean {
    const innerSpec = spec?.inner_spec;
    const leafSpec = spec?.leaf_spec;
    if (!innerSpec || !leafSpec) {
      return false;
    }

    const prefixLength = this.decodeHexBytes(op?.prefix).length;
    const suffixLength = this.decodeHexBytes(op?.suffix).length;
    const maxOpPrefixLength =
      (Array.isArray(innerSpec.child_order) ? innerSpec.child_order.length - 1 : 0) *
        Number(innerSpec.child_size ?? 0) +
      Number(innerSpec.max_prefix_length ?? 0);

    return (
      Number(op?.hash ?? -1) === Number(innerSpec.hash ?? -2) &&
      !this.hasHexPrefix(op?.prefix, leafSpec.prefix) &&
      prefixLength >= Number(innerSpec.min_prefix_length ?? 0) &&
      prefixLength <= maxOpPrefixLength &&
      suffixLength % Number(innerSpec.child_size ?? 1) === 0 &&
      (!isIavlSpec || this.validateIavlInnerOp(op?.prefix, op?.hash, 1))
    );
  }

  private getTraceRegistrySpendInputs(
    traceRegistryUpdate: TraceRegistryInsertContext | null,
  ): Array<{ label: string; utxo: UTxO }> {
    if (!traceRegistryUpdate || traceRegistryUpdate.kind === 'existing') {
      return [];
    }

    if (traceRegistryUpdate.kind === 'append') {
      return [
        { label: 'trace_registry_shard', utxo: traceRegistryUpdate.traceRegistryShardUtxo },
      ];
    }

    return [
      { label: 'trace_registry_directory', utxo: traceRegistryUpdate.traceRegistryDirectoryUtxo },
      { label: 'trace_registry_shard', utxo: traceRegistryUpdate.traceRegistryShardUtxo },
      { label: 'trace_registry_mint_nonce', utxo: traceRegistryUpdate.traceRegistryMintNonceUtxo },
    ];
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

  private async computeTxValidityWindow(): Promise<{ currentSlot: number; validToSlot: number; validToTime: number }> {
    const ogmiosEndpoint = this.configService.get<string>('ogmiosEndpoint');
    const tip = await queryNetworkTipPoint(ogmiosEndpoint);
    const currentSlot = tip === 'origin' ? 0 : tip.slot;
    // Local devnet can lag far behind wallclock time, so deriving validity from `Date.now()` or
    // Lucid's wallclock-based `currentSlot()` can push tx TTL beyond the node's forecast horizon.
    // Anchor expiry to the live ledger tip instead.
    const ttlSlots = Math.max(1, Math.ceil(TRANSACTION_TIME_TO_LIVE / 1000));
    const validToSlot = currentSlot + ttlSlots;
    const network = this.configService.get('cardanoNetwork') as Network;
    const slotConfig = this.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[network];
    if (!slotConfig || slotConfig.slotLength <= 0) {
      throw new GrpcInternalException(`send packet failed: invalid slot configuration for network ${network}`);
    }

    // Lucid floors `unixTime -> slot`, so target the last millisecond of the slot window we want.
    const validToTime =
      slotConfig.zeroTime + (validToSlot + 1 - slotConfig.zeroSlot) * slotConfig.slotLength - 1;

    return { currentSlot, validToSlot, validToTime };
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

  private normalizeAcknowledgementResponse(acknowledgementResponse: unknown): AcknowledgementResponse {
    const acknowledgementResult = this.extractAcknowledgementResult(acknowledgementResponse);
    if (acknowledgementResult) {
      return {
        AcknowledgementResult: {
          result: convertString2Hex(acknowledgementResult),
        },
      };
    }

    const acknowledgementError = this.extractAcknowledgementError(acknowledgementResponse);
    if (acknowledgementError) {
      return {
        AcknowledgementError: {
          err: convertString2Hex(acknowledgementError),
        },
      };
    }

    const acknowledgementResponseKeys =
      acknowledgementResponse && typeof acknowledgementResponse === 'object'
        ? Object.keys(acknowledgementResponse as Record<string, unknown>).join(',')
        : '';
    throw new GrpcInternalException(
      `Acknowledgement Response invalid: unknown result (keys=${acknowledgementResponseKeys})`,
    );
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
      await this.refreshWalletContext(constructedAddress, 'recvPacketBuilder');
      // Build and complete the unsigned transaction
      const { unsignedTx: unsignedRecvPacketTx, pendingTreeUpdate } = await this.buildUnsignedRecvPacketTx(
        recvPacketOperator,
        constructedAddress,
      );

      const deploymentConfig = this.configService.get('deployment');
      this.logRecvPacketRawConfig('pre_complete', unsignedRecvPacketTx, [
        ['traceRegistryDirectory', await this.safeFindTraceRegistryDirectoryUtxo()],
        ['recvPacketRefScript', deploymentConfig.validators.spendChannel.refValidator.recv_packet?.refUtxo],
        ['verifyProofRefScript', deploymentConfig.validators.verifyProof?.refUtxo],
        ['spendTraceRegistryRefScript', deploymentConfig.validators.spendTraceRegistry?.refUtxo],
      ]);

      const { currentSlot, validToSlot, validToTime: initialValidToTime } = await this.computeTxValidityWindow();
      let validToTime = initialValidToTime;
      if (recvPacketOperator.timeoutTimestamp > 0n) {
        // On-chain requires tx_valid_to * 1_000_000 < packet.timeout_timestamp.
        // Clamp validTo under packet timeout so recv stays valid even near deadline.
        const maxValidToMs = recvPacketOperator.timeoutTimestamp / 10n ** 6n - 1n;
        if (maxValidToMs <= BigInt(validToTime)) {
          throw new GrpcInternalException('recv packet failed: packet timeout too close or already expired');
        }
        if (BigInt(validToTime) > maxValidToMs) {
          validToTime = Number(maxValidToMs);
        }
      }
      const boundedValidToSlot = this.lucidService.lucid.unixTimeToSlot(Number(validToTime));
      if (currentSlot > boundedValidToSlot) {
        throw new GrpcInternalException('recv packet failed: tx time invalid');
      }

      if (
        recvPacketOperator.timeoutTimestamp > 0 &&
        BigInt(validToTime) * 10n ** 6n >= recvPacketOperator.timeoutTimestamp
      ) {
        throw new GrpcInternalException('recv packet failed: tx_valid_to * 1_000_000 >= packet.timeout_timestamp');
      }
      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'recvPacket',
        unsignedTx: unsignedRecvPacketTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validTo(validToTime),
        },
        wallet: {
          mode: 'custom_before_complete',
          run: async () => {
            await this.refreshWalletContext(constructedAddress, 'recvPacket');
          },
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
      });

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
      this.logger.error(`[DEBUG recvPacket] error.inspect=${inspect(error, { depth: 8, breakLength: 120 })}`);
      const cause = (error as { cause?: unknown })?.cause;
      if (cause) {
        this.logger.error(`[DEBUG recvPacket] error.cause=${inspect(cause, { depth: 8, breakLength: 120 })}`);
      }
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
    }
  }

  private async safeFindTraceRegistryDirectoryUtxo(): Promise<UTxO | undefined> {
    try {
      const deploymentConfig = this.configService.get('deployment');
      const traceRegistry = deploymentConfig.traceRegistry;
      if (!traceRegistry?.directory) return undefined;
      return await this.lucidService.findUtxoByUnit(
        traceRegistry.directory.policyId + traceRegistry.directory.name,
      );
    } catch {
      return undefined;
    }
  }
  async sendPacket(data: MsgTransfer): Promise<MsgTransferResponse> {
    // used in the funding osmosis step
    try {
      this.logger.log('Transfer is processing');
      const sendPacketOperator = validateAndFormatSendPacketParams(data);
      await this.refreshWalletContext(sendPacketOperator.sender, 'sendPacketBuilder');

      const { unsignedTx: unsignedSendPacketTx, pendingTreeUpdate, walletOverride } =
        await this.buildUnsignedSendPacketTx(sendPacketOperator);
      const { currentSlot, validToSlot, validToTime } = await this.computeTxValidityWindow();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('channel init failed: tx time invalid');
      }

      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'sendPacket',
        unsignedTx: unsignedSendPacketTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validTo(validToTime),
        },
        wallet: {
          mode: 'custom_before_complete',
          run: async () => {
            if (!walletOverride) {
              return;
            }
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
          },
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
      });

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

  async sendAsyncIcqPacket(
    data: SendModulePacketOperator,
  ): Promise<{ packet_sequence: string; tx: MsgTransferResponse }> {
    try {
      await this.refreshWalletContext(data.signer, 'sendAsyncIcqPacketBuilder');

      const {
        unsignedTx: unsignedSendPacketTx,
        pendingTreeUpdate,
        packetSequence,
      } = await this.buildUnsignedSendModulePacketTx(data);
      const { currentSlot, validToSlot, validToTime } = await this.computeTxValidityWindow();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('async-icq send failed: tx time invalid');
      }

      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'sendAsyncIcqPacket',
        unsignedTx: unsignedSendPacketTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validTo(validToTime),
        },
        wallet: {
          mode: 'refresh_from_address',
          address: data.signer,
          context: 'sendAsyncIcqPacket',
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
      });

      return {
        // Surface the packet sequence at build time so result polling can key
        // off channel+sequence without depending on tx indexing.
        packet_sequence: packetSequence.toString(),
        tx: {
          result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
          unsigned_tx: {
            type_url: '',
            value: cborHexBytes,
          },
        },
      };
    } catch (error) {
      this.logger.error(`sendAsyncIcqPacket: ${error}`);
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
      await this.refreshWalletContext(constructedAddress, 'timeoutPacketBuilder');
      const { unsignedTx: unsignedSendPacketTx, pendingTreeUpdate } = await this.buildUnsignedTimeoutPacketTx(
        timeoutPacketOperator,
        constructedAddress,
      );
      const { validToTime } = await this.computeTxValidityWindow();
      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'timeoutPacket',
        unsignedTx: unsignedSendPacketTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validTo(validToTime),
        },
        wallet: {
          mode: 'refresh_from_address',
          address: constructedAddress,
          context: 'timeoutPacket',
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
      });

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

      await this.refreshWalletContext(constructedAddress, 'timeoutRefreshBuilder');
      // Build and complete the unsigned transaction
      const unsignedTimeoutRefreshTx: TxBuilder = await this.buildUnsignedTimeoutRefreshTx(
        timeoutRefreshOperator,
        constructedAddress,
      );
      const { currentSlot, validToSlot, validToTime } = await this.computeTxValidityWindow();

      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('recv packet failed: tx time invalid');
      }
      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'timeoutRefresh',
        unsignedTx: unsignedTimeoutRefreshTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validTo(validToTime),
        },
        wallet: {
          mode: 'refresh_from_address',
          address: constructedAddress,
          context: 'timeoutRefresh',
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
      });

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

      await this.refreshWalletContext(constructedAddress, 'acknowledgementPacketBuilder');
      // Build and complete the unsigned transaction
      const {
        unsignedTx: unsignedAckPacketTx,
        pendingTreeUpdate,
        walletSelection,
      } = await this.buildUnsignedAcknowlegementPacketTx(
        ackPacketOperator,
        constructedAddress,
      );
      const { validToTime } = await this.computeTxValidityWindow();
      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'acknowledgementPacket',
        unsignedTx: unsignedAckPacketTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validTo(validToTime),
        },
        wallet: {
          mode: 'custom_before_complete',
          run: async () => {
            await this.refreshWalletContext(
              constructedAddress,
              walletSelection?.context ?? 'acknowledgementPacket',
              walletSelection?.excludeAssetUnit
                ? { excludeAssetUnit: walletSelection.excludeAssetUnit }
                : undefined,
            );
          },
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
      });

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

    this.debugLogVerifyMembershipInputs('recv_packet', {
      clientState: clientDatum.state.clientState,
      clientLatestHeight: clientDatum.state.clientState.latestHeight,
      proofHeight: recvPacketOperator.proofHeight,
      consensusRoot: consensusState.root.hash,
      pathKeyPath: verifyProofRedeemer.VerifyMembership.path.key_path,
      expectedValue: verifyProofRedeemer.VerifyMembership.value,
      proof: verifyProofRedeemer.VerifyMembership.proof,
    });

    const encodedVerifyProofRedeemer: string = encodeVerifyProofRedeemer(
      verifyProofRedeemer,
      this.lucidService.LucidImporter,
    );

    if (convertHex2String(channelDatum.port) === ASYNC_ICQ_HOST_PORT) {
      // Async-icq rides the normal recv-packet path. The difference from ICS-20 is
      // only how the packet data is interpreted and how the ack is produced.
      const moduleConfig = getGatewayModuleConfigForPortId(
        this.configService.get('deployment'),
        ASYNC_ICQ_HOST_PORT,
      );
      const moduleUtxo = await this.lucidService.findUtxoByUnit(moduleConfig.identifier);
      const { acknowledgementResponse } = await this.asyncIcqHostService.executePacket(
        Buffer.from(packet.data, 'hex'),
      );
      // Reuse the existing module callback envelope so Cardano emits a regular
      // write_acknowledgement event and persists the ack commitment in channel state.
      const encodedSpendModuleRedeemer: string = await this.lucidService.encode(
        {
          Callback: [
            {
              OnRecvPacket: {
                channel_id: channelId,
                acknowledgement: {
                  response: acknowledgementResponse,
                },
                // Async-icq does not need transfer-specific callback payloads.
                data: 'OtherModuleData',
              },
            },
          ],
        } as IBCModuleRedeemer,
        'iBCModuleRedeemer',
      );
      const updatedChannelDatum: ChannelDatum = {
        ...channelDatum,
        state: {
          ...channelDatum.state,
          next_sequence_recv: nextSequenceRecv,
          packet_receipt: packetReceipt,
          // Commit the exact ack bytes produced by the async-icq host executor.
          packet_acknowledgement: insertSortMapWithNumberKey(
            channelDatum.state.packet_acknowledgement,
            packet.sequence,
            acknowledgementCommitmentFromResponse(acknowledgementResponse),
          ),
        },
      };
      const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
        updatedChannelDatum,
        'channel',
      );
      const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
        await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, recvPacketOperator.channelId);
      const unsignedRecvPacketModuleParams: UnsignedRecvPacketModuleDto = {
        hostStateUtxo,
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        moduleKey: moduleConfig.key,
        moduleUtxo,
        encodedHostStateRedeemer,
        encodedUpdatedHostStateDatum,
        encodedSpendChannelRedeemer,
        encodedSpendModuleRedeemer,
        encodedUpdatedChannelDatum,
        channelTokenUnit,
        recvPacketPolicyId,
        channelToken,
        verifyProofPolicyId,
        encodedVerifyProofRedeemer,
      };
      // This keeps async-icq in the same host-state / channel-state update flow as
      // any other successful recv path.
      const unsignedTx = this.lucidService.createUnsignedRecvPacketModuleTx(unsignedRecvPacketModuleParams);
      return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
    }

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
          const reencodedPacketDataUtf8 = stringifyIcs20PacketData({
            denom: fungibleTokenPacketData.denom,
            amount: fungibleTokenPacketData.amount,
            sender: fungibleTokenPacketData.sender,
            receiver: fungibleTokenPacketData.receiver,
            memo: fungibleTokenPacketData.memo,
          });
          const reencodedPacketDataHex = convertString2Hex(reencodedPacketDataUtf8);
          const packetDataMatches = recvPacketOperator.packetData === reencodedPacketDataHex;
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
            this.debugLogRecvPacketPlan('unescrow', {
              spendInputs: [
                { label: 'host_state', utxo: hostStateUtxo },
                { label: 'channel', utxo: channelUtxo },
                { label: 'transfer_module', utxo: transferModuleUtxo },
              ],
              channelOutputAddress: deploymentConfig.validators.spendChannel.address,
              hostStateOutputAddress: deploymentConfig.validators.hostStateStt.address,
              transferModuleInputAddress: transferModuleUtxo.address,
              transferModuleOutputAddress: deploymentConfig.modules.transfer.address,
              updatedChannelDatumHex: encodedUpdatedChannelDatum,
              recvPacketPolicyId,
              verifyProofPolicyId,
              channelTokenUnit,
              proofHeight: `${recvPacketOperator.proofHeight.revisionNumber}/${recvPacketOperator.proofHeight.revisionHeight}`,
              packetSequence: packet.sequence.toString(),
              packetDataUtf8: stringData,
              packetDataHex: recvPacketOperator.packetData,
              reencodedPacketDataUtf8,
              reencodedPacketDataHex,
              packetDataMatches,
              receiverAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.receiver),
              denomToken,
            });
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

            const fullDenomPath = destPrefix + fungibleTokenPacketData.denom;
            const voucherMintDetails = this.buildVoucherMintDetails(fullDenomPath);

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
            const buildUnsignedRecvPacketMintParams = (
              traceRegistryUpdate: TraceRegistryInsertContext | null,
            ): UnsignedRecvPacketMintDto => ({
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
              voucherTokenUnit: voucherMintDetails.voucherTokenUnit,
              voucherReferenceTokenUnit: voucherMintDetails.voucherReferenceTokenUnit,
              voucherMetadataAddress: voucherMintDetails.voucherMetadataAddress,
              encodedVoucherMetadataDatum: voucherMintDetails.encodedVoucherMetadataDatum,
              transferAmount: BigInt(fungibleTokenPacketData.amount),
              receiverAddress,
              constructedAddress,

              recvPacketPolicyId,
              channelToken,

              verifyProofPolicyId,
              encodedVerifyProofRedeemer,
              traceRegistryUpdate,
            });

            // RecvPacket voucher mint path:
            // - construct the canonical full denom visible on the destination side
            // - derive the 28-byte voucher core plus labeled FT/reference asset names
            // - append to the current active shard if the tx is comfortably sized
            // - otherwise roll the bucket to a fresh active shard and insert there
            const traceRegistryUpdate = await this.resolveTraceRegistryUpdate(
              voucherMintDetails.voucherDenomHash,
              fullDenomPath,
              (candidateUpdate) =>
                this.lucidService.createUnsignedRecvPacketMintTx(buildUnsignedRecvPacketMintParams(candidateUpdate)),
              (initialUpdate) =>
                this.debugLogRecvPacketPlan('mint_voucher_candidate', {
                  spendInputs: [
                    ...this.getTraceRegistrySpendInputs(initialUpdate),
                    { label: 'host_state', utxo: hostStateUtxo },
                    { label: 'channel', utxo: channelUtxo },
                    { label: 'transfer_module', utxo: transferModuleUtxo },
                  ],
                  channelOutputAddress: deploymentConfig.validators.spendChannel.address,
                  hostStateOutputAddress: deploymentConfig.validators.hostStateStt.address,
                  transferModuleInputAddress: transferModuleUtxo.address,
                  transferModuleOutputAddress: deploymentConfig.modules.transfer.address,
                  updatedChannelDatumHex: encodedUpdatedChannelDatum,
                  recvPacketPolicyId,
                  verifyProofPolicyId,
                  channelTokenUnit,
                  proofHeight: `${recvPacketOperator.proofHeight.revisionNumber}/${recvPacketOperator.proofHeight.revisionHeight}`,
                  packetSequence: packet.sequence.toString(),
                  packetDataUtf8: stringData,
                  packetDataHex: recvPacketOperator.packetData,
                  reencodedPacketDataUtf8,
                  reencodedPacketDataHex,
                  packetDataMatches,
                  receiverAddress,
                  voucherTokenUnit: voucherMintDetails.voucherTokenUnit,
                  traceRegistryKind: initialUpdate.kind,
                }),
            );

            this.debugLogRecvPacketPlan('mint_voucher', {
              spendInputs: [
                ...this.getTraceRegistrySpendInputs(traceRegistryUpdate),
                { label: 'host_state', utxo: hostStateUtxo },
                { label: 'channel', utxo: channelUtxo },
                { label: 'transfer_module', utxo: transferModuleUtxo },
              ],
              channelOutputAddress: deploymentConfig.validators.spendChannel.address,
              hostStateOutputAddress: deploymentConfig.validators.hostStateStt.address,
              transferModuleInputAddress: transferModuleUtxo.address,
              transferModuleOutputAddress: deploymentConfig.modules.transfer.address,
              updatedChannelDatumHex: encodedUpdatedChannelDatum,
              recvPacketPolicyId,
              verifyProofPolicyId,
              channelTokenUnit,
              proofHeight: `${recvPacketOperator.proofHeight.revisionNumber}/${recvPacketOperator.proofHeight.revisionHeight}`,
              packetSequence: packet.sequence.toString(),
              packetDataUtf8: stringData,
              packetDataHex: recvPacketOperator.packetData,
              reencodedPacketDataUtf8,
              reencodedPacketDataHex,
              packetDataMatches,
              receiverAddress,
              voucherTokenUnit: voucherMintDetails.voucherTokenUnit,
              traceRegistryKind: traceRegistryUpdate?.kind ?? 'none',
            });
            const unsignedTx = this.lucidService.createUnsignedRecvPacketMintTx(
              buildUnsignedRecvPacketMintParams(traceRegistryUpdate),
            );
            return {
              unsignedTx,
              pendingTreeUpdate: {
                expectedNewRoot: newRoot,
                commit,
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

    this.debugLogRecvPacketPlan('generic', {
      spendInputs: [
        { label: 'host_state', utxo: hostStateUtxo },
        { label: 'channel', utxo: channelUtxo },
      ],
      channelOutputAddress: deploymentConfig.validators.spendChannel.address,
      hostStateOutputAddress: deploymentConfig.validators.hostStateStt.address,
      updatedChannelDatumHex: encodedUpdatedChannelDatum,
      recvPacketPolicyId,
      verifyProofPolicyId,
      channelTokenUnit,
      proofHeight: `${recvPacketOperator.proofHeight.revisionNumber}/${recvPacketOperator.proofHeight.revisionHeight}`,
      packetSequence: packet.sequence.toString(),
    });
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
    const mintVoucherRedeemer: MintVoucherRedeemer = {
      RefundVoucher: {
        packet_source_port: packet.source_port,
        packet_source_channel: packet.source_channel,
      },
    };
    const fullDenomPath = denom;
    const voucherMintDetails = this.buildVoucherMintDetails(fullDenomPath);

    const encodedMintVoucherRedeemer: string = await this.lucidService.encode(
      mintVoucherRedeemer,
      'mintVoucherRedeemer',
    );
    const buildUnsignedTimeoutPacketMintDto = (
      traceRegistryUpdate: TraceRegistryInsertContext | null,
    ): UnsignedTimeoutPacketMintDto => ({
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
      voucherTokenUnit: voucherMintDetails.voucherTokenUnit,
      voucherReferenceTokenUnit: voucherMintDetails.voucherReferenceTokenUnit,
      voucherMetadataAddress: voucherMintDetails.voucherMetadataAddress,
      encodedVoucherMetadataDatum: voucherMintDetails.encodedVoucherMetadataDatum,
      constructedAddress: constructedAddress,

      timeoutPacketPolicyId,
      channelToken,

      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
      traceRegistryUpdate,
    });
    const traceRegistryUpdate = await this.resolveTraceRegistryUpdate(
      voucherMintDetails.voucherDenomHash,
      fullDenomPath,
      (candidateUpdate) =>
        this.lucidService.createUnsignedTimeoutPacketMintTx(buildUnsignedTimeoutPacketMintDto(candidateUpdate)),
    );
    const unsignedTx = this.lucidService.createUnsignedTimeoutPacketMintTx(
      buildUnsignedTimeoutPacketMintDto(traceRegistryUpdate),
    );
    return {
      unsignedTx,
      pendingTreeUpdate: {
        expectedNewRoot: newRoot,
        commit,
      },
    };
  }

  async buildUnsignedSendPacketTx(
    sendPacketOperator: SendPacketOperator,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate; walletOverride?: { address: string; utxos: UTxO[] } }> {
    return buildUnsignedSendPacketTxWithPackage(
      sendPacketOperator as SharedSendPacketOperator,
      {
        loadContext: async (operator) => {
          const channelSequence: string = operator.sourceChannel.replaceAll(
            `${CHANNEL_ID_PREFIX}-`,
            '',
          );
          const [mintChannelPolicyId, channelTokenName] =
            this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
          const channelTokenUnit: string =
            mintChannelPolicyId + channelTokenName;
          const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(
            channelTokenUnit,
          );
          const channelDatum =
            await this.lucidService.decodeDatum<ChannelDatum>(
              channelUtxo.datum!,
              'channel',
            );
          const [mintConnectionPolicyId, connectionTokenName] =
            this.lucidService.getConnectionTokenUnit(
              parseConnectionSequence(
                convertHex2String(
                  channelDatum.state.channel.connection_hops[0],
                ),
              ),
            );
          const connectionTokenUnit =
            mintConnectionPolicyId + connectionTokenName;
          const connectionUtxo = await this.lucidService.findUtxoByUnit(
            connectionTokenUnit,
          );
          const connectionDatum =
            await this.lucidService.decodeDatum<ConnectionDatum>(
              connectionUtxo.datum!,
              'connection',
            );
          const clientTokenUnit = this.lucidService.getClientTokenUnit(
            parseClientSequence(
              convertHex2String(connectionDatum.state.client_id),
            ),
          );
          const clientUtxo = await this.lucidService.findUtxoByUnit(
            clientTokenUnit,
          );
          const transferModuleIdentifier = this.getTransferModuleIdentifier();
          const transferModuleUtxo = await this.lucidService.findUtxoByUnit(
            transferModuleIdentifier,
          );
          const deploymentConfig = this.configService.get('deployment');

          return {
            channelUtxo,
            channelDatum,
            connectionUtxo,
            connectionDatum,
            clientUtxo,
            transferModuleUtxo,
            channelTokenUnit,
            channelToken: {
              policyId: mintChannelPolicyId,
              name: channelTokenName,
            },
            deployment: {
              sendPacketPolicyId:
                deploymentConfig.validators.spendChannel.refValidator
                  .send_packet.scriptHash,
              mintVoucherScriptHash:
                deploymentConfig.validators.mintVoucher.scriptHash,
              spendChannelAddress:
                deploymentConfig.validators.spendChannel.address,
              transferModuleAddress:
                deploymentConfig.modules.transfer.address,
            },
          };
        },
        buildHostStateUpdate: async (
          inputChannelDatum,
          outputChannelDatum,
          channelIdForRoot,
        ) =>
          this.buildHostStateUpdateForHandlePacket(
            inputChannelDatum as ChannelDatum,
            outputChannelDatum as ChannelDatum,
            channelIdForRoot,
          ),
        resolveIbcDenomHash: async (denomHash) => {
          const match = await this.denomTraceService.findByIbcDenomHash(
            denomHash,
          );
          if (!match) {
            return null;
          }

          return {
            path: match.path,
            baseDenom: match.base_denom,
          };
        },
        commitPacket,
        encode: (value, kind) =>
          this.lucidService.encode(value, kind as any),
        findUtxoAtWithUnit: (address, unit) =>
          this.lucidService.findUtxoAtWithUnit(address, unit),
        tryFindUtxosAt: (address, options) =>
          this.lucidService.tryFindUtxosAt(address, options),
        createUnsignedSendPacketBurnTx: (dto) =>
          this.lucidService.createUnsignedSendPacketBurnTx(
            dto as UnsignedSendPacketBurnDto,
          ),
        createUnsignedSendPacketEscrowTx: (dto) =>
          this.lucidService.createUnsignedSendPacketEscrowTx(
            dto as UnsignedSendPacketEscrowDto,
          ),
        invalidArgument: (message) =>
          new GrpcInvalidArgumentException(message),
        internalError: (message) => new GrpcInternalException(message),
      },
    );
  }

  async buildUnsignedSendModulePacketTx(
    sendPacketOperator: SendModulePacketOperator,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate; packetSequence: bigint }> {
    if (sendPacketOperator.sourcePort !== ASYNC_ICQ_HOST_PORT) {
      throw new GrpcInvalidArgumentException(
        `Invalid argument: "source_port" ${sendPacketOperator.sourcePort} not supported for async-icq send`,
      );
    }

    const channelSequence: string = sendPacketOperator.sourceChannel.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(
      parseConnectionSequence(convertHex2String(channelDatum.state.channel.connection_hops[0])),
    );
    const connectionTokenUnit = mintConnectionPolicyId + connectionTokenName;
    const connectionUtxo = await this.lucidService.findUtxoByUnit(connectionTokenUnit);
    const connectionDatum: ConnectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(
      connectionUtxo.datum!,
      'connection',
    );
    const clientTokenUnit = this.lucidService.getClientTokenUnit(
      parseClientSequence(convertHex2String(connectionDatum.state.client_id)),
    );
    const clientUtxo: UTxO = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const clientDatum: ClientDatum = await this.lucidService.decodeDatum<ClientDatum>(clientUtxo.datum!, 'client');
    const moduleConfig = getGatewayModuleConfigForPortId(this.configService.get('deployment'), sendPacketOperator.sourcePort);
    if (moduleConfig.key === 'transfer') {
      throw new GrpcInvalidArgumentException('async-icq send must not use the transfer module');
    }
    const moduleUtxo = await this.lucidService.findUtxoByUnit(moduleConfig.identifier);
    const channelId = convertString2Hex(sendPacketOperator.sourceChannel);
    const resolvedTimeoutHeight =
      sendPacketOperator.timeoutHeight.revisionNumber === 0n &&
      sendPacketOperator.timeoutHeight.revisionHeight === 0n &&
      sendPacketOperator.timeoutTimestamp === 0n
        ? {
            revisionNumber: clientDatum.state.clientState.latestHeight.revisionNumber,
            revisionHeight:
              clientDatum.state.clientState.latestHeight.revisionHeight +
              PacketService.DEFAULT_ASYNC_ICQ_TIMEOUT_HEIGHT_DELTA,
          }
        : sendPacketOperator.timeoutHeight;

    const packet: Packet = {
      sequence: channelDatum.state.next_sequence_send,
      source_port: convertString2Hex(sendPacketOperator.sourcePort),
      source_channel: channelId,
      destination_port: channelDatum.state.channel.counterparty.port_id,
      destination_channel: channelDatum.state.channel.counterparty.channel_id,
      data: sendPacketOperator.packetData,
      // Async-ICQ callers often omit explicit timeouts. Cardano still needs a
      // valid IBC packet, so default to a future height on the destination client
      // rather than constructing an invalid zero/zero timeout packet.
      timeout_height: resolvedTimeoutHeight,
      timeout_timestamp: sendPacketOperator.timeoutTimestamp,
    };

    const encodedSpendChannelRedeemer: string = await this.lucidService.encode(
      {
        SendPacket: {
          packet,
        },
      } as SpendChannelRedeemer,
      'spendChannelRedeemer',
    );

    const encodedSpendModuleRedeemer: string = await this.lucidService.encode(
      {
        Operator: ['OtherModuleOperator'],
      } as IBCModuleRedeemer,
      'iBCModuleRedeemer',
    );

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

    const unsignedSendPacketModuleParams: UnsignedSendPacketModuleDto = {
      hostStateUtxo,
      connectionUtxo,
      clientUtxo,
      channelUtxo,
      moduleKey: moduleConfig.key,
      moduleUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      encodedSpendChannelRedeemer,
      encodedSpendModuleRedeemer,
      encodedUpdatedChannelDatum,
      channelTokenUnit,
      sendPacketPolicyId,
      channelToken,
    };

    const unsignedTx = this.lucidService.createUnsignedSendPacketModuleTx(unsignedSendPacketModuleParams);
    return {
      unsignedTx,
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
      // Capture the sequence before the channel datum is advanced.
      packetSequence: packet.sequence,
    };
  }

  async buildUnsignedAcknowlegementPacketTx(
    ackPacketOperator: AckPacketOperator,
    constructedAddress: string,
  ): Promise<{
    unsignedTx: TxBuilder;
    pendingTreeUpdate: PendingTreeUpdate;
    walletSelection?: {
      context: string;
      excludeAssetUnit?: string;
    };
  }> {
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

    const acknowledgementResponse: unknown = JSON.parse(convertHex2String(ackPacketOperator.acknowledgement));
    const createTransferModuleRedeemer = (
      channelId: string,
      fTokenPacketData: FungibleTokenPacketDatum,
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
    const createModuleAckRedeemer = (channelId: string, acknowledgementResponse: AcknowledgementResponse) => ({
      Callback: [
        {
          OnAcknowledgementPacket: {
            channel_id: channelId,
            data: 'OtherModuleData',
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
    if (convertHex2String(packet.source_port) === ASYNC_ICQ_HOST_PORT) {
      const moduleConfig = getGatewayModuleConfigForPortId(
        this.configService.get('deployment'),
        ASYNC_ICQ_HOST_PORT,
      );
      const moduleUtxo = await this.lucidService.findUtxoByUnit(moduleConfig.identifier);
      const normalizedAcknowledgementResponse = this.normalizeAcknowledgementResponse(acknowledgementResponse);
      const encodedSpendModuleRedeemer: string = await this.lucidService.encode(
        createModuleAckRedeemer(channelId, normalizedAcknowledgementResponse),
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
      const unsignedAckPacketModuleParams: UnsignedAckPacketModuleDto = {
        hostStateUtxo,
        channelUtxo,
        connectionUtxo,
        clientUtxo,
        moduleKey: moduleConfig.key,
        moduleUtxo,
        encodedHostStateRedeemer,
        encodedUpdatedHostStateDatum,
        encodedSpendChannelRedeemer,
        encodedSpendModuleRedeemer,
        channelTokenUnit,
        encodedUpdatedChannelDatum,
        constructedAddress,
        ackPacketPolicyId,
        channelToken,
        verifyProofPolicyId,
        encodedVerifyProofRedeemer,
      };
      const unsignedTx = this.lucidService.createUnsignedAckPacketModuleTx(unsignedAckPacketModuleParams);
      return {
        unsignedTx,
        pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
        walletSelection: {
          context: 'acknowledgementPacket',
        },
      };
    }

    const transferModuleIdentifier = this.getTransferModuleIdentifier();
    const transferModuleUtxo = await this.lucidService.findUtxoByUnit(transferModuleIdentifier);
    const fungibleTokenPacketData: FungibleTokenPacketDatum = JSON.parse(
      convertHex2String(ackPacketOperator.packetData),
    );
    const fTokenPacketData: FungibleTokenPacketDatum = {
      denom: convertString2Hex(fungibleTokenPacketData.denom),
      amount: convertString2Hex(fungibleTokenPacketData.amount),
      sender: convertString2Hex(fungibleTokenPacketData.sender),
      receiver: convertString2Hex(fungibleTokenPacketData.receiver),
      memo: convertString2Hex(fungibleTokenPacketData.memo),
    };
    const acknowledgementResult = this.extractAcknowledgementResult(acknowledgementResponse);
    if (acknowledgementResult) {
      // build update channel datum
      const encodedSpendTransferModuleRedeemer: string = await this.lucidService.encode(
        createTransferModuleRedeemer(channelId, fTokenPacketData, {
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
      return {
        unsignedTx,
        pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
        walletSelection: {
          context: 'acknowledgementPacket',
        },
      };
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
      createTransferModuleRedeemer(channelId, fTokenPacketData, {
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
      return {
        unsignedTx,
        pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
        walletSelection: {
          context: 'acknowledgementPacket(unescrow)',
          excludeAssetUnit: denomToken === LOVELACE ? undefined : denomToken,
        },
      };
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
    const fullDenomPath = denomToHash;
    const voucherMintDetails = this.buildVoucherMintDetails(fullDenomPath);

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
    const buildUnsignedAckPacketMintParams = (
      traceRegistryUpdate: TraceRegistryInsertContext | null,
    ): UnsignedAckPacketMintDto => ({
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
      voucherTokenUnit: voucherMintDetails.voucherTokenUnit,
      voucherReferenceTokenUnit: voucherMintDetails.voucherReferenceTokenUnit,
      voucherMetadataAddress: voucherMintDetails.voucherMetadataAddress,
      encodedVoucherMetadataDatum: voucherMintDetails.encodedVoucherMetadataDatum,
      transferAmount: BigInt(fungibleTokenPacketData.amount),
      senderAddress: this.lucidService.credentialToAddress(fungibleTokenPacketData.sender),

      constructedAddress,

      ackPacketPolicyId,
      channelToken,

      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
      traceRegistryUpdate,
    });
    const traceRegistryUpdate = await this.resolveTraceRegistryUpdate(
      voucherMintDetails.voucherDenomHash,
      fullDenomPath,
      (candidateUpdate) =>
        this.lucidService.createUnsignedAckPacketMintTx(buildUnsignedAckPacketMintParams(candidateUpdate)),
    );

    // handle recv packet mint
    const unsignedTx = this.lucidService.createUnsignedAckPacketMintTx(
      buildUnsignedAckPacketMintParams(traceRegistryUpdate),
    );
    return {
      unsignedTx,
      pendingTreeUpdate: {
        expectedNewRoot: newRoot,
        commit,
      },
      walletSelection: {
        context: 'acknowledgementPacket',
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
    if (this._isHexDenom(denom)) {
      throw new GrpcInvalidArgumentException(
        'Voucher denom appears to be already hex-encoded; refusing to hash a double-encoded denom',
      );
    }
    return buildVoucherUserTokenNameFromDenomHash(
      buildVoucherDenomHashFromFullDenom(denom),
    );
  }

  private buildVoucherMintDetails(fullDenom: string): {
    voucherDenomHash: string;
    voucherTokenName: string;
    voucherTokenUnit: string;
    voucherReferenceTokenName: string;
    voucherReferenceTokenUnit: string;
    voucherMetadataAddress: string;
    encodedVoucherMetadataDatum: string;
  } {
    if (fullDenom.startsWith('ibc/')) {
      throw new GrpcInvalidArgumentException(
        `IBC hash denom ${fullDenom} must be reverse-resolved before voucher token-name hashing`,
      );
    }
    if (this._isHexDenom(fullDenom)) {
      throw new GrpcInvalidArgumentException(
        'Voucher denom appears to be already hex-encoded; refusing to hash a double-encoded denom',
      );
    }

    const deploymentConfig = this.configService.get('deployment');
    const voucherPolicyId = deploymentConfig.validators.mintVoucher.scriptHash;
    const voucherMetadataAddress = deploymentConfig.validators.voucherMetadata?.address;
    if (!voucherMetadataAddress) {
      throw new GrpcInternalException(
        'Voucher metadata validator address is missing from deployment config',
      );
    }

    const trace = splitFullDenomTrace(fullDenom);
    const voucherDenomHash = buildVoucherDenomHashFromFullDenom(fullDenom);
    const voucherTokenName = buildVoucherUserTokenNameFromDenomHash(voucherDenomHash);
    const voucherReferenceTokenName = buildVoucherReferenceTokenNameFromDenomHash(
      voucherDenomHash,
    );
    const metadata = buildVoucherCip68Metadata({
      path: trace.path,
      baseDenom: trace.baseDenom,
      fullDenom,
      voucherTokenName,
      voucherPolicyId,
      ibcDenomHash: hashSHA256(convertString2Hex(fullDenom)).toLowerCase(),
      curated: VOUCHER_METADATA_REGISTRY[fullDenom],
    });

    return {
      voucherDenomHash,
      voucherTokenName,
      voucherTokenUnit: `${voucherPolicyId}${voucherTokenName}`,
      voucherReferenceTokenName,
      voucherReferenceTokenUnit: `${voucherPolicyId}${voucherReferenceTokenName}`,
      voucherMetadataAddress,
      encodedVoucherMetadataDatum:
        typeof (this.lucidService.LucidImporter as any)?.Data?.to === 'function'
          ? encodeVoucherCip68MetadataDatum(
              metadata,
              this.lucidService.LucidImporter,
            )
          : 'encoded-voucher-metadata-datum',
    };
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
