import {
  HistorySnapshotChangedError,
  type HistoryTransaction,
} from '@cardano-ibc/tx-builder-runtime/consensusHistoryRecovery';
import { createRestHistorySource } from '../../shared/helpers/consensus-history-rest';
import { restBlockFixture } from '../../test-config/rest-block';
import { restProvider } from '../../test-config/rest-provider';

function paginatedHistory(onPage?: (url: URL, blocks: ReturnType<typeof restBlockFixture>[]) => void) {
  const blocks: ReturnType<typeof restBlockFixture>[] = [];
  for (let height = 1; height <= 200; height++) {
    const previous = blocks.at(-1);
    blocks.push(restBlockFixture(height, previous?.metadata.hash, [1], height, previous?.hashes[0]));
  }
  const pinned = blocks.at(-1)!;
  const resume = blocks[50];
  const { source, request, state } = restProvider(blocks);
  const respond = request.getMockImplementation()!;
  request.mockImplementation(async (url, options) => {
    const requestUrl = new URL(String(url));
    if (!requestUrl.pathname.endsWith(`/assets/${pinned.unit}/transactions`)) return respond(url, options);
    onPage?.(requestUrl, state.blocks);
    const entries = state.blocks.map((block) => ({ tx_hash: block.hashes[0], block_height: block.metadata.number }));
    if (requestUrl.searchParams.get('order') === 'desc') entries.reverse();
    const count = Number(requestUrl.searchParams.get('count'));
    const offset = (Number(requestUrl.searchParams.get('page')) - 1) * count;
    return new Response(JSON.stringify(entries.slice(offset, offset + count)));
  });
  const history = createRestHistorySource(
    source,
    {
      clientToken: { policyId: pinned.unit.slice(0, 56), name: pinned.unit.slice(56) },
      stateAddress: pinned.address,
      bootstrap: { txHash: blocks[0].hashes[0], outputIndex: 0 },
    },
    async () => ({}) as never,
  );
  const after = {
    txHash: resume.hashes[0],
    blockHash: resume.metadata.hash,
    blockHeight: resume.metadata.number,
    slot: resume.metadata.slot,
    transactionIndex: 0,
  };
  const pages = () =>
    request.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter((url) => url.pathname.endsWith('/transactions'))
      .map((url) => `${url.searchParams.get('order')}:${url.searchParams.get('page')}`);
  return { source, request, state, history, after, pinned, pages };
}

function appendBlock(blocks: ReturnType<typeof restBlockFixture>[]) {
  const previous = blocks.at(-1)!;
  const height = previous.metadata.number + 1;
  blocks.push(restBlockFixture(height, previous.metadata.hash, [1], height, previous.hashes[0]));
}

describe('Yaci REST recovery pagination', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the descending scan for stable resumed history', async () => {
    const context = paginatedHistory();
    const rows: HistoryTransaction[] = [];
    for await (const row of context.history.transactions(context.after)) rows.push(row);
    expect(rows.map((row) => row.txHash)).toEqual(context.state.blocks.slice(50).map((block) => block.hashes[0]));
    expect(context.pages()).toEqual(['desc:1', 'desc:2']);
  });

  it('recovers every pinned transaction when new matching transactions shift descending page offsets', async () => {
    const context = paginatedHistory((url, blocks) => {
      // Append once between descending pages and again while the forward fallback runs.
      if (url.searchParams.get('page') === '2') appendBlock(blocks);
    });
    const rows: HistoryTransaction[] = [];
    for await (const row of context.history.transactions(context.after)) rows.push(row);
    expect(rows.map((row) => row.txHash)).toEqual(context.state.blocks.slice(50, 200).map((block) => block.hashes[0]));
    expect(rows.map((row) => row.blockHeight)).toEqual(Array.from({ length: 150 }, (_, index) => index + 51));
    expect(context.pages()).toEqual(['desc:1', 'desc:2', 'asc:1', 'asc:2', 'asc:3']);
    expect(context.state.blocks).toHaveLength(202);
  });

  it.each(['desc', 'asc'])(
    'rejects a changed pinned block during the %s scan before yielding any recovery rows',
    async (order) => {
      const context = paginatedHistory((url, blocks) => {
        if (url.searchParams.get('page') !== '2') return;
        if (url.searchParams.get('order') === 'desc') appendBlock(blocks);
        if (url.searchParams.get('order') === order) {
          blocks[199] = restBlockFixture(200, blocks[198].metadata.hash, [1], 250, blocks[198].hashes[0]);
        }
      });
      const rows: HistoryTransaction[] = [];
      await expect(async () => {
        for await (const row of context.history.transactions(context.after)) rows.push(row);
      }).rejects.toBeInstanceOf(HistorySnapshotChangedError);
      expect(rows).toEqual([]);
      expect(context.pages()).toEqual(
        order === 'desc' ? ['desc:1', 'desc:2'] : ['desc:1', 'desc:2', 'asc:1', 'asc:2', 'asc:3'],
      );
    },
  );

  it('reports further drift in the forward fallback as a retryable snapshot change', async () => {
    const context = paginatedHistory((url, blocks) => {
      if (url.searchParams.get('order') === 'desc' && url.searchParams.get('page') === '2') appendBlock(blocks);
    });
    const json = context.source.api.json.bind(context.source.api);
    const requests = jest.spyOn(context.source.api, 'json').mockImplementation(async (path) => {
      const url = new URL(path, 'https://yaci.example');
      if (url.searchParams.get('order') === 'asc' && url.searchParams.get('page') === '2') {
        url.searchParams.set('page', '1');
        return json(url.pathname.slice(1) + url.search);
      }
      return json(path);
    });
    const rows: HistoryTransaction[] = [];
    await expect(async () => {
      for await (const row of context.history.transactions(context.after)) rows.push(row);
    }).rejects.toBeInstanceOf(HistorySnapshotChangedError);
    expect(rows).toEqual([]);
    expect(requests).toHaveBeenCalledTimes(4);
  });

  it('retries when the pinned block disappears before the forward fallback starts', async () => {
    let missingAnchor = false;
    const context = paginatedHistory((url, blocks) => {
      if (url.searchParams.get('order') === 'desc' && url.searchParams.get('page') === '2') {
        appendBlock(blocks);
        missingAnchor = true;
      }
    });
    const block = context.source.api.block.bind(context.source.api);
    jest
      .spyOn(context.source.api, 'block')
      .mockImplementation(async (at) => (missingAnchor && at === 200 ? null : block(at)));
    const rows: HistoryTransaction[] = [];
    await expect(async () => {
      for await (const row of context.history.transactions(context.after)) rows.push(row);
    }).rejects.toBeInstanceOf(HistorySnapshotChangedError);
    expect(rows).toEqual([]);
    expect(context.pages()).toEqual(['desc:1', 'desc:2']);
  });

  it('rejects duplicate rows within one page without treating them as offset drift', async () => {
    const context = paginatedHistory();
    const entries = context.state.blocks
      .slice(100)
      .reverse()
      .map((block) => ({ tx_hash: block.hashes[0], block_height: block.metadata.number }));
    entries[99] = entries[0];
    const requests = jest.spyOn(context.source.api, 'json').mockResolvedValue(entries);
    const replay = (async () => {
      for await (const _row of context.history.transactions(context.after)) {
        /* consume */
      }
    })();
    await expect(replay).rejects.toThrow('pagination repeated a row');
    await expect(replay).rejects.not.toBeInstanceOf(HistorySnapshotChangedError);
    expect(requests).toHaveBeenCalledTimes(1);
  });
});
