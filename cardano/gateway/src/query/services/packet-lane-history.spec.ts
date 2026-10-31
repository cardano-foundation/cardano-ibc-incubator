import { Constr, Data, fromText, type UTxO } from '@lucid-evolution/lucid';
import { packetLaneTokenName } from '@cardano-ibc/tx-builder/dist/packet-lanes';
import { decodePacketLaneHistoryTransaction, PacketLaneTree } from '@cardano-ibc/tx-builder-runtime/packetLaneTransactions';
import { YaciHistoryService } from './yaci-history.service';

jest.mock('@cardano-ibc/tx-builder-runtime/packetLaneTransactions', () => ({
  ...jest.requireActual('@cardano-ibc/tx-builder-runtime/packetLaneTransactions'),
  decodePacketLaneHistoryTransaction: jest.fn(),
}));

const statePolicy = '11'.repeat(28);
const batchPolicy = '22'.repeat(28);
const unit = statePolicy + packetLaneTokenName('transfer', 'channel-0', 0, 1);
const record = (...fields: Data[]) => new Constr(0, fields);
const path = 'acks/ports/transfer/channels/channel-0/sequences/1';

function fixture() {
  const root = new PacketLaneTree();
  const output = (hash: string, version: bigint): UTxO => ({
    txHash: hash.repeat(32), outputIndex: 0, address: 'lane', assets: { lovelace: 5_000_000n, [unit]: 1n },
    datum: Data.to(record(fromText('transfer'), fromText('channel-0'), 0n, 1n, version, root.getRoot(), new Map(), [], new Map(), record(0n, 0n), record(0n, 0n), new Map())),
  });
  const initial = output('aa', 0n);
  const issuance = { txHash: initial.txHash, inputs: [], outputs: [initial], mint: new Map([[unit, 1n]]), mintPolicies: [statePolicy], redeemers: [] };
  const receive = (hash: string, ack: string) => {
    root.set('receipts/ports/transfer/channels/channel-0/sequences/1', '01');
    root.set(path, ack);
    const next = output(hash, 1n);
    const packet = record(1n, fromText('transfer'), fromText('channel-7'), fromText('transfer'), fromText('channel-0'), fromText('payload'), record(0n, 0n), 1n);
    const update = record(record(initial.txHash, 0n), [record(new Constr(1, [packet, ack, record(1n, 1n)]), [])]);
    const operation = new Constr(5, [packet, record(), record(), record(), update, []]);
    return { txHash: next.txHash, inputs: [{ txHash: initial.txHash, outputIndex: 0 }], outputs: [next], mint: new Map(), mintPolicies: [batchPolicy], redeemers: [{ type: 'mint', index: 0, data: Data.to(record(record(), operation, record())) }] };
  };
  const accepted = receive('bb', 'ab'.repeat(32));
  const replacement = receive('cc', 'cd'.repeat(32));
  const decoded = new Map([issuance, accepted, replacement].map(tx => [tx.txHash, tx]));
  (decodePacketLaneHistoryTransaction as jest.Mock).mockImplementation((_cbor, hash) => decoded.get(hash));
  let transactions = [issuance, accepted];
  let blockHash = 'canonical';
  let failSnapshot = false;
  const source = {
    reset: jest.fn(),
    api: { block: jest.fn(async (height: number) => ({ number: height, hash: height === 11 ? blockHash : 'initial' })) },
    snapshot: jest.fn(async (_height, read) => {
      const result = await read();
      if (failSnapshot) throw new Error('history changed during snapshot');
      return result;
    }),
    transaction: jest.fn(async (hash: string) => {
      const tx = transactions.find(tx => tx.txHash === hash);
      return tx && { hash, cborHex: hash, valid: true, index: 0, block: { number: tx === issuance ? 10 : 11, hash: tx === issuance ? 'initial' : blockHash } };
    }),
    async *transactionBlocksFor(path: string, at: number, from: number): AsyncGenerator<any[]> {
      yield await this.transactionsFor(path, at, from);
    },
    transactionsFor: jest.fn(async (_path, at, from) => transactions.flatMap(tx => {
      const height = tx === issuance ? 10 : 11;
      return height >= from && height <= at ? [{ hash: tx.txHash, cborHex: tx.txHash, valid: true, block: { number: height, hash: height === 11 ? blockHash : 'initial' }, index: 0 }] : [];
    })),
  };
  const create = () => {
    const service = new YaciHistoryService(
      { getOrThrow: () => ({ packetState: { state: { scriptHash: statePolicy }, batch: { scriptHash: batchPolicy } } }) } as any,
      { LucidImporter: { Data } } as any,
      {} as any,
    );
    jest.spyOn(service as any, 'restHistory').mockReturnValue(source);
    return service;
  };
  return {
    create, source, initial, accepted: accepted.outputs[0], replacement: replacement.outputs[0],
    rollback: () => { blockHash = 'replacement'; transactions = [issuance, replacement]; },
    omitIssuance: () => { transactions = [accepted]; },
    failSnapshot: () => { failSnapshot = true; },
  };
}

describe('canonical packet history cache', () => {
  it('rebuilds after restart and returns independent trees from a checked checkpoint', async () => {
    const f = fixture();
    const service = f.create();
    const first = await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted);
    first.set(path, '');
    expect((await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted)).get(path)).toBe('ab'.repeat(32));
    expect(f.source.transactionsFor).toHaveBeenCalledTimes(1);
    expect((await f.create().rebuildPacketLaneTreeAtBlock(11n, f.accepted)).get(path)).toBe('ab'.repeat(32));
  });

  it('discards a checkpoint whose block rolled back and rebuilds the replacement branch', async () => {
    const f = fixture();
    const service = f.create();
    await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted);
    f.rollback();
    const replacement = await service.rebuildPacketLaneTreeAtBlock(11n, f.replacement);
    expect(replacement.get(path)).toBe('cd'.repeat(32));
    expect(f.source.transactionsFor).toHaveBeenLastCalledWith(`assets/${unit}/transactions`, 11, 10);
  });

  it('does not use a future checkpoint for an older proof height', async () => {
    const f = fixture();
    const service = f.create();
    await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted);
    expect((await service.rebuildPacketLaneTreeAtBlock(10n, f.initial)).tree.size()).toBe(0);
    expect((service as any).packetLaneHistory.get(unit).history.current().txHash).toBe(f.accepted.txHash);
    expect((await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted)).get(path)).toBe('ab'.repeat(32));
    expect(f.source.transactionsFor).toHaveBeenCalledTimes(1);
  });

  it('shares concurrent reconstruction of the same lane version', async () => {
    const f = fixture();
    const service = f.create();
    const trees = await Promise.all(Array.from({ length: 8 }, () => service.rebuildPacketLaneTreeAtBlock(11n, f.accepted)));
    expect(trees.every(tree => tree.get(path) === 'ab'.repeat(32))).toBe(true);
    expect(f.source.transactionsFor).toHaveBeenCalledTimes(1);
    trees[0].set(path, '');
    expect(trees[1].get(path)).toBe('ab'.repeat(32));
  });

  it('reuses stored current and historical versions after losing the in-memory head', async () => {
    const f = fixture();
    const service = f.create();
    await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted);
    (service as any).packetLaneHistory.clear();
    expect((await service.rebuildPacketLaneTreeAtBlock(10n, f.initial)).tree.size()).toBe(0);
    expect((await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted)).get(path)).toBe('ab'.repeat(32));
    expect(f.source.transactionsFor).toHaveBeenCalledTimes(1);
    expect(f.source.transaction).toHaveBeenCalledWith(f.accepted.txHash);
  });

  it('rejects a stored checkpoint if its transaction no longer matches its anchor', async () => {
    const f = fixture();
    const service = f.create();
    await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted);
    (service as any).packetLaneHistory.clear();
    const original = f.source.transaction.getMockImplementation()!;
    f.source.transaction.mockImplementation(async hash => {
      const transaction = await original(hash);
      return transaction && { ...transaction, index: 1 };
    });
    await expect(service.rebuildPacketLaneTreeAtBlock(11n, f.accepted)).rejects.toThrow('transaction is unavailable or changed');
    expect((service as any).packetLaneHistory.size).toBe(0);
  });

  it('keeps a latest checkpoint while a concurrent historical read finishes later', async () => {
    const f = fixture();
    const service = f.create();
    await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = f.source.transaction.getMockImplementation()!;
    f.source.transaction.mockImplementation(async hash => {
      entered();
      await gate;
      return original(hash);
    });
    const historical = service.rebuildPacketLaneTreeAtBlock(10n, f.initial);
    await started;
    expect((await service.rebuildPacketLaneTreeAtBlock(11n, f.accepted)).get(path)).toBe('ab'.repeat(32));
    release();
    await historical;
    expect((service as any).packetLaneHistory.get(unit).history.current().txHash).toBe(f.accepted.txHash);
    expect(f.source.transactionsFor).toHaveBeenCalledTimes(1);
  });

  it('refuses missing history and publishes no checkpoint after a snapshot failure', async () => {
    const f = fixture();
    const service = f.create();
    f.failSnapshot();
    await expect(service.rebuildPacketLaneTreeAtBlock(11n, f.accepted)).rejects.toThrow('history changed');
    expect((service as any).packetLaneHistory.size).toBe(0);
    expect((service as any).packetLaneStore.find(unit, batchPolicy, f.accepted)).toBeUndefined();
    const missing = fixture();
    missing.omitIssuance();
    await expect(missing.create().rebuildPacketLaneTreeAtBlock(11n, missing.accepted)).rejects.toThrow('issuance');
  });
});
