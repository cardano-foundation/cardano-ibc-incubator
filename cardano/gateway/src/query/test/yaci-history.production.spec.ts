import { restProvider, restGateway } from '../../test-config/rest-provider';
import { restBlockFixture } from '../../test-config/rest-block';
import { YaciRestClient, YaciRestHistoryChangedError } from '../../shared/helpers/yaci-rest';

describe('Yaci production estimates', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup() {
    const fixture = restBlockFixture();
    fixture.metadata.epoch = 7;
    const { state } = restProvider([fixture]);
    const { service, query } = restGateway(fixture);
    const rows = [
      { epoch: 2, slot_leader: 'pool-a', number: 20 },
      { epoch: 6, slot_leader: 'pool-a', number: 90 },
      { epoch: 7, slot_leader: 'pool-a', number: 99 },
      { epoch: 7, slot_leader: 'pool-b', number: 100 },
      { epoch: 1, slot_leader: 'expired', number: 10 },
      { epoch: 7, slot_leader: 'future', number: 101 },
    ];
    const json = jest.spyOn(YaciRestClient.prototype, 'json').mockImplementation(async (path) => {
      const epoch = Number(path.match(/^blocks\/epoch\/(\d+)/)?.[1]);
      return { blocks: rows.filter(row => row.epoch === epoch).map(row => ({ ...fixture.metadata, ...row })) };
    });
    const block = { height: 100, hash: fixture.metadata.hash, prevHash: fixture.metadata.previous_block!,
      slotNo: 1100n, epochNo: 7, timestampUnixNs: 1_000_000_000n, slotLeader: 'pool1anchorpool' };
    return { service, query, json, block, state };
  }

  it('uses REST observations at the pinned anchor and expires older epochs without chain SQL', async () => {
    const { service, query, json, block } = setup();
    const history = await service.findObservedPoolProductionAtBlock(block);
    expect(query).not.toHaveBeenCalled();
    expect(json.mock.calls.map(([path]) => path)).toEqual(
      [2, 3, 4, 5, 6, 7].map(epoch => `blocks/epoch/${epoch}?count=100&page=1`),
    );
    expect(history.pools).toEqual([
      { pool_id: 'pool-a', completed_epochs_bitmap: 17, produced_current_epoch: true },
      { pool_id: 'pool-b', completed_epochs_bitmap: 0, produced_current_epoch: true },
    ]);
  });

  it('rejects an anchor that differs from the requested block', async () => {
    const { service, block } = setup();
    await expect(service.findObservedPoolProductionAtBlock({ ...block, hash: 'ab'.repeat(32) }))
      .rejects.toThrow('Observed production anchor changed');
  });

  it('rejects a rollback during the production scan', async () => {
    const { service, block, json, state } = setup();
    json.mockImplementation(async () => {
      const changed = restBlockFixture(100, undefined, [1], 9);
      changed.metadata.epoch = 7;
      state.blocks = [changed];
      return { blocks: [] };
    });
    await expect(service.findObservedPoolProductionAtBlock(block)).rejects.toThrow(YaciRestHistoryChangedError);
  });

  it('propagates an unavailable epoch instead of returning empty observations', async () => {
    const { service, block, json } = setup();
    json.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.findObservedPoolProductionAtBlock(block)).rejects.toThrow('provider unavailable');
  });
});
