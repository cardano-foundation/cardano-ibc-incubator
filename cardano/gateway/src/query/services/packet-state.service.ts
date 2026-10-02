import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encodeCanonical } from 'cbor';
import type { Constr, Data } from '@lucid-evolution/lucid';
import { packetLane, packetLaneTokenName } from '@cardano-ibc/tx-builder/dist/packet-lanes';
import { laneTree } from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';
import { LucidService } from '../../shared/modules/lucid/lucid.service';
import type { DeploymentConfig } from '../../config/bridge-manifest';
import { HISTORY_SERVICE, type HistoryService } from './history.service';
import { loadStakeWeightedStabilityEvidenceByHeight } from './stability-evidence';
import { latestPacketProofHeight } from './settled-proof-height';
import type { HostStateDatum } from '../../shared/types/host-state-datum';
import { serializeExistenceProof, serializeNonExistenceProof } from '../../shared/helpers/ics23-proof-serialization';

export { latestPacketProofHeight } from './settled-proof-height';

function snapshotInteger(value: bigint | number): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Snapshot integer exceeds supported exact range');
  return result;
}

@Injectable()
export class PacketStateService {
  constructor(
    private readonly config: ConfigService,
    private readonly lucid: LucidService,
    @Inject(HISTORY_SERVICE) private readonly history: HistoryService,
    private readonly logger: Logger,
  ) {}

  async height(requested?: bigint) {
    if (requested && requested > 0n) {
      await loadStakeWeightedStabilityEvidenceByHeight({
        historyService: this.history,
        logger: this.logger,
        height: requested,
      });
      return requested;
    }
    return latestPacketProofHeight(this.history, this.logger);
  }

  async lane(port: string, channel: string, lane: number, height: bigint) {
    const config = this.config.getOrThrow<DeploymentConfig>('deployment').packetState!;
    const name = packetLaneTokenName(port, channel, lane, config.laneCount);
    const output = await this.history.findUtxoByUnitAtOrBeforeBlockNo(config.state.scriptHash + name, height);
    const { Data, Constr, toText } = this.lucid.LucidImporter;
    if (!output.datum) throw new Error('Packet lane datum is unavailable');
    const datum = Data.from(output.datum);
    if (
      !(datum instanceof Constr) ||
      datum.index !== 0 ||
      datum.fields.length !== 12 ||
      toText(String(datum.fields[0])) !== port ||
      toText(String(datum.fields[1])) !== channel ||
      datum.fields[2] !== BigInt(lane) ||
      datum.fields[3] !== BigInt(config.laneCount)
    )
      throw new Error('Invalid historical packet lane identity');
    const tree = await laneTree(datum);
    return { output, datum, tree: tree.tree, name };
  }

  async proof(
    port: string,
    channel: string,
    sequence: bigint,
    kind: 'commitments' | 'receipts' | 'acks',
    requested?: bigint,
  ) {
    const height = await this.height(requested);
    const block = await this.history.findBlockByHeight(height);
    if (!block) throw new Error('Proof block missing');
    const count = this.config.getOrThrow<DeploymentConfig>('deployment').packetState!.laneCount;
    const lane = await this.lane(port, channel, packetLane(port, channel, sequence, count), height);
    const key = `${kind}/ports/${port}/channels/${channel}/sequences/${sequence}`;
    const value =
      kind === 'receipts'
        ? (lane.datum.fields[7] as bigint[]).includes(sequence)
          ? '01'
          : undefined
        : (lane.datum.fields[kind === 'commitments' ? 6 : 8] as Map<bigint, string>).get(sequence);
    const proof = value
      ? serializeExistenceProof(lane.tree.generateProof(key))
      : serializeNonExistenceProof(lane.tree.generateNonExistenceProof(key));
    // Re-read the historical reference to detect a rollback during construction.
    const again = await this.lane(port, channel, Number(lane.datum.fields[2]), height);
    if ((await this.history.findBlockByHeight(height))?.hash !== block.hash) throw new Error('Proof block rolled back');
    if (again.output.txHash !== lane.output.txHash || again.output.outputIndex !== lane.output.outputIndex)
      throw new Error('Packet state rolled back during proof construction');
    return { value, proof, proof_height: { revision_number: 0n, revision_height: height } };
  }

  async entries(port: string, channel: string, kind: 'commitments' | 'acks' | 'receipts', requested?: bigint) {
    const height = await this.height(requested);
    const count = this.config.getOrThrow<DeploymentConfig>('deployment').packetState!.laneCount;
    const result = new Map<bigint, string>();
    for (let index = 0; index < count; index++) {
      const { datum } = await this.lane(port, channel, index, height);
      const entries =
        kind === 'receipts'
          ? (datum.fields[7] as bigint[]).map((seq) => [seq, '01'] as const)
          : (datum.fields[kind === 'commitments' ? 6 : 8] as Map<bigint, string>);
      for (const [sequence, value] of entries) result.set(sequence, value);
    }
    return {
      height: { revision_number: 0n, revision_height: height },
      entries: new Map([...result].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    };
  }

  async events(txHash: string) {
    const config = this.config.getOrThrow<DeploymentConfig>('deployment');
    const evidence = await this.history.findTransactionEvidenceByHash(txHash);
    if (!evidence) return [];
    const { CML, Data, Constr, toText } = this.lucid.LucidImporter;
    const policies = CML.TransactionBody.from_cbor_hex(evidence.txBodyCborHex).mint()?.keys();
    if (!policies) return [];
    const names = Array.from({ length: policies.len() }, (_, index) => policies.get(index).to_hex()).sort();
    const index = names.indexOf(config.packetState!.batch.scriptHash);
    if (index < 0) return [];
    const redeemer = evidence.redeemers.find((r) => r.type === 'mint' && r.index === index);
    if (!redeemer) throw new Error('Indexed packet transaction lacks its batch redeemer');
    const authorized = Data.from(redeemer.data) as Constr<Data>;
    if (!(authorized instanceof Constr) || authorized.index !== 0 || authorized.fields.length !== 3)
      throw new Error('Invalid packet authorization');
    const token = authorized.fields[0] as Constr<Data>;
    if (token.fields[0] !== config.validators.mintChannelStt.scriptHash)
      throw new Error('Unexpected packet channel policy');
    const channel = await this.history.findUtxoByUnitAtOrBeforeBlockNo(
      String(token.fields[0]) + String(token.fields[1]),
      BigInt(evidence.blockNo),
    );
    const channelDatum = await this.lucid.decodeDatum<import('../../shared/types/channel/channel-datum').ChannelDatum>(
      channel.datum!,
      'channel',
    );
    const operation = authorized.fields[1] as Constr<Data>;
    if (![0, 1, 2, 5, 6, 8].includes(operation.index)) return [];
    const packets =
      operation.index === 0 ? (operation.fields[2] as Constr<Data>[]) : [operation.fields[0] as Constr<Data>];
    return packets.flatMap((packet, index) => {
      const height = packet.fields[6] as Constr<Data>;
      const attributes: Record<string, string> = {
        packet_sequence: String(packet.fields[0]),
        packet_src_port: toText(String(packet.fields[1])),
        packet_src_channel: toText(String(packet.fields[2])),
        packet_dst_port: toText(String(packet.fields[3])),
        packet_dst_channel: toText(String(packet.fields[4])),
        packet_data: toText(String(packet.fields[5])),
        packet_data_hex: String(packet.fields[5]),
        packet_timeout_height: `${height.fields[0]}-${height.fields[1]}`,
        packet_timeout_timestamp: String(packet.fields[7]),
        packet_channel_ordering: 'ORDER_UNORDERED',
        packet_connection: toText(channelDatum.state.channel.connection_hops[0]),
      };
      if (operation.index === 0) {
        const intent = (operation.fields[1] as Constr<Data>[])[index];
        attributes.intent_tx_hash = String(intent.fields[0]);
        attributes.intent_output_index = String(intent.fields[1]);
      }
      const make = (type: string, values = attributes) => ({
        type,
        event_attribute: Object.entries(values).map(([key, value]) => ({ key, value, index: true })),
      });
      if (operation.index === 5) {
        const ack = '{"result":"AQ=="}';
        return [
          make('recv_packet'),
          make('write_acknowledgement', {
            ...attributes,
            packet_ack: ack,
            packet_ack_hex: Buffer.from(ack).toString('hex'),
          }),
        ];
      }
      if (operation.index === 1 || operation.index === 6) {
        const ack =
          operation.index === 1 ? '{"result":"AQ=="}' : '{"error":"' + toText(String(operation.fields[2])) + '"}';
        attributes.packet_ack = ack;
        attributes.packet_ack_hex = Buffer.from(ack).toString('hex');
      }
      return [
        make(
          operation.index === 0
            ? 'send_packet'
            : [2, 8].includes(operation.index)
              ? 'timeout_packet'
              : 'acknowledge_packet',
        ),
      ];
    });
  }

  async snapshot(height: bigint): Promise<Uint8Array> {
    const config = this.config.getOrThrow<DeploymentConfig>('deployment').packetState!;
    const block = await this.history.findBlockByHeight(height);
    if (!block) throw new Error('Snapshot block missing');
    const host = await this.history.findHostStateUtxoAtOrBeforeBlockNo(height);
    const hostDatum = await this.lucid.decodeDatum<HostStateDatum>(host.datum!, 'host_state');
    const registry = await this.history.findUtxoByUnitAtOrBeforeBlockNo(
      config.state.scriptHash + Buffer.from('ibc_packet_registry').toString('hex'),
      height,
    );
    const data = this.lucid.LucidImporter.Data.from(registry.datum!) as Constr<Data>;
    const channelCount = data.fields[0] as bigint;
    const lanes: Record<string, unknown> = {};
    for (let channelIndex = 0n; channelIndex < channelCount; channelIndex++) {
      const channel = `channel-${channelIndex}`;
      const unit = this.lucid.getChannelTokenUnit(channelIndex).join('');
      const output = await this.history.findUtxoByUnitAtOrBeforeBlockNo(unit, height);
      const channelDatum = this.lucid.LucidImporter.Data.from(output.datum!) as Constr<Data>;
      const port = this.lucid.LucidImporter.toText(String(channelDatum.fields[1]));
      for (let index = 0; index < config.laneCount; index++) {
        const lane = await this.lane(port, channel, index, height);
        lanes[lane.name] = {
          State: {
            Port: port,
            Channel: channel,
            Lane: index,
            LaneCount: config.laneCount,
            Height: snapshotInteger(height),
            Version: snapshotInteger(lane.datum.fields[4] as bigint),
            Root: Buffer.from(String(lane.datum.fields[5]), 'hex'),
          },
          TxHash: lane.output.txHash,
          OutputIndex: lane.output.outputIndex,
        };
      }
    }
    const after = await this.history.findBlockByHeight(height);
    if (after?.hash !== block.hash) throw new Error('Snapshot block rolled back');
    return encodeCanonical({
      Height: snapshotInteger(height),
      BlockHash: block.hash,
      HostTxHash: host.txHash,
      HostOutputIndex: host.outputIndex,
      HostRoot: Buffer.from(hostDatum.state.ibc_state_root, 'hex'),
      Lanes: lanes,
    });
  }
}
