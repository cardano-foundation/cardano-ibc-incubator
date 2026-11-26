// Runs the pinned Rust recovery consumer against the production Gateway query path.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { Server, ServerCredentials, type ServiceDefinition } from '@grpc/grpc-js';
import { PacketMerkleTree } from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';
import { packetLane } from '@cardano-ibc/tx-builder/dist/packet-lanes';
import {
  QueryPacketAcknowledgementsRequest, QueryPacketAcknowledgementsResponse,
  QueryPacketCommitmentsRequest, QueryPacketCommitmentsResponse,
} from '@cardano-ibc/proto-types/build/ibc/core/channel/v1/query';
import { PacketService } from '../../query/services/packet.service';
import { PacketStateService } from '../../query/services/packet-state.service';
import { QueryController } from '../../query/query.controller';

class Constr {
  constructor(readonly index: number, readonly fields: unknown[]) {}
}

async function main() {
  const trees = Array.from({ length: 4 }, () => new PacketMerkleTree());
  let snapshot = trees;
  let tip = 42n;
  let replaced = false;
  let ackCalls = 0;
  let commitmentCalls = 0;
  const set = (kind: string, sequence: bigint, value: string) =>
    trees[packetLane('transfer', 'channel-0', sequence, trees.length)]
      .set(`${kind}/ports/transfer/channels/channel-0/sequences/${sequence}`, value);
  for (let sequence = 1n; sequence <= 150n; sequence++) set('acks', sequence, 'ab'.repeat(32));
  for (let sequence = 1n; sequence <= 4n; sequence++) set('commitments', sequence, 'cd'.repeat(32));
  const state = new PacketStateService(
    { getOrThrow: () => ({ packetState: { laneCount: 4, state: { scriptHash: 'policy' } } }) } as any,
    { LucidImporter: { Data: { from: () => new Constr(0, [1n]) }, Constr } } as any,
    {
      findBlockByHeight: async (height: bigint) => ({ hash: (height === 42n ? 'aa' : 'bb').repeat(32) }),
      findUtxoByUnitAtOrBeforeBlockNo: async () => ({ datum: 'registry' }),
    } as any,
    {} as any,
  );
  state.height = async (requested) => requested ?? tip;
  state.lane = async (_port, _channel, lane, height) =>
    ({ tree: (height === 42n ? snapshot : trees)[lane] }) as any;
  const packets = new PacketService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, state);
  const controller = new QueryController({} as any, {} as any, {} as any, packets, {} as any, {} as any);
  const server = new Server();
  const method = (name: string, request: any, response: any) => ({
    path: `/ibc.core.channel.v1.Query/${name}`, requestStream: false, responseStream: false,
    requestSerialize: (value: any) => Buffer.from(request.encode(value).finish()),
    requestDeserialize: (value: Buffer) => request.decode(value),
    responseSerialize: (value: any) => Buffer.from(response.encode(value).finish()),
    responseDeserialize: (value: Buffer) => response.decode(value),
  });
  server.addService({
    acks: method('PacketAcknowledgements', QueryPacketAcknowledgementsRequest, QueryPacketAcknowledgementsResponse),
    commitments: method('PacketCommitments', QueryPacketCommitmentsRequest, QueryPacketCommitmentsResponse),
  } as ServiceDefinition, {
    acks: async (call: any, callback: any) => {
      try {
        ackCalls++;
        assert.ok(call.request.packet_commitment_sequences.length, 'Hermes dropped the pending sequence filter');
        callback(null, await controller.queryPacketAcknowledgements(call.request, call.metadata));
      } catch (error) { callback(error); }
    },
    commitments: async (call: any, callback: any) => {
      try {
        commitmentCalls++;
        const result = await controller.queryPacketCommitments(call.request, call.metadata);
        if (!replaced) {
          // Processing ACKs changes the live state while the next page is in flight.
          snapshot = trees.map(tree => tree.clone());
          set('commitments', 1n, '');
          set('commitments', 2n, '');
          tip = 43n;
          replaced = true;
        }
        callback(null, result);
      } catch (error) { callback(error); }
    },
  });
  const port = await new Promise<number>((done, reject) => server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : done(port)));
  try {
    // A fresh Rust process receives no historical events and must recover from chain state.
    const manifest = process.env.HERMES_ACK_RECOVERY_MANIFEST ?? resolve(__dirname, '../../../../../relayer/Cargo.toml');
    for (let restart = 0; restart < 2; restart++) {
      const child = spawn('cargo', [
        'test', '--manifest-path', manifest, '-p', 'ibc-relayer', '--lib', '--locked',
        'cardano_ack_recovery_gateway_contract', '--', '--ignored', '--nocapture',
      ], { cwd: dirname(manifest), stdio: 'inherit', env: {
        ...process.env, HERMES_ACK_RECOVERY_GATEWAY: `http://127.0.0.1:${port}`,
        HERMES_ACK_RECOVERY_RESTART: String(restart),
      } });
      const code = await new Promise<number | null>((done, reject) => {
        child.once('error', reject);
        child.once('exit', done);
      });
      assert.equal(code, 0, 'Hermes recovery contract failed');
    }
    assert.equal(ackCalls, 4, 'expected two fresh discoveries plus both pages of the full pending set');
    assert.equal(commitmentCalls, 2, 'expected both pages of the pinned commitment snapshot');
    console.log('ACK recovery contract passed across Rust, gRPC and Gateway packet state');
  } finally {
    server.forceShutdown();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
