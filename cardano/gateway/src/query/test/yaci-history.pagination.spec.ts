import { YaciRestHistoryChangedError } from '../../shared/helpers/yaci-rest';
import { restBlockFixture } from '../../test-config/rest-block';
import { paginatedHistory, appendBlock } from '../../test-config/rest-history-pages';

const enumerate = (context: ReturnType<typeof paginatedHistory>) =>
  context.source.transactionsFor(
    `assets/${context.pinned.unit}/transactions`,
    context.pinned.metadata.number,
    context.after.blockHeight,
  );

describe('Yaci REST transaction pagination', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps the descending scan for stable resumed history', async () => {
    const context = paginatedHistory();
    const rows = await enumerate(context);
    expect(rows.map((row) => row.hash)).toEqual(context.state.blocks.slice(50).map((block) => block.hashes[0]));
    expect(context.pages()).toEqual(['desc:1', 'desc:2']);
  });

  it('recovers every pinned transaction when new matching transactions shift descending page offsets', async () => {
    const context = paginatedHistory((url, blocks) => {
      // Append once between descending pages and again while the forward fallback runs.
      if (url.searchParams.get('page') === '2') appendBlock(blocks);
    });
    const rows = await enumerate(context);
    expect(rows.map((row) => row.hash)).toEqual(context.state.blocks.slice(50, 200).map((block) => block.hashes[0]));
    expect(rows.map((row) => row.block.number)).toEqual(Array.from({ length: 150 }, (_, index) => index + 51));
    expect(context.pages()).toEqual(['desc:1', 'desc:2', 'asc:1', 'asc:2', 'asc:3']);
    expect(context.state.blocks).toHaveLength(202);
  });

  it.each(['desc', 'asc'])(
    'rejects a changed pinned block during the %s scan before returning any transactions',
    async (order) => {
      const context = paginatedHistory((url, blocks) => {
        if (url.searchParams.get('page') !== '2') return;
        if (url.searchParams.get('order') === 'desc') appendBlock(blocks);
        if (url.searchParams.get('order') === order) {
          blocks[199] = restBlockFixture(200, blocks[198].metadata.hash, [1], 250, blocks[198].hashes[0]);
        }
      });
      await expect(enumerate(context)).rejects.toBeInstanceOf(YaciRestHistoryChangedError);
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
    await expect(enumerate(context)).rejects.toBeInstanceOf(YaciRestHistoryChangedError);
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
    await expect(enumerate(context)).rejects.toBeInstanceOf(YaciRestHistoryChangedError);
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
    const replay = enumerate(context);
    await expect(replay).rejects.toThrow('pagination repeated a row');
    await expect(replay).rejects.not.toBeInstanceOf(YaciRestHistoryChangedError);
    expect(requests).toHaveBeenCalledTimes(1);
  });
});
