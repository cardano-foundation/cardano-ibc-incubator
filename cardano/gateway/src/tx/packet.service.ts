import {
  MsgAcknowledgement,
  MsgAcknowledgementResponse,
  MsgRecvPacket,
  MsgRecvPacketResponse,
  MsgTimeout,
  MsgTimeoutOnClose,
  MsgTimeoutOnCloseResponse,
  MsgTimeoutResponse,
  MsgTransferResponse,
  ResponseResultType,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gatewayDiagnostics } from '@shared/helpers/gateway-diagnostics';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { inspect } from 'util';

import { MsgPrunePacketHistoryResponse } from '@cardano-ibc/proto-types/build/ibc/cardano/v1/tx';
import {
  Channel as CardanoChannel,
  State as CardanoChannelState,
  Order as ChannelOrder,
  orderFromJSON,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/channel';
import { Network, TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { RpcException } from '@nestjs/microservices';
import { deleteKeySortMap, deleteSortMap, insertSortMapWithNumberKey, prependToMap } from '@shared/helpers/helper';
import { getGatewayModuleConfigForPortId } from '@shared/helpers/module-port';
import { ASYNC_ICQ_HOST_PORT } from '@shared/types/apps/async-icq/async-icq';
import { AcknowledgementResponse } from '@shared/types/channel/acknowledgement_response';
import { SpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';
import { ClientDatum } from '@shared/types/client-datum';
import { IBCModuleRedeemer } from '@shared/types/port/ibc_module_redeemer';
import { CHANNEL_ID_PREFIX, ORDER_MAPPING_CHANNEL } from 'src/constant';
import { parseChannelSequence, parseClientSequence, parseConnectionSequence } from 'src/shared/helpers/sequence';
import { ChannelDatum } from 'src/shared/types/channel/channel-datum';
import { Packet } from 'src/shared/types/channel/packet';
import { ConnectionDatum } from 'src/shared/types/connection/connection-datum';
import { HostStateDatum } from 'src/shared/types/host-state-datum';
import { TRANSACTION_SET_COLLATERAL, TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import {
  GrpcFailedPreconditionException,
  GrpcInternalException,
  GrpcInvalidArgumentException,
} from '~@/exception/grpc_exceptions';
import {
  UnsignedAckPacketModuleDto,
  UnsignedPrunePacketHistoryDto,
  UnsignedRecvPacketModuleDto,
  UnsignedSendPacketModuleDto,
} from '~@/shared/modules/lucid/dtos';
import { acknowledgementCommitmentFromResponse } from '../shared/helpers/acknowledgement';
import { channelPath } from '../shared/helpers/channel';
import { commitPacket } from '../shared/helpers/commitment';
import { convertHex2String, convertString2Hex, hashSHA256, toHex } from '../shared/helpers/hex';
import { IbcTreeStateStore, StaleIbcTreeStateError, StateRootResult } from '../shared/helpers/ibc-state-root';
import { isHeightAtLeast, maximumHeight } from '../shared/helpers/packet-history-height';
import { packetAcknowledgementPath, packetCommitmentPath, packetReceiptPath } from '../shared/helpers/packet-keys';
import { computeLedgerAnchoredValidityWindow } from '../shared/helpers/time';
import { getBlockDelay, getHeightMapValue } from '../shared/helpers/verify';
import { PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';
import { ChannelState } from '../shared/types/channel/state';
import { encodeVerifyProofRedeemer, VerifyProofRedeemer } from '../shared/types/connection/verify-proof-redeemer';
import { AsyncIcqHostService } from './async-icq-host.service';
import {
  AckPacketOperator,
  PrunePacketHistoryOperator,
  RecvPacketOperator,
  SendModulePacketOperator,
  TimeoutOnClosePacketOperator,
  TimeoutPacketOperator,
} from './dto';
import { isValidProofHeight } from './helper/height.validate';
import { sumLovelaceFromUtxos } from './helper/helper';
import {
  validateAndFormatAcknowledgementPacketParams,
  validateAndFormatRecvPacketParams,
  validateAndFormatTimeoutOnClosePacketParams,
  validateAndFormatTimeoutPacketParams,
  validateRecvPacketHistoryCapacity,
  validateSendPacketCommitmentCapacity,
} from './helper/packet.validate';
import { TxOperationRunnerService } from './tx-operation-runner.service';

function uint64ToBigEndianHex(value: bigint): string {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(value);
  return bytes.toString('hex');
}

@Injectable()
export class PacketService {
  private static readonly DEFAULT_ASYNC_ICQ_TIMEOUT_HEIGHT_DELTA = 1000n;

  constructor(
    private readonly logger: Logger,
    private configService: ConfigService,
    @Inject(LucidService) private lucidService: LucidService,
    private readonly txOperationRunnerService: TxOperationRunnerService,
    private readonly asyncIcqHostService: AsyncIcqHostService,
    private readonly ibcTreeStore: IbcTreeStateStore,
  ) {}
  private requireQueryChannel(datum: ChannelDatum): void {
    if (convertHex2String(datum.port) !== ASYNC_ICQ_HOST_PORT) {
      throw new GrpcInvalidArgumentException('Inline query packets require the icqhost port');
    }
  }

  private logRecvPacketDebug(line: () => string): void {
    gatewayDiagnostics.record('recvPacket', line);
  }

  private toUtxoRef(utxo: UTxO): string {
    return `${utxo.txHash}#${utxo.outputIndex}`;
  }

  private logRecvPacketRawConfig(context: string, tx: TxBuilder, knownRefs: Array<[string, UTxO | undefined]>): void {
    if (!gatewayDiagnostics.isEnabled()) return;

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

      this.logRecvPacketDebug(
        () => `[DEBUG recvPacket] ${context} raw.collectedInputs(${collected.length})=${collected.join(', ')}`,
      );
      this.logRecvPacketDebug(
        () => `[DEBUG recvPacket] ${context} raw.readInputs(${reads.length})=${reads.join(', ')}`,
      );
      this.logRecvPacketDebug(
        () => `[DEBUG recvPacket] ${context} raw.payToOutputs(${payToOutputs.length})=${payToOutputs.join(' || ')}`,
      );
    } catch (error) {
      this.logRecvPacketDebug(() => `[DEBUG recvPacket] ${context} rawConfig_error=${inspect(error, { depth: 5 })}`);
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
    if (!gatewayDiagnostics.isEnabled()) return;

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
      () =>
        `[DEBUG recvPacket] ${context} verify_membership client_latest_height=${params.clientLatestHeight.revisionNumber}/${params.clientLatestHeight.revisionHeight} proof_height=${params.proofHeight.revisionNumber}/${params.proofHeight.revisionHeight} consensus_root=${params.consensusRoot}`,
    );
    this.logRecvPacketDebug(
      () =>
        `[DEBUG recvPacket] ${context} verify_membership proof_specs=${params.clientState.proofSpecs?.length ?? 0} proofs=${proofs.length}`,
    );
    params.clientState.proofSpecs?.forEach((spec, index) => {
      const canonicalSpec = this.getCanonicalProofSpecs()[index];
      const isIavlSpec = index === 0 && this.proofSpecEquals(spec, canonicalSpec);
      this.logRecvPacketDebug(
        () =>
          `[DEBUG recvPacket] ${context} verify_membership spec[${index}] leaf_prefix=${spec.leaf_spec?.prefix ?? 'n/a'} leaf_hash=${spec.leaf_spec?.hash ?? 'n/a'} prehash_key=${spec.leaf_spec?.prehash_key ?? 'n/a'} prehash_value=${spec.leaf_spec?.prehash_value ?? 'n/a'} length=${spec.leaf_spec?.length ?? 'n/a'} child_size=${spec.inner_spec?.child_size ?? 'n/a'} min_prefix=${spec.inner_spec?.min_prefix_length ?? 'n/a'} max_prefix=${spec.inner_spec?.max_prefix_length ?? 'n/a'} inner_hash=${spec.inner_spec?.hash ?? 'n/a'}`,
      );
      this.logRecvPacketDebug(
        () =>
          `[DEBUG recvPacket] ${context} verify_membership spec[${index}] canonical_match=${this.proofSpecEquals(spec, canonicalSpec)} iavl_mode=${isIavlSpec}`,
      );
    });
    this.logRecvPacketDebug(
      () => `[DEBUG recvPacket] ${context} verify_membership merkle_path=${params.pathKeyPath.join(' | ')}`,
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
          () =>
            `[DEBUG recvPacket] ${context} verify_membership proof[${index}] exist key=${exist.key} value=${exist.value} leaf_prefix=${exist.leaf?.prefix ?? 'n/a'} leaf_hash=${exist.leaf?.hash ?? 'n/a'} prehash_key=${exist.leaf?.prehash_key ?? 'n/a'} prehash_value=${exist.leaf?.prehash_value ?? 'n/a'} length=${exist.leaf?.length ?? 'n/a'} inner_ops=${exist.path?.length ?? 0} computed_root=${computedRoot ?? 'n/a'}`,
        );
        this.logRecvPacketDebug(
          () =>
            `[DEBUG recvPacket] ${context} verify_membership proof[${index}] spec_checks leaf=${leafCheck} inner=${innerChecks.every(Boolean)} inner_detail=${innerChecks.join(',')}`,
        );
        return;
      }

      if (nonexist) {
        computedRoots[index] = null;
        this.logRecvPacketDebug(
          () =>
            `[DEBUG recvPacket] ${context} verify_membership proof[${index}] nonexist key=${nonexist.key} left_key=${nonexist.left?.key ?? 'n/a'} right_key=${nonexist.right?.key ?? 'n/a'}`,
        );
        return;
      }

      computedRoots[index] = null;
      this.logRecvPacketDebug(
        () => `[DEBUG recvPacket] ${context} verify_membership proof[${index}] kind=${String(proofKind)}`,
      );
    });
    if (computedRoots.length >= 2 && computedRoots[0]) {
      const secondProofValue =
        proofs[1]?.proof && typeof proofs[1].proof === 'object' && 'CommitmentProof_Exist' in proofs[1].proof
          ? proofs[1].proof.CommitmentProof_Exist.exist?.value
          : null;
      this.logRecvPacketDebug(
        () =>
          `[DEBUG recvPacket] ${context} verify_membership proof_chain_match=${computedRoots[0] === secondProofValue} proof0_root=${computedRoots[0]} proof1_value=${secondProofValue ?? 'n/a'}`,
      );
    }
    const finalComputedRoot = computedRoots[computedRoots.length - 1];
    if (finalComputedRoot) {
      this.logRecvPacketDebug(
        () =>
          `[DEBUG recvPacket] ${context} verify_membership consensus_root_match=${finalComputedRoot === params.consensusRoot} final_proof_root=${finalComputedRoot}`,
      );
    }

    if (existenceProof) {
      this.logRecvPacketDebug(
        () =>
          `[DEBUG recvPacket] ${context} verify_membership existence key=${existenceProof.key} value=${existenceProof.value} expected_value=${params.expectedValue} value_match=${existenceProof.value === params.expectedValue} inner_ops=${existenceProof.path.length}`,
      );
      return;
    }

    if (nonExistenceProof) {
      this.logRecvPacketDebug(
        () =>
          `[DEBUG recvPacket] ${context} verify_membership nonexist key=${nonExistenceProof.key} left_key=${nonExistenceProof.left?.key ?? 'n/a'} right_key=${nonExistenceProof.right?.key ?? 'n/a'}`,
      );
      return;
    }

    this.logRecvPacketDebug(
      () => `[DEBUG recvPacket] ${context} verify_membership first_proof_kind=${String(firstProof)}`,
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
        Buffer.concat([Buffer.from(innerOp.prefix ?? '', 'hex'), current, Buffer.from(innerOp.suffix ?? '', 'hex')]),
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

      return (
        (b === 0 ? remainingLength === 0 : remainingLength === 1 || remainingLength === 34) && Number(hashOp ?? 0) === 1
      );
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

  /**
   * Ensure the in-memory Merkle tree is aligned with on-chain state.
   *
   * Packet handlers must compute sibling witnesses against the *current* root,
   * otherwise `host_state_stt` will reject the transaction.
   */
  private async ensureTreeAligned(
    onChainRoot: string,
    hostStateUtxo: Pick<UTxO, 'txHash' | 'outputIndex'>,
  ): Promise<void> {
    const snapshot = await this.ibcTreeStore.getAlignedSnapshot();
    if (
      snapshot.root !== onChainRoot ||
      snapshot.hostState.txHash !== hostStateUtxo.txHash ||
      snapshot.hostState.outputIndex !== hostStateUtxo.outputIndex
    ) {
      throw new StaleIbcTreeStateError('HostState changed while preparing the transaction, retry with current inputs');
    }
  }

  private async computeTxValidityWindow(): Promise<{
    currentSlot: number;
    currentLedgerTime: number;
    validFromTime: number;
    validToSlot: number;
    validToTime: number;
  }> {
    const ogmiosEndpoint = this.configService.getOrThrow<string>('ogmiosEndpoint');
    const network = this.configService.get('cardanoNetwork') as Network;
    const slotConfig = this.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[network];
    if (!slotConfig || slotConfig.slotLength <= 0) {
      throw new GrpcInternalException(`send packet failed: invalid slot configuration for network ${network}`);
    }

    return computeLedgerAnchoredValidityWindow(ogmiosEndpoint, slotConfig, TRANSACTION_TIME_TO_LIVE);
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
          typeof assetAmount === 'bigint'
            ? assetAmount.toString()
            : assetAmount === undefined
              ? 'none'
              : String(assetAmount);
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
    commit: StateRootResult['commit'];
  }> {
    const hostStateUtxo: UTxO = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }

    const hostStateDatum: HostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(
      hostStateUtxo.datum,
      'host_state',
    );

    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root, hostStateUtxo);

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
    } = await this.ibcTreeStore.computeRootWithHandlePacketUpdate(
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

  private async buildHostStateUpdateForPrunePacketHistory(
    inputChannelDatum: ChannelDatum,
    channelId: string,
    sequence: bigint,
  ): Promise<{
    hostStateUtxo: UTxO;
    encodedHostStateRedeemer: string;
    encodedUpdatedHostStateDatum: string;
    newRoot: string;
    commit: StateRootResult['commit'];
  }> {
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) {
      throw new GrpcInternalException('HostState UTXO has no datum');
    }

    const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
    await this.ensureTreeAligned(hostStateDatum.state.ibc_state_root, hostStateUtxo);

    const { newRoot, packetReceiptSiblings, packetAcknowledgementSiblings, commit } =
      this.ibcTreeStore.computeRootWithPrunePacketHistoryUpdate(
        hostStateDatum.state.ibc_state_root,
        convertHex2String(inputChannelDatum.port),
        channelId,
        sequence,
        inputChannelDatum.state.channel.ordering,
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
    const encodedHostStateRedeemer = await this.lucidService.encode(
      {
        HandlePacket: {
          channel_siblings: [],
          next_sequence_send_siblings: [],
          next_sequence_recv_siblings: [],
          next_sequence_ack_siblings: [],
          packet_commitment_siblings: [],
          packet_receipt_siblings: packetReceiptSiblings,
          packet_acknowledgement_siblings: packetAcknowledgementSiblings,
        },
      },
      'host_state_redeemer',
    );

    return {
      hostStateUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum: await this.lucidService.encode(updatedHostStateDatum, 'host_state'),
      newRoot,
      commit,
    };
  }

  async prunePacketHistory(pruneOperator: PrunePacketHistoryOperator): Promise<MsgPrunePacketHistoryResponse> {
    try {
      const { unsignedTx, pendingTreeUpdate } = await this.buildUnsignedPrunePacketHistoryTx(pruneOperator);
      const { validFromTime, validToTime } = await this.computeTxValidityWindow();
      const { unsignedTxBytes } = await this.txOperationRunnerService.run({
        operationName: 'prunePacketHistory',
        unsignedTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(validFromTime).validTo(validToTime),
        },
        wallet: {
          mode: 'refresh_from_address',
          address: pruneOperator.signer,
          context: 'prunePacketHistory',
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate,
      });

      return {
        unsigned_tx: { type_url: '', value: unsignedTxBytes },
      };
    } catch (error) {
      this.logger.error(`prunePacketHistory: ${error}`);
      if (error instanceof RpcException) {
        throw error;
      }
      throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
    }
  }

  async buildUnsignedPrunePacketHistoryTx(
    pruneOperator: PrunePacketHistoryOperator,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
    const channelSequence = parseChannelSequence(pruneOperator.channelId);
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(channelSequence);
    const channelTokenUnit = mintChannelPolicyId + channelTokenName;
    const channelUtxo = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    if (!channelUtxo.datum) {
      throw new GrpcInternalException(`Channel ${pruneOperator.channelId} has no datum`);
    }
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum, 'channel');
    if (convertHex2String(channelDatum.port) !== pruneOperator.portId) {
      throw new GrpcFailedPreconditionException(
        `Channel ${pruneOperator.channelId} belongs to port ${convertHex2String(channelDatum.port)}, not ${pruneOperator.portId}`,
      );
    }
    const ordering = channelDatum.state.channel.ordering;
    if (ordering !== 'Unordered' && ordering !== 'Ordered') {
      throw new GrpcFailedPreconditionException(`Packet history pruning is not valid for channel ordering ${ordering}`);
    }
    if (ordering === 'Ordered' && pruneOperator.sequence >= channelDatum.state.next_sequence_recv) {
      throw new GrpcFailedPreconditionException(
        `Ordered packet sequence ${pruneOperator.sequence} has not been received on ${pruneOperator.channelId}`,
      );
    }
    if (ordering === 'Unordered' && !channelDatum.state.packet_receipt.has(pruneOperator.sequence)) {
      throw new GrpcFailedPreconditionException(
        `Packet receipt ${pruneOperator.sequence} does not exist on ${pruneOperator.channelId}`,
      );
    }
    if (!channelDatum.state.packet_acknowledgement.has(pruneOperator.sequence)) {
      throw new GrpcFailedPreconditionException(
        `Packet acknowledgement ${pruneOperator.sequence} does not exist on ${pruneOperator.channelId}`,
      );
    }
    if (!isHeightAtLeast(pruneOperator.proofHeight, channelDatum.state.minimum_receive_proof_height)) {
      throw new GrpcFailedPreconditionException(
        `Prune proof height ${pruneOperator.proofHeight.revisionNumber}/${pruneOperator.proofHeight.revisionHeight} ` +
          `is below the channel history floor ${channelDatum.state.minimum_receive_proof_height.revisionNumber}/${channelDatum.state.minimum_receive_proof_height.revisionHeight}`,
      );
    }
    if (!isHeightAtLeast(pruneOperator.proofHeight, channelDatum.state.maximum_receive_proof_height)) {
      throw new GrpcFailedPreconditionException(
        `Prune proof height ${pruneOperator.proofHeight.revisionNumber}/${pruneOperator.proofHeight.revisionHeight} ` +
          `is below the channel receive high-water mark ${channelDatum.state.maximum_receive_proof_height.revisionNumber}/${channelDatum.state.maximum_receive_proof_height.revisionHeight}`,
      );
    }

    const connectionSequence = parseConnectionSequence(
      convertHex2String(channelDatum.state.channel.connection_hops[0]),
    );
    const [mintConnectionPolicyId, connectionTokenName] = this.lucidService.getConnectionTokenUnit(connectionSequence);
    const connectionUtxo = await this.lucidService.findUtxoByUnit(mintConnectionPolicyId + connectionTokenName);
    const connectionDatum = await this.lucidService.decodeDatum<ConnectionDatum>(connectionUtxo.datum!, 'connection');
    const clientTokenUnit = this.lucidService.getClientTokenUnit(
      parseClientSequence(convertHex2String(connectionDatum.state.client_id)),
    );
    const clientUtxo = await this.lucidService.findUtxoByUnit(clientTokenUnit);
    const { clientDatum, historyWitnesses } = await this.lucidService.resolveClientAtHeights(clientUtxo, [
      pruneOperator.proofHeight,
    ]);
    const consensusEntry = [...clientDatum.state.consensusStates.entries()].find(
      ([height]) =>
        height.revisionNumber === pruneOperator.proofHeight.revisionNumber &&
        height.revisionHeight === pruneOperator.proofHeight.revisionHeight,
    );
    if (!consensusEntry) {
      throw new GrpcFailedPreconditionException(
        `Missing consensus state at prune proof height ${pruneOperator.proofHeight.revisionNumber}/${pruneOperator.proofHeight.revisionHeight}`,
      );
    }
    const processedTime = getHeightMapValue(clientDatum.state.processedTimes, consensusEntry[0]);
    const processedHeight = getHeightMapValue(clientDatum.state.processedHeights, consensusEntry[0]);
    if (processedTime == null || processedHeight == null) {
      throw new GrpcFailedPreconditionException('Missing processed delay metadata at prune proof height');
    }

    const spendChannelRedeemer: SpendChannelRedeemer = {
      PrunePacketHistory: {
        sequence: pruneOperator.sequence,
        proof_commitment_absence: pruneOperator.proofCommitmentAbsence,
        proof_height: pruneOperator.proofHeight,
      },
    };
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        packet_receipt:
          ordering === 'Unordered'
            ? deleteKeySortMap(channelDatum.state.packet_receipt, pruneOperator.sequence)
            : channelDatum.state.packet_receipt,
        packet_acknowledgement: deleteKeySortMap(channelDatum.state.packet_acknowledgement, pruneOperator.sequence),
        minimum_receive_proof_height: pruneOperator.proofHeight,
      },
    };
    const encodedSpendChannelRedeemer = await this.lucidService.encode(spendChannelRedeemer, 'spendChannelRedeemer');
    const encodedUpdatedChannelDatum = await this.lucidService.encode(updatedChannelDatum, 'channel');
    const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
      await this.buildHostStateUpdateForPrunePacketHistory(
        channelDatum,
        pruneOperator.channelId,
        pruneOperator.sequence,
      );

    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyNonMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusEntry[1],
        height: pruneOperator.proofHeight,
        processed_time: processedTime,
        processed_height: processedHeight,
        delay_time_period: connectionDatum.state.delay_period,
        delay_block_period: getBlockDelay(connectionDatum.state.delay_period),
        proof: pruneOperator.proofCommitmentAbsence,
        path: {
          key_path: [
            connectionDatum.state.counterparty.prefix.key_prefix,
            convertString2Hex(
              packetCommitmentPath(
                convertHex2String(channelDatum.state.channel.counterparty.port_id),
                convertHex2String(channelDatum.state.channel.counterparty.channel_id),
                pruneOperator.sequence,
              ),
            ),
          ],
        },
      },
    };
    const deploymentConfig = this.configService.get('deployment');
    const prunePacketHistoryPolicyId =
      deploymentConfig.validators.spendChannel.refValidator.prune_packet_history.scriptHash;
    const verifyProofPolicyId = deploymentConfig.validators.verifyProof.scriptHash;
    const unsignedDto: UnsignedPrunePacketHistoryDto = {
      hostStateUtxo,
      channelUtxo,
      connectionUtxo,
      clientUtxo,
      encodedHostStateRedeemer,
      encodedUpdatedHostStateDatum,
      encodedSpendChannelRedeemer,
      encodedUpdatedChannelDatum,
      channelTokenUnit,
      prunePacketHistoryPolicyId,
      channelToken: { policyId: mintChannelPolicyId, name: channelTokenName },
      verifyProofPolicyId,
      encodedVerifyProofRedeemer: encodeVerifyProofRedeemer(
        verifyProofRedeemer,
        this.lucidService.LucidImporter,
        historyWitnesses[0] ?? null,
      ),
    };

    return {
      unsignedTx: await this.lucidService.createUnsignedPrunePacketHistoryTx(unsignedDto),
      pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
    };
  }

  async recvPacket(data: MsgRecvPacket): Promise<MsgRecvPacketResponse> {
    try {
      this.logger.log('RecvPacket data: ', data);
      const { constructedAddress, recvPacketOperator } = validateAndFormatRecvPacketParams(data);
      await this.refreshWalletContext(constructedAddress, 'recvPacketBuilder');
      // Build and complete the unsigned transaction
      const {
        unsignedTx: unsignedRecvPacketTx,
        pendingTreeUpdate,
      } = await this.buildUnsignedRecvPacketTx(recvPacketOperator);

      const deploymentConfig = this.configService.get('deployment');
      this.logRecvPacketRawConfig('pre_complete', unsignedRecvPacketTx, [
        ['recvPacketRefScript', deploymentConfig.validators.spendChannel.refValidator.recv_packet?.refUtxo],
        ['verifyProofRefScript', deploymentConfig.validators.verifyProof?.refUtxo],
      ]);

      const { currentSlot, validFromTime, validToTime: initialValidToTime } = await this.computeTxValidityWindow();
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
          apply: (builder: TxBuilder) => builder.validFrom(validFromTime).validTo(validToTime),
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
      this.logRecvPacketDebug(
        () => `[DEBUG recvPacket] error.inspect=${inspect(error, { depth: 8, breakLength: 120 })}`,
      );
      const cause = (error as { cause?: unknown })?.cause;
      if (cause) {
        this.logRecvPacketDebug(
          () => `[DEBUG recvPacket] error.cause=${inspect(cause, { depth: 8, breakLength: 120 })}`,
        );
      }
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      } else {
        throw error;
      }
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
      const { currentSlot, validFromTime, validToSlot, validToTime } = await this.computeTxValidityWindow();
      if (currentSlot > validToSlot) {
        throw new GrpcInternalException('async-icq send failed: tx time invalid');
      }

      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'sendAsyncIcqPacket',
        unsignedTx: unsignedSendPacketTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(validFromTime).validTo(validToTime),
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
      const { constructedAddress, timeoutPacketOperator } = validateAndFormatTimeoutPacketParams(
        data,
      );
      const buildTimeoutAttempt = async () => {
        await this.refreshWalletContext(constructedAddress, 'timeoutPacketBuilder');
        return this.buildUnsignedTimeoutPacketTx(timeoutPacketOperator, constructedAddress);
      };
      const timeoutAttempt = await buildTimeoutAttempt();
      const unsignedSendPacketTx = timeoutAttempt.unsignedTx;
      let pendingTreeUpdate = timeoutAttempt.pendingTreeUpdate;
      const { validFromTime, validToTime } = await this.computeTxValidityWindow();
      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'timeoutPacket',
        unsignedTx: unsignedSendPacketTx,
        rebuildUnsignedTx: async () => {
          const rebuilt = await buildTimeoutAttempt();
          pendingTreeUpdate = rebuilt.pendingTreeUpdate;
          return rebuilt.unsignedTx;
        },
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(validFromTime).validTo(validToTime),
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
        pendingTreeUpdate: () => pendingTreeUpdate,
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

  async timeoutOnClosePacket(data: MsgTimeoutOnClose): Promise<MsgTimeoutOnCloseResponse> {
    try {
      this.logger.log('timeoutOnClosePacket is processing');
      const { constructedAddress, timeoutOnClosePacketOperator } = validateAndFormatTimeoutOnClosePacketParams(
        data,
      );
      const buildTimeoutOnCloseAttempt = async () => {
        await this.refreshWalletContext(constructedAddress, 'timeoutOnClosePacketBuilder');
        return this.buildUnsignedTimeoutOnClosePacketTx(timeoutOnClosePacketOperator, constructedAddress);
      };
      const timeoutOnCloseAttempt = await buildTimeoutOnCloseAttempt();
      const unsignedTimeoutOnClosePacketTx = timeoutOnCloseAttempt.unsignedTx;
      let pendingTreeUpdate = timeoutOnCloseAttempt.pendingTreeUpdate;
      const { validFromTime, validToTime } = await this.computeTxValidityWindow();
      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'timeoutOnClosePacket',
        unsignedTx: unsignedTimeoutOnClosePacketTx,
        rebuildUnsignedTx: async () => {
          const rebuilt = await buildTimeoutOnCloseAttempt();
          pendingTreeUpdate = rebuilt.pendingTreeUpdate;
          return rebuilt.unsignedTx;
        },
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(validFromTime).validTo(validToTime),
        },
        wallet: {
          mode: 'refresh_from_address',
          address: constructedAddress,
          context: 'timeoutOnClosePacket',
        },
        completeOptions: {
          localUPLCEval: false,
          setCollateral: TRANSACTION_SET_COLLATERAL,
        },
        pendingTreeUpdate: () => pendingTreeUpdate,
      });

      this.logger.log('Returning unsigned tx for timeout on close packet');
      return {
        result: ResponseResultType.RESPONSE_RESULT_TYPE_UNSPECIFIED,
        unsigned_tx: {
          type_url: '',
          value: cborHexBytes,
        },
      } as unknown as MsgTimeoutOnCloseResponse;
    } catch (error) {
      this.logger.error(`TimeoutOnClose: ${error}`);
      if (!(error instanceof RpcException)) {
        throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
      }

      throw error;
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
      } = await this.buildUnsignedAcknowlegementPacketTx(ackPacketOperator, constructedAddress);
      const { validFromTime, validToTime } = await this.computeTxValidityWindow();
      const { unsignedTxBytes: cborHexBytes } = await this.txOperationRunnerService.run({
        operationName: 'acknowledgementPacket',
        unsignedTx: unsignedAckPacketTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(validFromTime).validTo(validToTime),
        },
        wallet: {
          mode: 'custom_before_complete',
          run: async () => {
            await this.refreshWalletContext(
              constructedAddress,
              walletSelection?.context ?? 'acknowledgementPacket',
              walletSelection?.excludeAssetUnit ? { excludeAssetUnit: walletSelection.excludeAssetUnit } : undefined,
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
  async buildUnsignedRecvPacketTx(
    recvPacketOperator: RecvPacketOperator,
  ): Promise<{
    unsignedTx: TxBuilder;
    pendingTreeUpdate?: PendingTreeUpdate;
  }> {
    const channelSequence: string = recvPacketOperator.channelId.replaceAll(`${CHANNEL_ID_PREFIX}-`, '');
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel datum
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    this.requireQueryChannel(channelDatum);
    validateRecvPacketHistoryCapacity(channelDatum);
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
    const { clientDatum, historyWitnesses } = await this.lucidService.resolveClientAtHeights(clientUtxo, [
      recvPacketOperator.proofHeight,
    ]);
    // Get the keys (heights) of the map and convert them into an array
    const heightsArray = Array.from(clientDatum.state.consensusStates.keys());

    if (!isValidProofHeight(heightsArray, recvPacketOperator.proofHeight)) {
      throw new GrpcInternalException(
        `Invalid proof height: ${recvPacketOperator.proofHeight.revisionNumber}/${recvPacketOperator.proofHeight.revisionHeight}`,
      );
    }
    if (!isHeightAtLeast(recvPacketOperator.proofHeight, channelDatum.state.minimum_receive_proof_height)) {
      throw new GrpcFailedPreconditionException(
        `RecvPacket proof height ${recvPacketOperator.proofHeight.revisionNumber}/${recvPacketOperator.proofHeight.revisionHeight} ` +
          `is below the channel history floor ${channelDatum.state.minimum_receive_proof_height.revisionNumber}/${channelDatum.state.minimum_receive_proof_height.revisionHeight}`,
      );
    }
    // check packet receipt has sequence packet
    if (channelDatum.state.packet_receipt.has(recvPacketOperator.packetSequence)) {
      throw new GrpcInternalException(
        `PacketReceivedException: Packet with sequence ${recvPacketOperator.packetSequence} has recieved`,
      );
    }
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
    const processedTime = getHeightMapValue(clientDatum.state.processedTimes, consensusEntry[0]);
    const processedHeight = getHeightMapValue(clientDatum.state.processedHeights, consensusEntry[0]);
    if (processedTime == null || processedHeight == null) {
      throw new GrpcInternalException(`Missing processed delay metadata at proof height revisionNumber/revisionHeight`);
    }
    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: recvPacketOperator.proofHeight,
        processed_time: processedTime,
        processed_height: processedHeight,
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
      historyWitnesses[0] ?? null,
    );

    if (convertHex2String(channelDatum.port) === ASYNC_ICQ_HOST_PORT) {
      // Async-icq rides the normal recv-packet path. The difference from ICS-20 is
      // only how the packet data is interpreted and how the ack is produced.
      const moduleConfig = getGatewayModuleConfigForPortId(
        this.configService.getOrThrow('deployment'),
        ASYNC_ICQ_HOST_PORT,
      );
      const moduleUtxo = await this.lucidService.findUtxoByUnit(moduleConfig.identifier);
      const { acknowledgementResponse } = await this.asyncIcqHostService.executePacket(Buffer.from(packet.data, 'hex'));
      // Reuse the existing module callback envelope so Cardano emits a regular
      // write_acknowledgement event and persists the ack commitment in channel state.
      const encodedSpendModuleRedeemer: string = await this.lucidService.encode(
        {
          Callback: [
            {
              OnRecvPacket: {
                channel_id: channelId,
                packet_data: packet.data,
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
          maximum_receive_proof_height: maximumHeight(
            channelDatum.state.maximum_receive_proof_height,
            recvPacketOperator.proofHeight,
          ),
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
      const unsignedTx = await this.lucidService.createUnsignedRecvPacketModuleTx(unsignedRecvPacketModuleParams);
      return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
    }

    throw new GrpcInvalidArgumentException('Inline packet receive supports the icqhost port only');
  }

  async buildUnsignedTimeoutPacketTx(
    timeoutPacketOperator: TimeoutPacketOperator,
    constructedAddress: string,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
    return this.buildUnsignedTimeoutLikePacketTx(timeoutPacketOperator, constructedAddress, null);
  }

  async buildUnsignedTimeoutOnClosePacketTx(
    timeoutOnClosePacketOperator: TimeoutOnClosePacketOperator,
    constructedAddress: string,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
    return this.buildUnsignedTimeoutLikePacketTx(timeoutOnClosePacketOperator, constructedAddress, {
      proofClose: timeoutOnClosePacketOperator.proofClose,
      counterpartyUpgradeSequence: timeoutOnClosePacketOperator.counterpartyUpgradeSequence,
    });
  }
  private async buildUnsignedTimeoutLikePacketTx(
    timeoutPacketOperator: TimeoutPacketOperator,
    constructedAddress: string,
    close: Pick<TimeoutOnClosePacketOperator, 'proofClose' | 'counterpartyUpgradeSequence'> | null,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate }> {
    const channelSequence = parseChannelSequence(convertHex2String(timeoutPacketOperator.packet.source_channel));
    // Get the token unit associated with the client
    const [mintChannelPolicyId, channelTokenName] = this.lucidService.getChannelTokenUnit(BigInt(channelSequence));
    const channelTokenUnit: string = mintChannelPolicyId + channelTokenName;
    const channelUtxo: UTxO = await this.lucidService.findUtxoByUnit(channelTokenUnit);
    // Get channel end
    const channelDatum: ChannelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    this.requireQueryChannel(channelDatum);
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
    const { clientDatum, historyWitnesses } = await this.lucidService.resolveClientAtHeights(clientUtxo, [
      timeoutPacketOperator.proofHeight,
    ]);
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
    const isTimeoutOnClose = close !== null;
    const channelOrder = ORDER_MAPPING_CHANNEL[channelDatum.state.channel.ordering];
    const isOrdered = channelOrder === ChannelOrder.ORDER_ORDERED;
    const isUnordered = channelOrder === ChannelOrder.ORDER_UNORDERED;
    if (!isOrdered && !isUnordered) {
      throw new GrpcFailedPreconditionException(
        `Packet timeout is not valid for channel ordering ${channelDatum.state.channel.ordering}`,
      );
    }
    if (
      channelDatum.state.channel.state !== ChannelState.Open &&
      (!isTimeoutOnClose || channelDatum.state.channel.state !== ChannelState.Close)
    ) {
      throw new GrpcFailedPreconditionException(
        `${isTimeoutOnClose ? 'TimeoutOnClose' : 'Timeout'} is not valid for channel state ${channelDatum.state.channel.state}`,
      );
    }

    const updatedChannel =
      isOrdered && channelDatum.state.channel.state !== ChannelState.Close
        ? { ...channelDatum.state.channel, state: ChannelState.Close }
        : channelDatum.state.channel;
    const updatedChannelDatum: ChannelDatum = {
      ...channelDatum,
      state: {
        ...channelDatum.state,
        channel: updatedChannel,
        packet_commitment: deleteSortMap(channelDatum.state.packet_commitment, packetSequence),
      },
    };
    const spendChannelRedeemer: SpendChannelRedeemer = isTimeoutOnClose
      ? {
          TimeoutOnClose: {
            packet,
            proof_unreceived: timeoutPacketOperator.proofUnreceived,
            proof_close: close.proofClose,
            proof_height: timeoutPacketOperator.proofHeight,
            next_sequence_recv: timeoutPacketOperator.nextSequenceRecv,
            counterparty_upgrade_sequence: close.counterpartyUpgradeSequence,
          },
        }
      : {
          TimeoutPacket: {
            packet,
            proof_unreceived: timeoutPacketOperator.proofUnreceived,
            proof_height: timeoutPacketOperator.proofHeight,
            next_sequence_recv: timeoutPacketOperator.nextSequenceRecv,
          },
        };

    const moduleConfig = getGatewayModuleConfigForPortId(
      this.configService.getOrThrow('deployment'),
      convertHex2String(packet.source_port),
    );
    if (moduleConfig.key === 'transfer') throw new GrpcInvalidArgumentException('ICS-20 timeouts use packet lanes');
    const moduleUtxo = await this.lucidService.findUtxoByUnit(moduleConfig.identifier);
    const localChannelId = `${CHANNEL_ID_PREFIX}-${channelSequence}`;
    const encodedSpendChannelRedeemer = await this.lucidService.encode(spendChannelRedeemer, 'spendChannelRedeemer');
    const encodedUpdatedChannelDatum = await this.lucidService.encode(updatedChannelDatum, 'channel');
    const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
      await this.buildHostStateUpdateForHandlePacket(channelDatum, updatedChannelDatum, localChannelId);
    const encodedSpendModuleRedeemer = await this.lucidService.encode(
      {
        Callback: [
          { OnTimeoutPacket: { channel_id: packet.source_channel, packet_data: packet.data, data: 'OtherModuleData' } },
        ],
      } as IBCModuleRedeemer,
      'iBCModuleRedeemer',
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
    const processedTime = getHeightMapValue(clientDatum.state.processedTimes, consensusEntry[0]);
    const processedHeight = getHeightMapValue(clientDatum.state.processedHeights, consensusEntry[0]);
    if (processedTime == null || processedHeight == null) {
      throw new GrpcInternalException(`Missing processed delay metadata at proof height revisionNumber/revisionHeight`);
    }
    const proofContext = {
      cs: clientDatum.state.clientState,
      cons_state: consensusState,
      height: timeoutPacketOperator.proofHeight,
      processed_time: processedTime,
      processed_height: processedHeight,
      delay_time_period: connectionDatum.state.delay_period,
      delay_block_period: getBlockDelay(connectionDatum.state.delay_period),
    };
    const proofPrefix = connectionDatum.state.counterparty.prefix.key_prefix;
    const counterpartyPortId = convertHex2String(channelDatum.state.channel.counterparty.port_id);
    const counterpartyChannelId = convertHex2String(channelDatum.state.channel.counterparty.channel_id);
    const unreceivedMembership = {
      ...proofContext,
      proof: timeoutPacketOperator.proofUnreceived,
      path: {
        key_path: [
          proofPrefix,
          convertString2Hex(`nextSequenceRecv/ports/${counterpartyPortId}/channels/${counterpartyChannelId}`),
        ],
      },
      value: uint64ToBigEndianHex(timeoutPacketOperator.nextSequenceRecv),
    };
    const unreceivedNonMembership = {
      ...proofContext,
      proof: timeoutPacketOperator.proofUnreceived,
      path: {
        key_path: [
          proofPrefix,
          convertString2Hex(packetReceiptPath(counterpartyPortId, counterpartyChannelId, packet.sequence)),
        ],
      },
    };

    let verifyProofRedeemer: VerifyProofRedeemer;
    if (!isTimeoutOnClose) {
      verifyProofRedeemer = isOrdered
        ? { VerifyMembership: unreceivedMembership }
        : { VerifyNonMembership: unreceivedNonMembership };
    } else {
      const localPortId = convertHex2String(channelDatum.port);
      const expectedCounterpartyClosedChannel: CardanoChannel = {
        state: CardanoChannelState.STATE_CLOSED,
        ordering: orderFromJSON(channelOrder),
        counterparty: {
          port_id: localPortId,
          channel_id: localChannelId,
        },
        connection_hops: [convertHex2String(connectionDatum.state.counterparty.connection_id)],
        version: convertHex2String(channelDatum.state.channel.version),
        upgrade_sequence: close.counterpartyUpgradeSequence,
      };
      const closedChannelMembership = {
        ...proofContext,
        proof: close.proofClose,
        path: {
          key_path: [proofPrefix, convertString2Hex(channelPath(counterpartyPortId, counterpartyChannelId))],
        },
        value: toHex(CardanoChannel.encode(expectedCounterpartyClosedChannel).finish()),
      };

      verifyProofRedeemer = isOrdered
        ? {
            BatchVerifyMembership: [[unreceivedMembership, closedChannelMembership]],
          }
        : {
            BatchVerifyMembershipAndNonMembership: {
              memberships: [closedChannelMembership],
              non_memberships: [unreceivedNonMembership],
            },
          };
    }

    const encodedVerifyProofRedeemer: string = encodeVerifyProofRedeemer(
      verifyProofRedeemer,
      this.lucidService.LucidImporter,
      historyWitnesses[0] ?? null,
    );

    const unsignedTx = await this.lucidService.createUnsignedTimeoutPacketModuleTx({
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
      constructedAddress,
      timeoutPacketPolicyId,
      channelToken,
      verifyProofPolicyId,
      encodedVerifyProofRedeemer,
    });
    return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: newRoot, commit } };
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
    this.requireQueryChannel(channelDatum);
    validateSendPacketCommitmentCapacity(channelDatum);
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
    const moduleConfig = getGatewayModuleConfigForPortId(
      this.configService.getOrThrow('deployment'),
      sendPacketOperator.sourcePort,
    );
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
    const packetCommitment = commitPacket(packet);

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
        Callback: [
          {
            OnSendPacket: {
              channel_id: channelId,
              packet_data: packet.data,
              packet_commitment: packetCommitment,
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
        next_sequence_send: channelDatum.state.next_sequence_send + 1n,
        packet_commitment: insertSortMapWithNumberKey(
          channelDatum.state.packet_commitment,
          packet.sequence,
          packetCommitment,
        ),
      },
    };
    const encodedUpdatedChannelDatum: string = await this.lucidService.encode<ChannelDatum>(
      updatedChannelDatum,
      'channel',
    );

    const { hostStateUtxo, encodedHostStateRedeemer, encodedUpdatedHostStateDatum, newRoot, commit } =
      await this.buildHostStateUpdateForHandlePacket(
        channelDatum,
        updatedChannelDatum,
        sendPacketOperator.sourceChannel,
      );
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

    const unsignedTx = await this.lucidService.createUnsignedSendPacketModuleTx(unsignedSendPacketModuleParams);
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
    this.requireQueryChannel(channelDatum);
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
    const { clientDatum, historyWitnesses } = await this.lucidService.resolveClientAtHeights(clientUtxo, [
      ackPacketOperator.proofHeight,
    ]);
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
    const createModuleAckRedeemer = (channelId: string, acknowledgementResponse: AcknowledgementResponse) => ({
      Callback: [
        {
          OnAcknowledgementPacket: {
            channel_id: channelId,
            packet_data: packet.data,
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
    const processedTime = getHeightMapValue(clientDatum.state.processedTimes, consensusEntry[0]);
    const processedHeight = getHeightMapValue(clientDatum.state.processedHeights, consensusEntry[0]);
    if (processedTime == null || processedHeight == null) {
      throw new GrpcInternalException(`Missing processed delay metadata at proof height revisionNumber/revisionHeight`);
    }
    const verifyProofRedeemer: VerifyProofRedeemer = {
      VerifyMembership: {
        cs: clientDatum.state.clientState,
        cons_state: consensusState,
        height: ackPacketOperator.proofHeight,
        processed_time: processedTime,
        processed_height: processedHeight,
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
      historyWitnesses[0] ?? null,
    );
    if (convertHex2String(packet.source_port) === ASYNC_ICQ_HOST_PORT) {
      const moduleConfig = getGatewayModuleConfigForPortId(
        this.configService.getOrThrow('deployment'),
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
      const unsignedTx = await this.lucidService.createUnsignedAckPacketModuleTx(unsignedAckPacketModuleParams);
      return {
        unsignedTx,
        pendingTreeUpdate: { expectedNewRoot: newRoot, commit },
        walletSelection: {
          context: 'acknowledgementPacket',
        },
      };
    }

    throw new GrpcInvalidArgumentException('Inline packet acknowledgement supports the icqhost port only');
  }
}
