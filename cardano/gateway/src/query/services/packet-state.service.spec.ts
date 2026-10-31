import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PacketStateService } from './packet-state.service';
import { packetLaneTokenName } from '@cardano-ibc/tx-builder/dist/packet-lanes';

jest.mock('../../shared/helpers/ics23-proof-serialization', () => ({
  serializeExistenceProof: jest.fn(() => Buffer.from([1])),
  serializeNonExistenceProof: jest.fn(() => Buffer.from([2])),
}));

class Datum {
  index = 0;
  constructor(public fields: unknown[]) {}
}

function fixture() {
  const statePolicy = '11'.repeat(28);
  const outputs = new Map<string, any>();
  outputs.set(statePolicy + Buffer.from('ibc_packet_registry').toString('hex'), { datum: new Datum([1n]) });
  outputs.set('channel-0', { datum: new Datum([null, 'transfer']) });
  for (let index = 0; index < 2; index++) {
    outputs.set(statePolicy + packetLaneTokenName('transfer', 'channel-0', index, 2), {
      txHash: 'cc'.repeat(32),
      outputIndex: index,
      datum: new Datum([
        'transfer',
        'channel-0',
        BigInt(index),
        2n,
        0n,
        '00'.repeat(32),
        new Map(),
        [],
        new Map(),
        new Datum([0n, 0n]),
        new Datum([0n, 0n]),
        new Map(),
      ]),
    });
  }
  const leaves = new Map<string, Buffer>();
  const history = {
    rebuildPacketLaneTreeAtBlock: jest.fn(async () => ({ tree: {
      get: (key: string) => leaves.get(key),
      getKeys: () => [...leaves.keys()],
      count: (kind: string) => [...leaves.keys()].filter(key => key.startsWith(kind + '/')).length,
      entriesPage: (kind: string, offset: number, limit: number, reverse: boolean) => {
        const entries = [...leaves].filter(([key]) => key.startsWith(kind + '/'))
          .map(([key, value]) => [BigInt(key.slice(key.lastIndexOf('/') + 1)), value.toString('hex')] as [bigint, string]);
        entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
        return (reverse ? entries.reverse() : entries).slice(offset, offset + limit);
      },
      generateNonExistenceProof: jest.fn(() => ({})),
      generateProof: jest.fn(() => ({})),
    } })),
    findBlockByHeight: jest.fn(async () => ({ hash: 'aa'.repeat(32) })),
    findHostStateUtxoAtOrBeforeBlockNo: jest.fn(async () => ({
      txHash: 'bb'.repeat(32),
      outputIndex: 0,
      datum: 'host',
    })),
    findUtxoByUnitAtOrBeforeBlockNo: jest.fn(async (unit: string) => outputs.get(unit)),
  };
  const lucid = {
    LucidImporter: { Data: { from: (value: unknown) => value }, Constr: Datum, toText: (value: string) => value },
    getChannelTokenUnit: (index: bigint) => [`channel-${index}`, ''],
    decodeDatum: async () => ({ state: { ibc_state_root: '00'.repeat(32) } }),
  };
  const config = { getOrThrow: () => ({ packetState: { state: { scriptHash: statePolicy }, laneCount: 2 } }) };
  const service = new PacketStateService(config as any, lucid as any, history as any, {} as any);
  jest.spyOn(service, 'height').mockResolvedValue(42n);
  return { service, history, outputs, leaves };
}

describe('canonical packet query state', () => {
  it('emits both packet events for a successful acknowledgement batch', async () => {
    const batchPolicy = 'batch', channelPolicy = 'channel';
    const ack = (sequence: bigint) => {
      const packet = new Datum([sequence, 'transfer', 'channel-0', 'transfer', 'channel-7', 'data', new Datum([0n, 0n]), 1n]);
      const operation = new Datum([packet]);
      operation.index = 1;
      return operation;
    };
    const batch = new Datum([[ack(1n), ack(2n)]]);
    batch.index = 9;
    const authorization = new Datum([new Datum([channelPolicy, 'token']), batch, null]);
    const evidence = { txBodyCborHex: '', blockNo: 1, redeemers: [{ type: 'mint', index: 0, data: authorization }] };
    const history = {
      findTransactionEvidenceByHash: jest.fn(async () => evidence),
      findUtxoByUnitAtOrBeforeBlockNo: jest.fn(async () => ({ datum: '' })),
    };
    const lucid = {
      LucidImporter: {
        CML: { TransactionBody: { from_cbor_hex: () => ({ mint: () => ({
          keys: () => ({ len: () => 1, get: () => ({ to_hex: () => batchPolicy }) }),
        }) }) } },
        Data: { from: (value: unknown) => value }, Constr: Datum, toText: (value: string) => value,
      },
      decodeDatum: async () => ({ state: { channel: { connection_hops: ['connection-0'] } } }),
    };
    const config = { getOrThrow: () => ({
      packetState: { batch: { scriptHash: batchPolicy } },
      validators: { mintChannelStt: { scriptHash: channelPolicy } },
    }) };
    const service = new PacketStateService(config as any, lucid as any, history as any, {} as any);
    const events = await service.events('tx');
    expect(events.map(event => event.type)).toEqual(['acknowledge_packet', 'acknowledge_packet']);
    expect(events.map(event => event.event_attribute.find(item => item.key === 'packet_sequence')?.value))
      .toEqual(['1', '2']);
  });
  it('encodes the same snapshot fixture consumed by both partner light clients', async () => {
    const { service, history } = fixture();
    const expected = readFileSync(
      resolve(
        __dirname,
        '../../../../../cosmos/cardano-probabilistic-light-client-core/testdata/gateway-packet-snapshot.hex',
      ),
      'utf8',
    ).trim();
    expect(Buffer.from(await service.snapshot(42n)).toString('hex')).toBe(expected);
    expect(history.rebuildPacketLaneTreeAtBlock).not.toHaveBeenCalled();
  });

  it('proves an unchanged empty lane at the requested settled height', async () => {
    const { service, history } = fixture();
    const proof = await service.proof('transfer', 'channel-0', 1n, 'receipts', 42n);
    expect(proof.value).toBeUndefined();
    expect(proof.proof_height.revision_height).toBe(42n);
    expect(history.findUtxoByUnitAtOrBeforeBlockNo).toHaveBeenCalledTimes(2);
  });

  it('serves retained acknowledgements from history while both live collections stay empty', async () => {
    const { service, leaves } = fixture();
    const key = 'acks/ports/transfer/channels/channel-0/sequences/1';
    leaves.set(key, Buffer.from('ab'.repeat(32), 'hex'));
    const proof = await service.proof('transfer', 'channel-0', 1n, 'acks', 42n);
    expect(proof.value).toBe('ab'.repeat(32));
    expect(proof.proof).toEqual(Buffer.from([1]));
    expect((await service.entries('transfer', 'channel-0', 'acks', 42n)).entries.get(1n)).toBe('ab'.repeat(32));
  });

  it('rejects a block rollback even when the untouched lane reference stays the same', async () => {
    const { service, history } = fixture();
    history.findBlockByHeight
      .mockResolvedValueOnce({ hash: 'aa'.repeat(32) })
      .mockResolvedValueOnce({ hash: 'dd'.repeat(32) });
    await expect(service.proof('transfer', 'channel-0', 1n, 'receipts', 42n)).rejects.toThrow('rolled back');
  });

  it('rejects snapshot construction across a rollback', async () => {
    const { service, history } = fixture();
    history.findBlockByHeight
      .mockResolvedValueOnce({ hash: 'aa'.repeat(32) })
      .mockResolvedValueOnce({ hash: 'dd'.repeat(32) });
    await expect(service.snapshot(42n)).rejects.toThrow('rolled back');
  });
});
