import { Network, TxBuilder, UTxO } from '@lucid-evolution/lucid';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { packetLaneTokenName, sendSequencerTokenName } from '@cardano-ibc/tx-builder/dist/packet-lanes';
import type { ErrorReceiptValue } from '@cardano-ibc/tx-builder-runtime/channelDatum';
import { ResponseResultType } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import {
  MsgChannelUpgradeAck,
  MsgChannelUpgradeAckResponse,
  MsgChannelUpgradeCancel,
  MsgChannelUpgradeCancelResponse,
  MsgChannelUpgradeConfirm,
  MsgChannelUpgradeConfirmResponse,
  MsgChannelUpgradeFlush,
  MsgChannelUpgradeFlushResponse,
  MsgChannelUpgradeInit,
  MsgChannelUpgradeInitResponse,
  MsgChannelUpgradeOpen,
  MsgChannelUpgradeOpenResponse,
  MsgChannelUpgradeTimeout,
  MsgChannelUpgradeTimeoutResponse,
  MsgChannelUpgradeTry,
  MsgChannelUpgradeTryResponse,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/tx';
import { ErrorReceipt as ProtoErrorReceipt } from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/upgrade';
import { MerkleProof as ProtoMerkleProof } from '@cardano-ibc/proto-types/build/ibc/core/commitment/v1/commitment';
import { LucidService } from 'src/shared/modules/lucid/lucid.service';
import { GrpcInternalException, GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { CHANNEL_ID_PREFIX } from '~@/constant';
import { TRANSACTION_SET_COLLATERAL, TRANSACTION_TIME_TO_LIVE } from '~@/config/constant.config';
import type { DeploymentConfig } from '~@/config/bridge-manifest';
import { channelPath, channelUpgradeErrorPath, channelUpgradePath } from '~@/shared/helpers/channel';
import { convertHex2String, convertString2Hex, toHex } from '@shared/helpers/hex';
import { initializeMerkleProof } from '@shared/helpers/merkle-proof';
import { parseClientSequence, parseConnectionSequence } from '@shared/helpers/sequence';
import { getBlockDelay, getHeightMapValue } from '~@/shared/helpers/verify';
import { computeLedgerAnchoredValidityWindow } from '../shared/helpers/time';
import { IbcTreeStateStore, StaleIbcTreeStateError } from '../shared/helpers/ibc-state-root';
import { PendingTreeUpdate } from '../shared/services/ibc-tree-pending-updates.service';
import { AuthToken } from '@shared/types/auth-token';
import { ChannelDatum, encodeChannelEndValue, encodeChannelUpgradeRecords } from '@shared/types/channel/channel-datum';
import { SpendChannelRedeemer } from '@shared/types/channel/channel-redeemer';
import { ChannelUpgradeRedeemer, ChannelUpgradeStep } from '@shared/types/channel/channel-upgrade-redeemer';
import { normalizeTxsResultFromChannelUpgrade } from '@shared/helpers/block-results';
import { ChannelState } from '@shared/types/channel/state';
import { ConnectionDatum } from '@shared/types/connection/connection-datum';
import { State as ConnectionState } from '@shared/types/connection/state';
import { VerifyMembershipParams } from '@shared/types/connection/verify-membership-params';
import { VerifyProofRedeemer, encodeVerifyProofRedeemer } from '~@/shared/types/connection/verify-proof-redeemer';
import { HostStateDatum } from '@shared/types/host-state-datum';
import { Height } from '@shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';
import { ChannelUpgradeOperation } from '@shared/modules/lucid/dtos';
import { decodeMerkleProof } from './helper/helper';
import * as upgrade from './helper/channel-upgrade';
import {
  channelFromProto,
  channelStateFromProto,
  encodeChannelProto,
  encodeUpgradeProto,
  errorReceiptFromProto,
  errorReceiptToProto,
  upgradeFieldsFromProto,
  upgradeFromProto,
  upgradeToProto,
} from '../shared/helpers/channel-upgrade-proto';
import { TxOperationRunnerService } from './tx-operation-runner.service';

/** FLUSH certifies at most this many lanes per transaction. */
export const MAX_FLUSH_LANES_PER_TX = 8;

type Connection = { utxo: UTxO; datum: ConnectionDatum; id: string };

type StepContext = {
  hostStateUtxo: UTxO;
  hostStateDatum: HostStateDatum;
  channelUtxo: UTxO;
  channelDatum: ChannelDatum;
  channelToken: AuthToken;
  portId: string;
  channelId: string;
  validFromTime: number;
  validToTime: number;
};

type ProofClient = {
  utxo: UTxO;
  membership: (proof: MerkleProof, path: string, value: Uint8Array) => VerifyMembershipParams;
  historyWitness: any;
  timestamp: bigint;
};

type Step = {
  updated: ChannelDatum;
  step: ChannelUpgradeStep;
  operation: ChannelUpgradeOperation;
  referenceInputs: UTxO[];
  proof?: { redeemer: VerifyProofRedeemer; historyWitness: any };
  authority?: boolean;
};

const OPERATIONS: Record<ChannelUpgradeOperation, 'chan_upgrade' | 'chan_upgrade_handshake' | 'chan_upgrade_finish'> = {
  channelUpgrade: 'chan_upgrade',
  channelUpgradeHandshake: 'chan_upgrade_handshake',
  channelUpgradeFinish: 'chan_upgrade_finish',
};

/**
 * ICS-04 upgrades of Cardano transfer channels to a replacement connection.
 * See cardano/onchain/lib/ibc/core/ics-004/channel_upgrade.ak for the rules.
 */
@Injectable()
export class ChannelUpgradeService {
  constructor(
    private readonly logger: Logger,
    private readonly configService: ConfigService,
    @Inject(LucidService) private readonly lucidService: LucidService,
    private readonly txOperationRunnerService: TxOperationRunnerService,
    private readonly ibcTreeStore: IbcTreeStateStore,
  ) {}

  async channelUpgradeInit(msg: MsgChannelUpgradeInit): Promise<MsgChannelUpgradeInitResponse> {
    return this.handle('channelUpgradeInit', msg, async (context) => {
      if (msg.expected_upgrade_sequence === undefined || msg.expected_upgrade_sequence !== context.channelDatum.state.channel.upgrade_sequence) {
        throw new GrpcInvalidArgumentException('channel upgrade: INIT requires the current expected upgrade sequence');
      }
      const fields = upgradeFieldsFromProto(msg.fields);
      const replacement = await this.connection(fields.connection_hops[0], true);
      const replacementClient = await this.readyClient(replacement, context.validToTime);
      const [version] = replacement.datum.state.versions;
      if (
        replacement.datum.state.versions.length !== 1 ||
        !version.features.includes(convertString2Hex('ORDER_UNORDERED'))
      ) {
        throw new GrpcInvalidArgumentException('channel upgrade: the replacement connection must support unordered');
      }
      const updated = upgrade.initUpgrade(context.channelDatum, fields, BigInt(msg.timeout_period_ms ?? 0n));
      return {
        step: { InitUpgrade: { fields, timeout_period: BigInt(msg.timeout_period_ms ?? 0n) } },
        updated,
        operation: 'channelUpgrade',
        referenceInputs: this.uniqueReferences([replacement.utxo, replacementClient]),
        authority: true,
      };
    }).then(({ unsigned_tx, updated }) => ({
      upgrade: upgradeToProto(updated.state.upgrade.pending!.upgrade),
      upgrade_sequence: updated.state.channel.upgrade_sequence,
      unsigned_tx,
    }));
  }

  async channelUpgradeTry(msg: MsgChannelUpgradeTry): Promise<MsgChannelUpgradeTryResponse> {
    return this.handle('channelUpgradeTry', msg, async (context) => {
      const datum = context.channelDatum;
      const pending = datum.state.upgrade.pending;
      if (!pending) {
        // The deployment authority chooses this end's replacement connection.
        throw new GrpcInvalidArgumentException(
          'channel upgrade: Cardano answers only a crossing proposal, the authority must INIT first',
        );
      }
      const proposed = (msg.proposed_upgrade_connection_hops ?? []).map(convertString2Hex);
      if (proposed.length && proposed.join() !== pending.upgrade.fields.connection_hops.join()) {
        throw new GrpcInvalidArgumentException('channel upgrade: proposed connection differs from the INIT proposal');
      }
      const counterpartyFields = upgradeFieldsFromProto(msg.counterparty_upgrade_fields);
      const counterpartySequence = BigInt(msg.counterparty_upgrade_sequence ?? 0n);
      const { current, replacement } = await this.connections(datum, pending.upgrade.fields.connection_hops[0]);
      const replacementClient = await this.readyClient(replacement, context.validToTime);
      upgrade.requireCompatibleUpgrade(
        pending.upgrade.fields,
        counterpartyFields,
        replacement.datum.state.counterparty.connection_id,
      );
      const proofHeight = this.height(msg.proof_height);
      const client = await this.proofClient(current, proofHeight);
      const lanes = await this.packetLanes();
      const sequencer = await this.sequencer(context, lanes.statePolicy);
      const updated = upgrade.tryUpgrade(
        datum,
        counterpartySequence,
        BigInt(context.validToTime),
        sequencer.nextSequenceSend,
      );
      const proofChannel = this.proof(msg.proof_channel);
      const proofUpgrade = this.proof(msg.proof_upgrade);
      const counterpartyChannel = this.counterpartyChannel(
        context,
        ChannelState.Open,
        datum.state.channel.ordering,
        datum.state.channel.version,
        current.datum.state.counterparty.connection_id,
        counterpartySequence,
      );
      return {
        step: {
          TryUpgrade: {
            counterparty_upgrade_fields: counterpartyFields,
            counterparty_upgrade_sequence: counterpartySequence,
            proof_channel: proofChannel,
            proof_upgrade: proofUpgrade,
            proof_height: proofHeight,
          },
        },
        updated,
        operation: 'channelUpgradeHandshake',
        referenceInputs: this.uniqueReferences([current.utxo, replacement.utxo, client.utxo, lanes.config, sequencer.utxo, replacementClient]),
        proof: this.channelAndUpgradeProof(context, client, proofChannel, counterpartyChannel, proofUpgrade, {
          fields: counterpartyFields,
          timeout: { height: { revisionNumber: 0n, revisionHeight: 0n }, timestamp: 0n },
          next_sequence_send: 0n,
        }),
      };
    }).then(({ unsigned_tx, updated }) => ({
      upgrade: upgradeToProto(updated.state.upgrade.pending!.upgrade),
      upgrade_sequence: updated.state.channel.upgrade_sequence,
      result: ResponseResultType.RESPONSE_RESULT_TYPE_SUCCESS,
      unsigned_tx,
    }));
  }

  async channelUpgradeAck(msg: MsgChannelUpgradeAck): Promise<MsgChannelUpgradeAckResponse> {
    return this.handle('channelUpgradeAck', msg, async (context) => {
      const datum = context.channelDatum;
      const pending = this.pending(datum);
      const counterpartyUpgrade = upgradeFromProto(msg.counterparty_upgrade);
      const { current, replacement } = await this.connections(datum, pending.upgrade.fields.connection_hops[0]);
      const replacementClient = await this.readyClient(replacement, context.validToTime);
      upgrade.requireCompatibleUpgrade(
        pending.upgrade.fields,
        counterpartyUpgrade.fields,
        replacement.datum.state.counterparty.connection_id,
      );
      const proofHeight = this.height(msg.proof_height);
      const client = await this.proofClient(current, proofHeight);
      const lanes = await this.packetLanes();
      // ACK on an open channel starts this end's flush.
      const sequencer =
        datum.state.channel.state === ChannelState.Open ? await this.sequencer(context, lanes.statePolicy) : null;
      const updated = upgrade.ackUpgrade(
        datum,
        counterpartyUpgrade,
        BigInt(lanes.laneCount),
        BigInt(context.validToTime),
        sequencer?.nextSequenceSend ?? null,
      );
      const proofChannel = this.proof(msg.proof_channel);
      const proofUpgrade = this.proof(msg.proof_upgrade);
      return {
        step: {
          AckUpgrade: {
            counterparty_upgrade: counterpartyUpgrade,
            proof_channel: proofChannel,
            proof_upgrade: proofUpgrade,
            proof_height: proofHeight,
          },
        },
        updated,
        operation: 'channelUpgradeHandshake',
        referenceInputs: this.uniqueReferences([
          current.utxo,
          replacement.utxo,
          client.utxo,
          lanes.config,
          ...(sequencer ? [sequencer.utxo] : []),
          replacementClient,
        ]),
        proof: this.channelAndUpgradeProof(
          context,
          client,
          proofChannel,
          this.counterpartyChannel(
            context,
            ChannelState.Flushing,
            datum.state.channel.ordering,
            datum.state.channel.version,
            current.datum.state.counterparty.connection_id,
            datum.state.channel.upgrade_sequence,
          ),
          proofUpgrade,
          counterpartyUpgrade,
        ),
      };
    }).then(({ unsigned_tx }) => ({ result: ResponseResultType.RESPONSE_RESULT_TYPE_SUCCESS, unsigned_tx }));
  }

  async channelUpgradeConfirm(msg: MsgChannelUpgradeConfirm): Promise<MsgChannelUpgradeConfirmResponse> {
    return this.handle('channelUpgradeConfirm', msg, async (context) => {
      const datum = context.channelDatum;
      const pending = this.pending(datum);
      const counterpartyState = channelStateFromProto(msg.counterparty_channel_state);
      const counterpartyUpgrade = upgradeFromProto(msg.counterparty_upgrade);
      const { current, replacement } = await this.connections(datum, pending.upgrade.fields.connection_hops[0]);
      const replacementClient = await this.readyClient(replacement, context.validToTime);
      upgrade.requireCompatibleUpgrade(
        pending.upgrade.fields,
        counterpartyUpgrade.fields,
        replacement.datum.state.counterparty.connection_id,
      );
      const proofHeight = this.height(msg.proof_height);
      const client = await this.proofClient(current, proofHeight);
      const lanes = await this.packetLanes();
      const updated = upgrade.confirmUpgrade(
        datum,
        counterpartyState,
        counterpartyUpgrade,
        BigInt(lanes.laneCount),
        BigInt(context.validToTime),
      );
      const proofChannel = this.proof(msg.proof_channel);
      const proofUpgrade = this.proof(msg.proof_upgrade);
      return {
        step: {
          ConfirmUpgrade: {
            counterparty_channel_state: counterpartyState,
            counterparty_upgrade: counterpartyUpgrade,
            proof_channel: proofChannel,
            proof_upgrade: proofUpgrade,
            proof_height: proofHeight,
          },
        },
        updated,
        operation: 'channelUpgradeHandshake',
        referenceInputs: this.uniqueReferences([current.utxo, replacement.utxo, client.utxo, lanes.config, replacementClient]),
        proof: this.channelAndUpgradeProof(
          context,
          client,
          proofChannel,
          this.counterpartyChannel(
            context,
            counterpartyState,
            datum.state.channel.ordering,
            datum.state.channel.version,
            current.datum.state.counterparty.connection_id,
            datum.state.channel.upgrade_sequence,
          ),
          proofUpgrade,
          counterpartyUpgrade,
        ),
      };
    }).then(({ unsigned_tx }) => ({ result: ResponseResultType.RESPONSE_RESULT_TYPE_SUCCESS, unsigned_tx }));
  }

  async channelUpgradeOpen(msg: MsgChannelUpgradeOpen): Promise<MsgChannelUpgradeOpenResponse> {
    return this.handle('channelUpgradeOpen', msg, async (context) => {
      const datum = context.channelDatum;
      if (channelStateFromProto(msg.counterparty_channel_state) !== ChannelState.Open) {
        // ibc-go v8.7.0 cannot always tell that Cardano opened, so Cardano
        // opens only after its counterparty did.
        throw new GrpcInvalidArgumentException('channel upgrade: Cardano opens only after the counterparty is Open');
      }
      const pending = this.pending(datum);
      const counterpartySequence = BigInt(msg.counterparty_upgrade_sequence ?? 0n);
      const fields = pending.upgrade.fields;
      const { current, replacement } = await this.connections(datum, fields.connection_hops[0]);
      const proofHeight = this.height(msg.proof_height);
      const client = await this.proofClient(current, proofHeight);
      const updated = upgrade.openUpgrade(datum, counterpartySequence);
      const proofChannel = this.proof(msg.proof_channel);
      const counterpartyChannel = this.counterpartyChannel(
        context,
        ChannelState.Open,
        fields.ordering as ChannelDatum['state']['channel']['ordering'],
        fields.version,
        replacement.datum.state.counterparty.connection_id,
        counterpartySequence,
      );
      return {
        step: {
          OpenUpgrade: {
            counterparty_upgrade_sequence: counterpartySequence,
            proof_channel: proofChannel,
            proof_height: proofHeight,
          },
        },
        updated,
        operation: 'channelUpgradeFinish',
        referenceInputs: [current.utxo, replacement.utxo, client.utxo],
        proof: this.singleProof(
          client,
          client.membership(
            proofChannel,
            this.counterpartyChannelPath(context),
            encodeChannelProto(counterpartyChannel),
          ),
        ),
      };
    }).then(({ unsigned_tx }) => ({ unsigned_tx }));
  }

  async channelUpgradeTimeout(msg: MsgChannelUpgradeTimeout): Promise<MsgChannelUpgradeTimeoutResponse> {
    return this.handle('channelUpgradeTimeout', msg, async (context) => {
      const datum = context.channelDatum;
      const pending = this.pending(datum);
      const counterpartyChannel = channelFromProto(msg.counterparty_channel);
      const current = await this.connection(datum.state.channel.connection_hops[0], true);
      // TIMEOUT reads the replacement connection whether or not it is still open.
      const replacement = await this.connection(pending.upgrade.fields.connection_hops[0], false);
      const proofHeight = this.height(msg.proof_height);
      const client = await this.proofClient(current, proofHeight);
      const updated = upgrade.timeoutUpgrade(
        datum,
        counterpartyChannel,
        client.timestamp,
        replacement.datum.state.counterparty.connection_id,
      );
      const proofChannel = this.proof(msg.proof_channel);
      return {
        step: {
          TimeoutUpgrade: {
            counterparty_channel: counterpartyChannel,
            proof_channel: proofChannel,
            proof_height: proofHeight,
          },
        },
        updated,
        operation: 'channelUpgradeFinish',
        referenceInputs: [current.utxo, replacement.utxo, client.utxo],
        proof: this.singleProof(
          client,
          client.membership(
            proofChannel,
            this.counterpartyChannelPath(context),
            encodeChannelProto(counterpartyChannel),
          ),
        ),
      };
    }).then(({ unsigned_tx }) => ({ unsigned_tx }));
  }

  async channelUpgradeCancel(msg: MsgChannelUpgradeCancel): Promise<MsgChannelUpgradeCancelResponse> {
    return this.handle('channelUpgradeCancel', msg, async (context) => {
      const datum = context.channelDatum;
      const proofBytes = msg.proof_error_receipt ?? new Uint8Array();
      const errorReceipt: ErrorReceiptValue | null = proofBytes.length
        ? errorReceiptFromProto(msg.error_receipt)
        : null;
      if (proofBytes.length && !errorReceipt) {
        throw new GrpcInvalidArgumentException('channel upgrade: the proven error receipt is empty');
      }
      const updated = upgrade.cancelUpgrade(datum, errorReceipt);
      const proofHeight = this.height(msg.proof_height);
      const emptyProof = { proofs: [] } as MerkleProof;
      if (!errorReceipt) {
        // Without a receipt, only the deployment authority cancels.
        return {
          step: {
            CancelUpgrade: { error_receipt: null, proof_error_receipt: emptyProof, proof_height: proofHeight },
          },
          updated,
          operation: 'channelUpgradeFinish',
          referenceInputs: [],
          authority: true,
        };
      }
      const current = await this.connection(datum.state.channel.connection_hops[0], true);
      const client = await this.proofClient(current, proofHeight);
      const proof = this.proof(proofBytes);
      const counterparty = datum.state.channel.counterparty;
      return {
        step: { CancelUpgrade: { error_receipt: errorReceipt, proof_error_receipt: proof, proof_height: proofHeight } },
        updated,
        operation: 'channelUpgradeFinish',
        referenceInputs: [current.utxo, client.utxo],
        proof: this.singleProof(
          client,
          client.membership(
            proof,
            channelUpgradeErrorPath(
              convertHex2String(counterparty.port_id),
              convertHex2String(counterparty.channel_id),
            ),
            this.encodeErrorReceipt(errorReceipt),
          ),
        ),
      };
    }).then(({ unsigned_tx }) => ({ unsigned_tx }));
  }

  /** Certify the next drained packet lanes, up to MAX_FLUSH_LANES_PER_TX. */
  async channelUpgradeFlush(msg: MsgChannelUpgradeFlush): Promise<MsgChannelUpgradeFlushResponse> {
    let laneCount = 0n;
    return this.handle('channelUpgradeFlush', msg, async (context) => {
      const datum = context.channelDatum;
      const pending = this.pending(datum);
      const lanes = await this.packetLanes();
      laneCount = BigInt(lanes.laneCount);
      if (pending.flushed_lanes >= laneCount) {
        throw new GrpcInvalidArgumentException('channel upgrade: every packet lane is already certified');
      }
      const drained: UTxO[] = [];
      for (
        let lane = Number(pending.flushed_lanes);
        lane < lanes.laneCount && drained.length < MAX_FLUSH_LANES_PER_TX;
        lane++
      ) {
        const utxo = await this.lucidService.findUtxoByUnit(
          lanes.statePolicy + packetLaneTokenName(context.portId, context.channelId, lane, lanes.laneCount),
        );
        // PacketLaneDatum { port_id, channel_id, lane, lane_count, version, root, commitments, .. }
        const commitments = this.fields(utxo.datum)[6];
        if (!(commitments instanceof Map)) throw new GrpcInternalException('channel upgrade: malformed packet lane');
        if (commitments.size !== 0) break;
        drained.push(utxo);
      }
      if (drained.length === 0) {
        throw new GrpcInvalidArgumentException(
          `channel upgrade: packet lane ${pending.flushed_lanes} still has unsettled packets`,
        );
      }
      const lanesFlushed = BigInt(drained.length);
      const readiness: UTxO[] = [];
      if (pending.flushed_lanes + lanesFlushed === laneCount && pending.counterparty_upgrade) {
        const replacement = await this.connection(pending.upgrade.fields.connection_hops[0], true);
        readiness.push(replacement.utxo, await this.readyClient(replacement, context.validToTime));
      }
      return {
        step: { FlushUpgrade: { lanes: lanesFlushed } },
        updated: upgrade.flushUpgrade(datum, lanesFlushed, laneCount, BigInt(context.validToTime)),
        operation: 'channelUpgrade',
        referenceInputs: this.uniqueReferences([lanes.config, ...drained, ...readiness]),
      };
    }).then(({ unsigned_tx, updated }) => ({
      flushed_lanes: updated.state.upgrade.pending?.flushed_lanes ?? laneCount,
      lane_count: laneCount,
      unsigned_tx,
    }));
  }

  private async handle(
    operationName: string,
    msg: { port_id: string; channel_id: string; signer: string },
    build: (context: StepContext) => Promise<Step>,
  ): Promise<{ unsigned_tx: { type_url: string; value: Uint8Array }; updated: ChannelDatum }> {
    try {
      this.logger.log(`${operationName} is processing`);
      if (!msg.signer) throw new GrpcInvalidArgumentException('Invalid constructed address: Signer is not valid');
      const context = await this.context(msg.port_id, msg.channel_id);
      const step = await build(context);
      const { unsignedTx, pendingTreeUpdate, redeemer } = await this.buildTransaction(context, step);
      const { events } = normalizeTxsResultFromChannelUpgrade(
        redeemer,
        step.updated,
        context.channelId.slice(CHANNEL_ID_PREFIX.length + 1),
      );
      const { unsignedTxBytes } = await this.txOperationRunnerService.run({
        operationName,
        unsignedTx,
        validity: {
          apply: (builder: TxBuilder) => builder.validFrom(context.validFromTime).validTo(context.validToTime),
        },
        wallet: { mode: 'refresh_from_address', address: msg.signer, context: operationName },
        completeOptions: { localUPLCEval: false, setCollateral: TRANSACTION_SET_COLLATERAL },
        pendingTreeUpdate,
        syntheticEvents: events.map((event) => ({
          type: event.type,
          attributes: event.event_attribute.map(({ key, value }) => ({ key, value })),
        })),
      });
      return { unsigned_tx: { type_url: '', value: unsignedTxBytes }, updated: step.updated };
    } catch (error) {
      this.logger.error(`${operationName}: ${error}`);
      if (error instanceof RpcException || error instanceof StaleIbcTreeStateError) throw error;
      throw new GrpcInternalException(`An unexpected error occurred. ${error}`);
    }
  }

  private async context(portId: string, channelId: string): Promise<StepContext> {
    if (portId !== 'transfer') {
      throw new GrpcInvalidArgumentException('channel upgrade: only transfer channels can be upgraded');
    }
    const sequence = channelId?.startsWith(`${CHANNEL_ID_PREFIX}-`)
      ? channelId.slice(CHANNEL_ID_PREFIX.length + 1)
      : '';
    if (!/^(0|[1-9][0-9]*)$/.test(sequence)) {
      throw new GrpcInvalidArgumentException('Invalid argument: "channel_id" must be channel-{sequence}');
    }
    const [policyId, name] = this.lucidService.getChannelTokenUnit(BigInt(sequence));
    const channelUtxo = await this.lucidService.findUtxoByUnit(policyId + name);
    const channelDatum = await this.lucidService.decodeDatum<ChannelDatum>(channelUtxo.datum!, 'channel');
    if (convertHex2String(channelDatum.port) !== portId) {
      throw new GrpcInvalidArgumentException(`channel upgrade: ${channelId} is not bound to ${portId}`);
    }
    const hostStateUtxo = await this.lucidService.findUtxoAtHostStateNFT();
    if (!hostStateUtxo.datum) throw new GrpcInternalException('HostState UTXO has no datum');
    const hostStateDatum = await this.lucidService.decodeDatum<HostStateDatum>(hostStateUtxo.datum, 'host_state');
    const snapshot = await this.ibcTreeStore.getAlignedSnapshot();
    if (
      snapshot.root !== hostStateDatum.state.ibc_state_root ||
      snapshot.hostState.txHash !== hostStateUtxo.txHash ||
      snapshot.hostState.outputIndex !== hostStateUtxo.outputIndex
    ) {
      throw new StaleIbcTreeStateError('HostState changed while preparing the transaction, retry with current inputs');
    }
    const network = this.configService.get('cardanoNetwork') as Network;
    const slotConfig = this.lucidService.LucidImporter.SLOT_CONFIG_NETWORK?.[network];
    if (!slotConfig || slotConfig.slotLength <= 0) {
      throw new GrpcInternalException(`channel upgrade: invalid slot configuration for network ${network}`);
    }
    // Upgrade timeouts derive from the upper validity bound, so it is fixed
    // before the successor datum is built.
    const { validFromTime, validToTime } = await computeLedgerAnchoredValidityWindow(
      this.configService.getOrThrow<string>('ogmiosEndpoint'),
      slotConfig,
      TRANSACTION_TIME_TO_LIVE,
    );
    return {
      hostStateUtxo,
      hostStateDatum,
      channelUtxo,
      channelDatum,
      channelToken: { policyId, name },
      portId,
      channelId,
      validFromTime,
      validToTime,
    };
  }

  private async buildTransaction(
    context: StepContext,
    step: Step,
  ): Promise<{ unsignedTx: TxBuilder; pendingTreeUpdate: PendingTreeUpdate; redeemer: ChannelUpgradeRedeemer }> {
    const Lucid = this.lucidService.LucidImporter;
    const before = context.channelDatum.state;
    const after = step.updated.state;
    const oldRecords = await encodeChannelUpgradeRecords(before.upgrade, Lucid);
    const newRecords = await encodeChannelUpgradeRecords(after.upgrade, Lucid);
    const root = this.ibcTreeStore.computeRootWithUpgradeChannelUpdate(
      context.hostStateDatum.state.ibc_state_root,
      context.portId,
      context.channelId,
      {
        oldChannel: Buffer.from(await encodeChannelEndValue(before.channel, Lucid), 'hex'),
        newChannel: Buffer.from(await encodeChannelEndValue(after.channel, Lucid), 'hex'),
        oldUpgrade: oldRecords.upgrade,
        newUpgrade: newRecords.upgrade,
        oldErrorReceipt: oldRecords.errorReceipt,
        newErrorReceipt: newRecords.errorReceipt,
      },
    );
    const updatedHostStateDatum: HostStateDatum = {
      ...context.hostStateDatum,
      state: {
        ...context.hostStateDatum.state,
        version: context.hostStateDatum.state.version + 1n,
        ibc_state_root: root.newRoot,
        last_update_time: BigInt(Date.now()),
      },
    };
    const redeemer: ChannelUpgradeRedeemer = {
      step: step.step,
      channel_siblings: root.channelSiblings,
      upgrade_siblings: root.upgradeSiblings,
      error_receipt_siblings: root.errorReceiptSiblings,
    };
    const spendChannelRedeemer: SpendChannelRedeemer = { ChanUpgrade: redeemer };
    const deployment = this.configService.get<DeploymentConfig>('deployment')!;
    const unsignedTx = await this.lucidService.createUnsignedChannelUpgradeTransaction({
      hostStateUtxo: context.hostStateUtxo,
      encodedHostStateRedeemer: await this.lucidService.encode('UpgradeChannel', 'host_state_redeemer'),
      encodedUpdatedHostStateDatum: await this.lucidService.encode(updatedHostStateDatum, 'host_state'),
      channelUtxo: context.channelUtxo,
      channelToken: context.channelToken,
      encodedSpendChannelRedeemer: await this.lucidService.encode(spendChannelRedeemer, 'spendChannelRedeemer'),
      encodedUpdatedChannelDatum: await this.lucidService.encode(step.updated, 'channel'),
      operation: step.operation,
      operationPolicyId: deployment.validators.spendChannel.refValidator[OPERATIONS[step.operation]].scriptHash,
      referenceInputs: step.referenceInputs,
      proof: step.proof && {
        policyId: deployment.validators.verifyProof.scriptHash,
        encodedRedeemer: encodeVerifyProofRedeemer(step.proof.redeemer, Lucid, step.proof.historyWitness ?? null),
      },
      authorityKeyHash: step.authority ? context.hostStateDatum.deployer : undefined,
    });
    return { unsignedTx, pendingTreeUpdate: { expectedNewRoot: root.newRoot, commit: root.commit }, redeemer };
  }

  private pending(datum: ChannelDatum) {
    const pending = datum.state.upgrade.pending;
    if (!pending) throw new GrpcInvalidArgumentException('channel upgrade: the channel has no upgrade in progress');
    return pending;
  }

  private height(height: { revision_number?: bigint; revision_height?: bigint } | undefined): Height {
    return {
      revisionNumber: BigInt(height?.revision_number ?? 0n),
      revisionHeight: BigInt(height?.revision_height ?? 0n),
    };
  }

  private proof(bytes: Uint8Array | undefined): MerkleProof {
    if (!bytes?.length) throw new GrpcInvalidArgumentException('Invalid argument: a proof is required');
    return initializeMerkleProof(decodeMerkleProof(bytes) as ProtoMerkleProof);
  }

  /** A connection by its hex identifier, authenticated by its token. */
  private async connection(hexId: string, requireOpen: boolean): Promise<Connection> {
    const id = convertHex2String(hexId);
    const [policyId, name] = this.lucidService.getConnectionTokenUnit(parseConnectionSequence(id));
    const utxo = await this.lucidService.findUtxoByUnit(policyId + name);
    const datum = await this.lucidService.decodeDatum<ConnectionDatum>(utxo.datum!, 'connection');
    if (requireOpen && datum.state.state !== ConnectionState.Open) {
      throw new GrpcInvalidArgumentException(`channel upgrade: ${id} is not open`);
    }
    return { utxo, datum, id };
  }

  /** Proofs use the channel's connection until the upgrade opens. */
  private async connections(datum: ChannelDatum, replacementHop: string) {
    return {
      current: await this.connection(datum.state.channel.connection_hops[0], true),
      replacement: await this.connection(replacementHop, true),
    };
  }

  private uniqueReferences(inputs: UTxO[]): UTxO[] {
    return inputs.filter((input, index) => inputs.findIndex((other) =>
      other.txHash === input.txHash && other.outputIndex === input.outputIndex) === index);
  }

  private async readyClient(connection: Connection, validToMs: number): Promise<UTxO> {
    const utxo = await this.lucidService.findUtxoByUnit(
      this.lucidService.getClientTokenUnit(parseClientSequence(convertHex2String(connection.datum.state.client_id))),
    );
    const resolved = await this.lucidService.resolveClientAtHeights(utxo, []);
    const state = resolved.clientDatum.state;
    const client = state.clientState;
    const consensus = getHeightMapValue(state.consensusStates, client.latestHeight);
    if (client.frozenHeight.revisionHeight !== 0n || client.frozenHeight.revisionNumber !== 0n ||
        !consensus || BigInt(consensus.timestamp) + client.trustingPeriod <= BigInt(validToMs) * 1_000_000n) {
      throw new GrpcInvalidArgumentException('channel upgrade: replacement client is frozen or expired, refresh it before completing flushing');
    }
    return resolved.clientUtxo;
  }

  private async proofClient(connection: Connection, height: Height): Promise<ProofClient> {
    const clientUtxo = await this.lucidService.findUtxoByUnit(
      this.lucidService.getClientTokenUnit(parseClientSequence(convertHex2String(connection.datum.state.client_id))),
    );
    const resolved = await this.lucidService.resolveClientAtHeights(clientUtxo, [height]);
    const state = resolved.clientDatum.state;
    const consensusState = getHeightMapValue(state.consensusStates, height);
    const processedTime = getHeightMapValue(state.processedTimes, height);
    const processedHeight = getHeightMapValue(state.processedHeights, height);
    if (consensusState === undefined || processedTime === undefined || processedHeight === undefined) {
      throw new GrpcInvalidArgumentException(
        `channel upgrade: no consensus state at proof height ${height.revisionNumber}-${height.revisionHeight}`,
      );
    }
    const prefix = connection.datum.state.counterparty.prefix.key_prefix;
    return {
      utxo: resolved.clientUtxo,
      historyWitness: resolved.historyWitnesses[0] ?? null,
      timestamp: BigInt(consensusState.timestamp),
      membership: (proof, path, value) => ({
        cs: state.clientState,
        cons_state: consensusState,
        height,
        processed_time: processedTime,
        processed_height: processedHeight,
        delay_time_period: connection.datum.state.delay_period,
        delay_block_period: getBlockDelay(connection.datum.state.delay_period),
        proof,
        path: { key_path: [prefix, convertString2Hex(path)] },
        value: toHex(value),
      }),
    };
  }

  private singleProof(client: ProofClient, membership: VerifyMembershipParams): Step['proof'] {
    return { redeemer: { VerifyMembership: membership }, historyWitness: client.historyWitness };
  }

  private channelAndUpgradeProof(
    context: StepContext,
    client: ProofClient,
    proofChannel: MerkleProof,
    counterpartyChannel: ChannelDatum['state']['channel'],
    proofUpgrade: MerkleProof,
    counterpartyUpgrade: Parameters<typeof encodeUpgradeProto>[0],
  ): Step['proof'] {
    const counterparty = context.channelDatum.state.channel.counterparty;
    return {
      redeemer: {
        BatchVerifyMembership: [
          [
            client.membership(
              proofChannel,
              this.counterpartyChannelPath(context),
              encodeChannelProto(counterpartyChannel),
            ),
            client.membership(
              proofUpgrade,
              channelUpgradePath(convertHex2String(counterparty.port_id), convertHex2String(counterparty.channel_id)),
              encodeUpgradeProto(counterpartyUpgrade),
            ),
          ],
        ],
      },
      historyWitness: client.historyWitness,
    };
  }

  private counterpartyChannelPath(context: StepContext): string {
    const counterparty = context.channelDatum.state.channel.counterparty;
    return channelPath(convertHex2String(counterparty.port_id), convertHex2String(counterparty.channel_id));
  }

  /** The counterparty end of this channel, as ibc-go commits it. */
  private counterpartyChannel(
    context: StepContext,
    state: ChannelState,
    ordering: ChannelDatum['state']['channel']['ordering'],
    version: string,
    connectionHop: string,
    upgradeSequence: bigint,
  ): ChannelDatum['state']['channel'] {
    return {
      state,
      ordering,
      counterparty: { port_id: context.channelDatum.port, channel_id: convertString2Hex(context.channelId) },
      connection_hops: [connectionHop],
      version,
      upgrade_sequence: upgradeSequence,
    };
  }

  private encodeErrorReceipt(receipt: ErrorReceiptValue): Uint8Array {
    // ibc-go commits the protobuf ErrorReceipt.
    return ProtoErrorReceipt.encode(errorReceiptToProto(receipt)).finish();
  }

  private fields(datum: string | null | undefined): unknown[] {
    const data = this.lucidService.LucidImporter.Data.from(datum!) as { fields?: unknown[] };
    if (!Array.isArray(data.fields)) throw new GrpcInternalException('channel upgrade: malformed packet state');
    return data.fields;
  }

  private async packetLanes() {
    const deployment = this.configService.get<DeploymentConfig>('deployment')!;
    const packetState = deployment.packetState;
    const config = await this.lucidService.findUtxoByUnit(
      packetState.configToken.policyId + packetState.configToken.name,
    );
    return { config, statePolicy: packetState.state.scriptHash, laneCount: packetState.laneCount };
  }

  /** The send sequencer fixes the boundary between packets sent before and after the upgrade. */
  private async sequencer(context: StepContext, statePolicy: string) {
    const utxo = await this.lucidService.findUtxoByUnit(
      statePolicy + sendSequencerTokenName(context.portId, context.channelId),
    );
    // SendSequencerDatum { port_id, channel_id, version, next_sequence_send }
    const nextSequenceSend = this.fields(utxo.datum)[3];
    if (typeof nextSequenceSend !== 'bigint')
      throw new GrpcInternalException('channel upgrade: malformed send sequencer');
    return { utxo, nextSequenceSend };
  }
}
