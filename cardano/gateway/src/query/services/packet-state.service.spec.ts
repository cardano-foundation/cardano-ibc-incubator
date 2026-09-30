import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PacketStateService } from './packet-state.service';
import { packetLaneTokenName } from '@cardano-ibc/tx-builder/dist/packet-lanes';

jest.mock('@cardano-ibc/tx-builder-runtime/packetLaneTransactions', () => ({
  laneTree: jest.fn(async () => ({
    tree: { generateNonExistenceProof: jest.fn(() => ({})), generateProof: jest.fn(() => ({})) },
  })),
}));
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
      ]),
    });
  }
  const history = {
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
  return { service, history, outputs };
}

describe('canonical packet query state', () => {
  it('encodes the same snapshot fixture consumed by both partner light clients', async () => {
    const { service } = fixture();
    const expected = readFileSync(
      resolve(
        __dirname,
        '../../../../../cosmos/cardano-probabilistic-light-client-core/testdata/gateway-packet-snapshot.hex',
      ),
      'utf8',
    ).trim();
    expect(Buffer.from(await service.snapshot(42n)).toString('hex')).toBe(expected);
  });

  it('proves an unchanged empty lane at the requested settled height', async () => {
    const { service, history } = fixture();
    const proof = await service.proof('transfer', 'channel-0', 1n, 'receipts', 42n);
    expect(proof.value).toBeUndefined();
    expect(proof.proof_height.revision_height).toBe(42n);
    expect(history.findUtxoByUnitAtOrBeforeBlockNo).toHaveBeenCalledTimes(2);
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
