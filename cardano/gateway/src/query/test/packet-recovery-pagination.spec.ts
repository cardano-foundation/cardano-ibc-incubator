import { PacketMerkleTree } from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';
import { packetLane } from '@cardano-ibc/tx-builder/dist/packet-lanes';
import { PacketService } from '../services/packet.service';
import { PacketStateService } from '../services/packet-state.service';
import { GrpcInvalidArgumentException } from '../../exception/grpc_exceptions';

const request = { port_id: 'transfer', channel_id: 'channel-0', packet_commitment_sequences: [] as bigint[], pagination: undefined };
const path = (kind: string, sequence: bigint) => `${kind}/ports/transfer/channels/channel-0/sequences/${sequence}`;
class Constr {
  constructor(readonly index: number, readonly fields: unknown[]) {}
}

function fixture() {
  let tip = 42n;
  const trees = Array.from({ length: 4 }, () => new PacketMerkleTree());
  const snapshots = new Map<bigint, PacketMerkleTree[]>();
  const hashes = new Map<bigint, string>([[42n, 'aa'.repeat(32)]]);
  const history = {
    findBlockByHeight: jest.fn(async (height: bigint) => ({ hash: hashes.get(height) })),
    findUtxoByUnitAtOrBeforeBlockNo: jest.fn(async () => ({ datum: 'registry' })),
  };
  const state = new PacketStateService(
    { getOrThrow: () => ({ packetState: { laneCount: trees.length, state: { scriptHash: 'policy' } } }) } as any,
    { LucidImporter: { Data: { from: () => new Constr(0, [1n]) }, Constr } } as any,
    history as any,
    {} as any,
  );
  jest.spyOn(state, 'height').mockImplementation(async (height) => height ?? tip);
  jest.spyOn(state, 'lane').mockImplementation(async (_port, _channel, index, height) =>
    ({ tree: (snapshots.get(height) ?? trees)[index] }) as any);
  const service = () => new PacketService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, state);
  const set = (kind: string, sequence: bigint, value = 'ab'.repeat(32)) =>
    trees[packetLane('transfer', 'channel-0', sequence, trees.length)].set(path(kind, sequence), value);
  return {
    service, set, state, hashes,
    advance() {
      snapshots.set(tip, trees.map(tree => tree.clone()));
      tip += 1n;
      hashes.set(tip, 'bb'.repeat(32));
    },
  };
}

const page = (limit: bigint, key: Uint8Array = new Uint8Array(), reverse = false) =>
  ({ key, offset: 0n, limit, count_total: true, reverse });

describe('transfer packet recovery enumeration', () => {
  it('finds only the pending acknowledgement after restarting discovery with over 100 retained ACKs', async () => {
    const f = fixture();
    for (let sequence = 1n; sequence <= 150n; sequence++) f.set('acks', sequence);
    // No write-ack event is delivered. A newly constructed query service must find it from state.
    const pending = [101n];
    for (let restart = 0; restart < 2; restart++) {
      const response = await f.service().queryPacketAcknowledgements({
        ...request, packet_commitment_sequences: pending,
      });
      expect(response.acknowledgements.map(ack => ack.sequence)).toEqual(pending);
      expect(response.pagination!.next_key).toEqual(new Uint8Array());
    }
  });

  it('filters before pagination and follows every page of the requested sequences', async () => {
    const f = fixture();
    for (let sequence = 1n; sequence <= 150n; sequence++) f.set('acks', sequence);
    const selected = [150n, 101n, 120n, 101n];
    const first = await f.service().queryPacketAcknowledgements({
      ...request, packet_commitment_sequences: selected, pagination: page(2n),
    });
    expect(first.acknowledgements.map(ack => ack.sequence)).toEqual([101n, 120n]);
    expect(first.pagination!.total).toBe(3n);
    const second = await f.service().queryPacketAcknowledgements({
      ...request, packet_commitment_sequences: selected, pagination: page(2n, first.pagination!.next_key),
    });
    expect(second.acknowledgements.map(ack => ack.sequence)).toEqual([150n]);
    expect(second.pagination!.next_key).toEqual(new Uint8Array());
  });

  it.each([false, true])('keeps the accepted snapshot after commitments are deleted, reverse=%s', async reverse => {
    const f = fixture();
    for (let sequence = 1n; sequence <= 4n; sequence++) f.set('commitments', sequence);
    const first = await f.service().queryPacketCommitments({ ...request, pagination: page(2n, undefined, reverse) });
    expect(first.commitments.map(packet => packet.sequence)).toEqual(reverse ? [4n, 3n] : [1n, 2n]);
    f.advance();
    for (const packet of first.commitments) f.set('commitments', packet.sequence, '');
    const second = await f.service().queryPacketCommitments({
      ...request, pagination: page(2n, first.pagination!.next_key, reverse),
    });
    expect(second.commitments.map(packet => packet.sequence)).toEqual(reverse ? [2n, 1n] : [3n, 4n]);
    expect(second.height).toEqual(first.height);
    expect(second.pagination!.next_key).toEqual(new Uint8Array());
  });

  it('rejects a continuation whose block was replaced by a rollback', async () => {
    const f = fixture();
    f.set('acks', 1n);
    f.set('acks', 2n);
    const first = await f.service().queryPacketAcknowledgements({ ...request, pagination: page(1n) });
    f.hashes.set(42n, 'ff'.repeat(32));
    await expect(f.service().queryPacketAcknowledgements({
      ...request, pagination: page(1n, first.pagination!.next_key),
    })).rejects.toThrow('snapshot rolled back');
  });

  it('keeps exact sequence boundaries above the JavaScript safe integer range', async () => {
    const f = fixture();
    const sequences = [1n, 9_007_199_254_740_993n, 0xffffffffffffffffn];
    for (const sequence of sequences) f.set('acks', sequence);
    const first = await f.service().queryPacketAcknowledgements({ ...request, pagination: page(2n) });
    expect(first.acknowledgements.map(ack => ack.sequence)).toEqual(sequences.slice(0, 2));
    const second = await f.service().queryPacketAcknowledgements({
      ...request, pagination: page(2n, first.pagination!.next_key),
    });
    expect(second.acknowledgements.map(ack => ack.sequence)).toEqual(sequences.slice(2));
    expect(second.pagination!.next_key).toEqual(new Uint8Array());
  });

  it('does not lose sequence boundaries when a caller selects a new snapshot', async () => {
    const f = fixture();
    for (let sequence = 1n; sequence <= 4n; sequence++) f.set('commitments', sequence);
    f.set('commitments', 1n, '');
    f.set('commitments', 2n, '');
    const result = await f.state.entries('transfer', 'channel-0', 'commitments', undefined, { after: 2n, limit: 2 });
    expect([...result.entries.keys()]).toEqual([3n, 4n]);
  });

  it('rejects offset cursors and continuation reuse against another scope or direction', async () => {
    const f = fixture();
    f.set('acks', 1n);
    f.set('acks', 2n);
    const first = await f.service().queryPacketAcknowledgements({ ...request, pagination: page(1n) });
    for (const altered of [
      { ...request, pagination: page(1n, Buffer.from('1')) },
      { ...request, packet_commitment_sequences: [2n], pagination: page(1n, first.pagination!.next_key) },
      { ...request, channel_id: 'channel-1', pagination: page(1n, first.pagination!.next_key) },
      { ...request, pagination: page(1n, first.pagination!.next_key, true) },
    ]) {
      await expect(f.service().queryPacketAcknowledgements(altered)).rejects.toBeInstanceOf(GrpcInvalidArgumentException);
    }
    await expect(f.service().queryPacketAcknowledgements({
      ...request, pagination: page(1n, first.pagination!.next_key),
    }, { queryHeight: 43n })).rejects.toBeInstanceOf(GrpcInvalidArgumentException);
  });
});
