import {
  HistorySnapshotChangedError,
  type HistoryTransaction,
} from '@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery';
import * as CML from '@dcspark/cardano-multiplatform-lib-nodejs';
import * as cbor from 'cbor';
import { paginatedHistory, appendBlock } from '../../test-config/rest-history-pages';

describe('incremental Yaci REST recovery', () => {
  afterEach(() => jest.restoreAllMocks());

  it('yields the first transaction after decoding one block and decodes each of 200 blocks once', async () => {
    const context = paginatedHistory();
    const decode = jest.spyOn(context.source as any, 'readBlockTransactions');
    const iterator = context.history.transactions()[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { blockHeight: 1 } });
    expect(decode.mock.calls.map(([height]) => height)).toEqual([1]);
    const rows = [];
    for await (const row of { [Symbol.asyncIterator]: () => iterator }) rows.push(row);
    expect(rows).toHaveLength(199);
    expect(decode.mock.calls.map(([height]) => height)).toEqual(Array.from({ length: 200 }, (_, index) => index + 1));
  });

  it('yields the completed prefix before a late block failure and resumes from the last verified transaction', async () => {
    const context = paginatedHistory();
    const read = (context.source as any).readBlockTransactions.bind(context.source);
    let fail = true;
    const decode = jest.spyOn(context.source as any, 'readBlockTransactions').mockImplementation(async (height) => {
      if (fail && height === 199) throw new Error('block 199 unavailable after transport retries');
      return read(height);
    });
    const rows: HistoryTransaction[] = [];
    await expect(async () => {
      for await (const row of context.history.transactions()) rows.push(row);
    }).rejects.toThrow('block 199 unavailable');
    expect(rows).toHaveLength(198);
    fail = false;
    decode.mockClear();
    const resumed: HistoryTransaction[] = [];
    for await (const row of context.history.transactions(rows.at(-1))) resumed.push(row);
    expect(resumed.map((row) => row.blockHeight)).toEqual([198, 199, 200]);
    expect(decode.mock.calls.map(([height]) => height)).toEqual([198, 199, 200]);
  });

  it.each([false, true])(
    'keeps replay complete through the pinned tip during an append with resume %s',
    async (resumed) => {
      const context = paginatedHistory((url, blocks) => {
        if (url.searchParams.get('page') === '2') appendBlock(blocks);
      });
      const rows: HistoryTransaction[] = [];
      for await (const row of context.history.transactions(resumed ? context.after : undefined)) rows.push(row);
      const first = resumed ? 51 : 1;
      expect(rows.map((row) => row.blockHeight)).toEqual(
        Array.from({ length: 201 - first }, (_, index) => index + first),
      );
      expect(context.pages()).toEqual(['asc:1', 'asc:2', 'asc:3']);
    },
  );

  it('still rejects a replaced pinned tip after yielding replay progress', async () => {
    const context = paginatedHistory();
    const iterator = context.history.transactions()[Symbol.asyncIterator]();
    for (let height = 1; height <= 200; height++) {
      await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { blockHeight: height } });
    }
    jest
      .spyOn(context.source.api, 'block')
      .mockResolvedValueOnce({ ...context.pinned.metadata, hash: 'ff'.repeat(32) });
    await expect(iterator.next()).rejects.toBeInstanceOf(HistorySnapshotChangedError);
  });

  it.each([false, true])(
    'replays a block once when same-block rows straddle pages with overlap %s',
    async (overlap) => {
      const context = paginatedHistory();
      const fixture = context.state.blocks[99];
      const inputs = CML.TransactionInputList.new();
      inputs.add(CML.TransactionInput.new(CML.TransactionHash.from_hex(fixture.hashes[0]), 0n));
      fixture.bodies[1] = CML.TransactionBody.new(inputs, fixture.bodies[1].outputs(), 101n);
      fixture.hashes[1] = CML.hash_transaction(fixture.bodies[1]).to_hex();
      const raw = cbor.decode(fixture.bytes);
      raw[1][1] = cbor.decode(fixture.bodies[1].to_cbor_bytes());
      raw[4] = [];
      fixture.bytes = cbor.encode(raw);
      const entries = context.state.blocks.flatMap((block) =>
        (block === fixture ? [1, overlap ? 1 : 0] : [0]).map((index) => ({
          tx_hash: block.hashes[index],
          block_height: block.metadata.number,
        })),
      );
      const json = jest.spyOn(context.source.api, 'json').mockImplementation(async (path) => {
        const page = Number(new URL(path, 'https://yaci.example').searchParams.get('page'));
        return entries.slice((page - 1) * 100, page * 100);
      });
      const decode = jest.spyOn(context.source as any, 'readBlockTransactions');
      const iterator = context.history.transactions()[Symbol.asyncIterator]();
      for (let height = 1; height <= 100; height++) {
        await expect(iterator.next()).resolves.toMatchObject({ value: { blockHeight: height, transactionIndex: 0 } });
      }
      await expect(iterator.next()).resolves.toMatchObject({ value: { blockHeight: 100, transactionIndex: 1 } });
      expect(json).toHaveBeenCalledTimes(1);
      const rest = [];
      for await (const row of { [Symbol.asyncIterator]: () => iterator }) rest.push(row);
      expect(rest.map((row) => row.blockHeight)).toEqual(Array.from({ length: 100 }, (_, index) => index + 101));
      expect(decode).toHaveBeenCalledTimes(200);
    },
  );

  it('seeks a distant saved height with bounded page probes before decoding its first block', async () => {
    const context = paginatedHistory();
    const txHash = (height: number) => height.toString(16).padStart(64, '0');
    const json = jest.spyOn(context.source.api, 'json').mockImplementation(async (path) => {
      const page = Number(new URL(path, 'https://yaci.example').searchParams.get('page'));
      const start = (page - 1) * 100 + 1;
      return Array.from({ length: Math.max(0, Math.min(100, 10001 - start)) }, (_, index) => ({
        tx_hash: txHash(start + index),
        block_height: start + index,
      }));
    });
    const blocks = jest
      .spyOn(context.source, 'blockTransactions')
      .mockImplementation(async (height) => [{ hash: txHash(height), block: { number: height } }] as never);
    const iterator = context.source.transactionBlocksFor(`assets/${context.pinned.unit}/transactions`, 10000, 9550);
    await expect(iterator.next()).resolves.toMatchObject({ value: [{ block: { number: 9550 } }] });
    expect(json.mock.calls.length).toBeLessThan(20);
    expect(blocks.mock.calls).toEqual([[9550]]);
    await iterator.return(undefined);
  });

  it.each([2, 3])('reports a repeating page %s after saving the ordered prefix', async (repeatedPage) => {
    const context = paginatedHistory();
    const json = context.source.api.json.bind(context.source.api);
    jest.spyOn(context.source.api, 'json').mockImplementation(async (path) => {
      const url = new URL(path, 'https://yaci.example');
      if (url.searchParams.get('page') === String(repeatedPage)) url.searchParams.set('page', '1');
      return json(url.pathname.slice(1) + url.search);
    });
    const rows: HistoryTransaction[] = [];
    await expect(async () => {
      for await (const row of context.history.transactions()) rows.push(row);
    }).rejects.toBeInstanceOf(HistorySnapshotChangedError);
    expect(rows).toHaveLength((repeatedPage - 1) * 100);
  });

  it('rejects same-block overlap once the index exceeds the raw block transaction count', async () => {
    const context = paginatedHistory();
    const json = context.source.api.json.bind(context.source.api);
    const block = context.state.blocks[99];
    jest.spyOn(context.source.api, 'json').mockImplementation(async (path) => {
      if (new URL(path, 'https://yaci.example').searchParams.get('page') === '2') {
        return block.hashes.map((tx_hash) => ({ tx_hash, block_height: block.metadata.number }));
      }
      return json(path);
    });
    const rows: HistoryTransaction[] = [];
    await expect(async () => {
      for await (const row of context.history.transactions()) rows.push(row);
    }).rejects.toBeInstanceOf(HistorySnapshotChangedError);
    expect(rows).toHaveLength(100);
  });
});
