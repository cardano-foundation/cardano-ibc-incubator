import { join } from 'path';
import { loadSync } from '@grpc/proto-loader';
import * as Lucid from '@lucid-evolution/lucid';
import { consensusHistoryKey, CONSENSUS_HISTORY_KEY_PREFIX } from '@cardano-ibc/tx-builder-runtime/consensusHistory';
import { buildPacketReceive } from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';
import { PacketLaneService } from '../packet-lane.service';

jest.mock('@cardano-ibc/tx-builder-runtime/packetLaneTransactions', () => ({
  ...jest.requireActual('@cardano-ibc/tx-builder-runtime/packetLaneTransactions'),
  buildPacketReceive: jest.fn(),
}));
jest.mock('../../query/services/packet-state.service', () => ({ PacketStateService: class {} }));

const protoRoot = join(__dirname, '../../../../../proto-types/protos/ibc-go');
const definitions = loadSync(
  [join(protoRoot, 'ibc/core/channel/v1/tx.proto'), join(protoRoot, 'ibc/cardano/v1/tx.proto')],
  { keepCase: true, includeDirs: [protoRoot] },
);
// Match the production loader. Its default uint64 representation is Long.
const requestFromWire = (service: string, method: string, request: unknown): any => {
  const rpc = (definitions[service] as any)[method];
  return rpc.requestDeserialize(rpc.requestSerialize(request));
};

describe('packet lane protobuf integer boundary', () => {
  let service: PacketLaneService;
  let resolvedHeights: unknown[];
  const sequence = '9007199254740993';
  const timestamp = '1786989929123456789';
  const proofHeight = { revision_number: '2', revision_height: '1455' };

  beforeEach(() => {
    jest.clearAllMocks();
    resolvedHeights = [];
    const lucid = {
      LucidImporter: Lucid,
      lucid: {},
      applyTraceRegistryUpdate: jest.fn(),
      resolveClientAtHeights: jest.fn(async (_client, heights) => {
        // Exercise the real strict bigint consumer that failed in the live run.
        const key = consensusHistoryKey({ policyId: 'ab'.repeat(28), name: '00' }, heights[0]);
        const encoded = Lucid.Data.from(key.slice(CONSENSUS_HISTORY_KEY_PREFIX.length)) as Lucid.Constr<Lucid.Data>;
        resolvedHeights.push((encoded.fields[1] as Lucid.Constr<Lucid.Data>).fields);
        return { clientUtxo: {}, historyWitnesses: [] };
      }),
    };
    service = new PacketLaneService(
      {} as any, lucid as any, {} as any,
      { prepareOnChainInsert: jest.fn().mockResolvedValue({ kind: 'existing' }) } as any,
      {} as any, {} as any,
    );
    jest.spyOn(service, 'deployment').mockResolvedValue({ client: {}, voucherPolicy: 'cd'.repeat(28) } as any);
    jest.spyOn(service as any, 'initialize').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'complete').mockImplementation(async (_signer, _name, build: any) => {
      await build(0, 1000, (inputs: unknown[]) => inputs);
      return { type_url: '', value: new Uint8Array([1]) };
    });
    jest.mocked(buildPacketReceive).mockResolvedValue({ tx: {}, input: {} } as any);
  });

  it('preserves uint64 packet values and resolves the real history key after gRPC decoding', async () => {
    const request = requestFromWire('ibc.core.channel.v1.Msg', 'RecvPacket', {
      signer: 'signer', proof_height: proofHeight, proof_commitment: Buffer.alloc(0),
      packet: {
        sequence, source_port: 'transfer', source_channel: 'channel-0',
        destination_port: 'transfer', destination_channel: 'channel-0',
        data: Buffer.from(JSON.stringify({ denom: 'utest', amount: '1', receiver: 'ab'.repeat(28), sender: 'sender' })),
        timeout_height: { revision_number: '0', revision_height: '0' }, timeout_timestamp: timestamp,
      },
    });
    expect(typeof request.proof_height.revision_number).toBe('object');
    await service.settle(request, 'receive');
    expect(resolvedHeights).toEqual([[2n, 1455n]]);
    const [, , packet, height] = jest.mocked(buildPacketReceive).mock.calls[0];
    expect(packet.fields[0]).toBe(BigInt(sequence));
    expect((packet.fields[6] as Lucid.Constr<Lucid.Data>).fields).toEqual([0n, 0n]);
    expect(packet.fields[7]).toBe(BigInt(timestamp));
    expect(height.fields).toEqual([2n, 1455n]);
  });

});
