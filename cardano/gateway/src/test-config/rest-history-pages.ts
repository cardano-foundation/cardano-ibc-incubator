import { createRestHistorySource } from '../shared/helpers/consensus-history-rest';
import { restBlockFixture } from './rest-block';
import { restProvider } from './rest-provider';

export function paginatedHistory(onPage?: (url: URL, blocks: ReturnType<typeof restBlockFixture>[]) => void) {
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

export function appendBlock(blocks: ReturnType<typeof restBlockFixture>[]) {
  const previous = blocks.at(-1)!;
  const height = previous.metadata.number + 1;
  blocks.push(restBlockFixture(height, previous.metadata.hash, [1], height, previous.hashes[0]));
}
