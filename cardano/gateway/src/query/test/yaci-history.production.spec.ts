import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { YaciHistoryService } from '../services/yaci-history.service';
import { LucidService } from '../../shared/modules/lucid/lucid.service';

describe('Yaci production estimates', () => {
  it('uses block observations for standalone estimates and expires older epochs', async () => {
    const entityManagerMock = {
      query: jest.fn().mockResolvedValue([
        { epoch: 2, slot_leader: 'pool-a' },
        { epoch: 6, slot_leader: 'pool-a' },
        { epoch: 7, slot_leader: 'pool-a' },
        { epoch: 7, slot_leader: 'pool-b' },
        { epoch: 1, slot_leader: 'expired' },
        { epoch: 7, slot_leader: null },
      ]),
    };
    const service = new YaciHistoryService(
      { get: jest.fn() } as unknown as ConfigService,
      {} as LucidService,
      entityManagerMock as unknown as EntityManager,
    );
    const block = {
      height: 100,
      hash: 'ab'.repeat(32),
      prevHash: 'cd'.repeat(32),
      slotNo: 1100n,
      epochNo: 7,
      timestampUnixNs: 1_000_000_000n,
      slotLeader: 'pool1anchorpool',
    };
    const history = await service.findObservedPoolProductionAtBlock(block);
    expect(entityManagerMock.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT epoch, slot_leader'),
      [2, 7, 100, block.hash],
    );
    expect(history.pools).toEqual([
      { pool_id: 'pool-a', completed_epochs_bitmap: 17, produced_current_epoch: true },
      { pool_id: 'pool-b', completed_epochs_bitmap: 0, produced_current_epoch: true },
    ]);
  });
});
