import { YaciHistoryService } from '../query/services/yaci-history.service';
import { YaciRestClient } from '../shared/helpers/yaci-rest';
import { YaciRestHistory } from '../shared/helpers/yaci-rest-history';
import { restBlockFixture } from './rest-block';

export function restProvider(blocks: ReturnType<typeof restBlockFixture>[]) {
  const state = { blocks, missingProducers: new Set<string>() };
  const request = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    const requestUrl = new URL(String(url));
    const path = requestUrl.pathname.replace('/api/v1/', '');
    if (path.startsWith('txs/')) {
      const txHash = path.split('/')[1];
      const block = state.blocks.find((candidate) => candidate.hashes.includes(txHash));
      return block
        ? new Response(
            JSON.stringify({
              hash: txHash,
              block_height: block.metadata.number,
              slot: block.metadata.slot,
              invalid: false,
            }),
          )
        : new Response(null, { status: 404 });
    }
    if (path.startsWith('blocks/')) {
      const selected =
        path === 'blocks/latest'
          ? state.blocks.at(-1)
          : state.blocks.find(
              (block) => path === `blocks/${block.metadata.number}` || path === `blocks/${block.metadata.hash}/cbor`,
            );
      return selected
        ? new Response(path.endsWith('/cbor') ? new Uint8Array(selected.bytes) : JSON.stringify(selected.metadata))
        : new Response(null, { status: 404 });
    }
    const entries = state.blocks
      .flatMap((block) =>
        block.hashes.map((tx_hash, index) => ({ tx_hash, block_height: block.metadata.number, index })),
      )
      .sort((a, b) =>
        requestUrl.searchParams.get('order') === 'desc'
          ? b.block_height - a.block_height
          : a.block_height - b.block_height,
      );
    if (path.startsWith('assets/') && path.endsWith('/transactions')) {
      // The native asset index returns producers, including spent outputs.
      return new Response(
        JSON.stringify(
          entries.filter(
            (row) =>
              !state.missingProducers.has(row.tx_hash) &&
              state.blocks
                .find((b) => b.metadata.number === row.block_height)!
                .bodies[row.index].outputs()
                .len() > 0,
          ),
        ),
      );
    }
    if (path.startsWith('addresses/')) return new Response(JSON.stringify(entries));
    if (path.startsWith('assets/policy/')) return new Response(JSON.stringify([{ unit: blocks[0].unit }]));
    throw new Error(`Unexpected REST path: ${path}`);
  });
  const source = new YaciRestHistory(new YaciRestClient('https://yaci.example'));
  return { state, request, source };
}

export function restGateway(fixture: ReturnType<typeof restBlockFixture>) {
  const query = jest.fn(() => {
    throw new Error('Chain reads must not use SQL');
  });
  const deployment = {
    hostStateNFT: { policyId: fixture.unit.slice(0, 56), name: fixture.unit.slice(56) },
    validators: {},
  };
  const config = {
    get: (key: string) =>
      key === 'yaciStoreEndpoint' ? 'https://yaci.example' : key === 'deployment' ? deployment : undefined,
    getOrThrow: () => deployment,
  };
  const service = new YaciHistoryService(
    config as never,
    { decodeDatum: async () => ({ state: { ibc_state_root: 'aa'.repeat(32) } }) } as never,
    { query } as never,
  );
  return { service, query };
}
