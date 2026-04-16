import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { queryEpochContextAtPoint } from '../../shared/helpers/ogmios';
import { YaciHistoryService } from '../services/yaci-history.service';

jest.mock('../../shared/helpers/ogmios', () => ({
  queryEpochContextAtPoint: jest.fn(),
}));

describe('YaciHistoryService', () => {
  let service: YaciHistoryService;
  let configServiceMock: { get: jest.Mock };
  let entityManagerMock: { query: jest.Mock };

  const block = {
    height: 100,
    hash: 'ab'.repeat(32),
    prevHash: 'cd'.repeat(32),
    slotNo: 1100n,
    epochNo: 7,
    timestampUnixNs: 1_000_000_000n,
    slotLeader: 'pool1anchorpool',
  };

  beforeEach(() => {
    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ogmiosEndpoint') {
          return 'ws://ogmios.local';
        }
        if (key === 'cardanoEpochNonceGenesis') {
          return 'aa'.repeat(32);
        }
        if (key === 'cardanoEpochLength') {
          return 432000;
        }
        return undefined;
      }),
    };

    entityManagerMock = {
      query: jest.fn(),
    };

    service = new YaciHistoryService(
      configServiceMock as unknown as ConfigService,
      {} as any,
      entityManagerMock as unknown as EntityManager,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('sources a full epoch context from Ogmios local state at the block point', async () => {
    entityManagerMock.query.mockResolvedValueOnce([{ start_slot: '1000' }]).mockResolvedValueOnce([{ start_slot: '1200' }]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      currentEpoch: 7,
      epochNonce: '11'.repeat(32),
      slotsPerKesPeriod: 129600,
      stakeDistribution: [
        {
          poolId: 'pool1ogmiospool',
          stake: 900n,
          vrfKeyHash: '0x' + 'AA'.repeat(32),
        },
      ],
    });

    await expect(service.findEpochContextAtBlock(block)).resolves.toEqual({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1ogmiospool',
          stake: 900n,
          vrfKeyHash: 'aa'.repeat(32),
        },
      ],
      verificationContext: {
        epochNonce: '11'.repeat(32),
        slotsPerKesPeriod: 129600,
        currentEpochStartSlot: 1000n,
        currentEpochEndSlotExclusive: 1200n,
      },
    });

    expect(queryEpochContextAtPoint).toHaveBeenCalledWith(
      'ws://ogmios.local',
      {
        slot: 1100n,
        hash: 'ab'.repeat(32),
      },
      'aa'.repeat(32),
    );
  });

  it('rejects acquired epoch context when Ogmios resolves a different epoch than the block history', async () => {
    entityManagerMock.query.mockResolvedValueOnce([{ start_slot: '1000' }]).mockResolvedValueOnce([{ start_slot: '1200' }]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      currentEpoch: 8,
      epochNonce: '22'.repeat(32),
      slotsPerKesPeriod: 129600,
      stakeDistribution: [],
    });

    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow(
      'Ogmios acquired epoch 8 at block 100, expected epoch 7',
    );
  });

  it('falls back to configured epoch length when the next epoch start slot is unavailable', async () => {
    entityManagerMock.query.mockResolvedValueOnce([{ start_slot: '0' }]).mockResolvedValueOnce([{ start_slot: null }]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      currentEpoch: 7,
      epochNonce: '33'.repeat(32),
      slotsPerKesPeriod: 129600,
      stakeDistribution: [
        {
          poolId: 'pool1fallbackpool',
          stake: 1000n,
          vrfKeyHash: 'bb'.repeat(32),
        },
      ],
    });

    await expect(service.findEpochContextAtBlock({ ...block, slotNo: 1n })).resolves.toEqual({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1fallbackpool',
          stake: 1000n,
          vrfKeyHash: 'bb'.repeat(32),
        },
      ],
      verificationContext: {
        epochNonce: '33'.repeat(32),
        slotsPerKesPeriod: 129600,
        currentEpochStartSlot: 0n,
        currentEpochEndSlotExclusive: 432000n,
      },
    });
  });

  it('retries epoch-context acquisition at a newer block in the same epoch when the original point is too old', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce([
        {
          number: 119,
          hash: 'ef'.repeat(32),
          prev_hash: '12'.repeat(32),
          slot: '1199',
          epoch: 7,
          block_time: '1',
          slot_leader: 'pool1latestinepoch',
        },
      ]);
    (queryEpochContextAtPoint as jest.Mock)
      .mockRejectedValueOnce(new Error('Failed to acquire requested point. Target point is too old.'))
      .mockResolvedValueOnce({
        currentEpoch: 7,
        epochNonce: '44'.repeat(32),
        slotsPerKesPeriod: 129600,
        stakeDistribution: [
          {
            poolId: 'pool1retrypool',
            stake: 123n,
            vrfKeyHash: 'cc'.repeat(32),
          },
        ],
      });

    await expect(service.findEpochContextAtBlock(block)).resolves.toEqual({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1retrypool',
          stake: 123n,
          vrfKeyHash: 'cc'.repeat(32),
        },
      ],
      verificationContext: {
        epochNonce: '44'.repeat(32),
        slotsPerKesPeriod: 129600,
        currentEpochStartSlot: 1000n,
        currentEpochEndSlotExclusive: 1200n,
      },
    });

    expect(queryEpochContextAtPoint).toHaveBeenNthCalledWith(
      1,
      'ws://ogmios.local',
      {
        slot: 1100n,
        hash: 'ab'.repeat(32),
      },
      'aa'.repeat(32),
    );
    expect(queryEpochContextAtPoint).toHaveBeenNthCalledWith(
      2,
      'ws://ogmios.local',
      {
        slot: 1199n,
        hash: 'ef'.repeat(32),
      },
      'aa'.repeat(32),
    );
  });
});
