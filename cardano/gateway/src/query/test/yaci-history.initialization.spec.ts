import { bech32 } from 'bech32';
import { YaciHistoryService } from '../services/yaci-history.service';
import { queryInitialPoolParametersAtPoint } from '../../shared/helpers/ogmios';

jest.mock('../../shared/helpers/ogmios', () => ({
  ...jest.requireActual('../../shared/helpers/ogmios'),
  queryInitialPoolParametersAtPoint: jest.fn(),
}));
const pool = bech32.encode('pool', bech32.toWords(Buffer.alloc(28, 1)));
const binding = (key: number) => ({ pool_id: pool, vrf_key_hash: Buffer.alloc(32, key), first_registration_slot: 0n });
const block = {
  height: 100,
  hash: 'ab'.repeat(32),
  prevHash: 'cd'.repeat(32),
  slotNo: 700n,
  epochNo: 7,
  timestampUnixNs: 1_700_000_700_000_000_000n,
  slotLeader: pool,
};
function service(provider?: string) {
  const config = { ogmiosEndpoint: 'ws://operator-node', cardanoPoolRegistrationHistoryEndpoint: provider };
  const history = new YaciHistoryService(
    { get: (key: keyof typeof config) => config[key] } as never,
    {} as never,
    {} as never,
  );
  jest.spyOn(history as never, 'restHistory').mockReturnValue({
    snapshot: async (_height: unknown, read: (anchor: { hash: string }) => Promise<unknown>) =>
      read({ hash: block.hash }),
    pages: async function* (path: string) {
      if (provider && path === 'pools/registrations') yield { pool_id: pool, block_number: 40 };
    },
    blockTransactions: async () => { throw new Error('Historical Cardano bodies have been pruned'); },
  } as never);
  return history;
}

afterEach(() => jest.restoreAllMocks());

it('initializes genesis pools from the node without requiring registration transactions or a file', async () => {
  jest.mocked(queryInitialPoolParametersAtPoint).mockResolvedValue({ current: [binding(1)], genesis: [binding(1)] });
  const registry = await service().findInitialPoolRegistryAtBlock(block);
  expect(registry.pools[0]).toMatchObject({ registered: true, registration: binding(1) });
  expect(registry.mark).toEqual([binding(1)]);
  expect(registry.effective).toEqual([binding(1)]);
  expect(queryInitialPoolParametersAtPoint).toHaveBeenCalledWith('ws://operator-node', {
    slot: block.slotNo,
    hash: block.hash,
  });
});

it('loads earlier pool metadata from the configured provider while bridge history begins later', async () => {
  jest.mocked(queryInitialPoolParametersAtPoint).mockResolvedValue({ current: [binding(2)], genesis: [] });
  const history = service('https://operator-history.example/api/v0');
  const first = '01'.repeat(32),
    second = '02'.repeat(32);
  jest.spyOn(history as any, 'fetchBlockfrostArray').mockImplementation(async (url: URL) => {
    if (url.pathname.endsWith('/updates'))
      return [
        { action: 'registered', tx_hash: first, cert_index: 0 },
        { action: 'registered', tx_hash: second, cert_index: 0 },
      ];
    return [{ cert_index: 0, pool_id: pool, vrf_key: (url.pathname.includes(first) ? '01' : '02').repeat(32) }];
  });
  jest.spyOn(history as any, 'fetchBlockfrostJson').mockImplementation(async (url: URL) => {
    const early = url.pathname.endsWith(first);
    return url.pathname.includes('/txs/')
      ? { slot: early ? 400 : 600, index: 0, block: early ? first : second }
      : { height: early ? 40 : 60, epoch: early ? 4 : 6 };
  });
  const registry = await history.findInitialPoolRegistryAtBlock(block);
  expect(registry.pools[0].registration).toMatchObject({
    pool_id: pool,
    vrf_key_hash: Buffer.alloc(32, 2),
    first_registration_slot: 400n,
  });
  expect(registry.effective[0]).toMatchObject({ vrf_key_hash: Buffer.alloc(32, 1), first_registration_slot: 400n });
});

it('rejects incomplete initialization history instead of inventing a registration age or key', async () => {
  jest.mocked(queryInitialPoolParametersAtPoint).mockResolvedValue({ current: [binding(1)], genesis: [] });
  await expect(service().findInitialPoolRegistryAtBlock(block)).rejects.toThrow('does not match the node registry');
});
