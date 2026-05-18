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
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          nonce: '11'.repeat(32),
        },
      ],
    });
    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ogmiosEndpoint') {
          return 'ws://ogmios.local';
        }
        if (key === 'cardanoEpochParamsEndpoint') {
          return 'https://preprod.koios.rest/api/v1';
        }
        if (key === 'cardanoEpochLength') {
          return 432000;
        }
        if (key === 'cardanoPoolRegistrationHistoryEndpoint') {
          return undefined;
        }
        return undefined;
      }),
    };

    entityManagerMock = {
      query: jest.fn().mockResolvedValue([]),
    };

    service = new YaciHistoryService(
      configServiceMock as unknown as ConfigService,
      {} as any,
      entityManagerMock as unknown as EntityManager,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT;
    delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch;
  });

  it('sources a full epoch context from Ogmios local state at the block point', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
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
          firstRegistrationSlot: null,
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
      '11'.repeat(32),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/api/v1/epoch_params',
      }),
      expect.objectContaining({
        headers: { accept: 'application/json' },
      }),
    );
  });

  it('hydrates first registration slots from the cache before local or external lookups', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ pool_id: 'pool1cachedpool', first_registration_slot: '42' }]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      currentEpoch: 7,
      epochNonce: '11'.repeat(32),
      slotsPerKesPeriod: 129600,
      stakeDistribution: [
        {
          poolId: 'pool1cachedpool',
          stake: 900n,
          vrfKeyHash: 'aa'.repeat(32),
        },
      ],
    });

    await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
      stakeDistribution: [
        {
          poolId: 'pool1cachedpool',
          firstRegistrationSlot: 42n,
        },
      ],
    });

    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url.pathname)).not.toContain('/api/v1/pool_updates');
  });

  it('uses the configured local registration-slot assumption for every unresolved stake pool', async () => {
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      currentEpoch: 7,
      epochNonce: '11'.repeat(32),
      slotsPerKesPeriod: 129600,
      stakeDistribution: [
        {
          poolId: 'pool1assumedpoola',
          stake: 500n,
          vrfKeyHash: 'aa'.repeat(32),
        },
        {
          poolId: 'pool1assumedpoolb',
          stake: 400n,
          vrfKeyHash: 'bb'.repeat(32),
        },
      ],
    });

    await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
      stakeDistribution: [
        {
          poolId: 'pool1assumedpoola',
          firstRegistrationSlot: 1n,
        },
        {
          poolId: 'pool1assumedpoolb',
          firstRegistrationSlot: 1n,
        },
      ],
    });
  });

  it('caches first registration slots discovered from local Yaci tables', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ pool_id: 'pool1localpool', first_registration_slot: '77' }])
      .mockResolvedValueOnce(undefined);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      currentEpoch: 7,
      epochNonce: '11'.repeat(32),
      slotsPerKesPeriod: 129600,
      stakeDistribution: [
        {
          poolId: 'pool1localpool',
          stake: 900n,
          vrfKeyHash: 'aa'.repeat(32),
        },
      ],
    });

    await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
      stakeDistribution: [
        {
          poolId: 'pool1localpool',
          firstRegistrationSlot: 77n,
        },
      ],
    });

    expect(entityManagerMock.query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO bridge_pool_registration_cache'),
      [JSON.stringify([{ pool_id: 'pool1localpool', first_registration_slot: '77' }]), 'yaci'],
    );
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url.pathname)).not.toContain('/api/v1/pool_updates');
  });

  it('looks up missing first registration slots externally and caches them', async () => {
    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'ogmiosEndpoint') return 'ws://ogmios.local';
      if (key === 'cardanoEpochParamsEndpoint') return 'https://preprod.koios.rest/api/v1';
      if (key === 'cardanoEpochLength') return 432000;
      if (key === 'cardanoPoolRegistrationHistoryEndpoint') return 'https://preprod.koios.rest/api/v1';
      return undefined;
    });
    entityManagerMock.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          pool_id_bech32: 'pool1externalpool',
          block_time: '1000',
          update_type: 'registration',
        },
      ],
    });

    await expect(
      service.findFirstPoolRegistrationSlots(['pool1externalpool'], {
        slotNo: 100n,
        timestampUnixNs: 900_000_000_000n,
      }),
    ).resolves.toEqual(new Map([['pool1externalpool', 200n]]));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/api/v1/pool_updates',
      }),
      expect.objectContaining({
        headers: { accept: 'application/json' },
      }),
    );
    expect(entityManagerMock.query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO bridge_pool_registration_cache'),
      [JSON.stringify([{ pool_id: 'pool1externalpool', first_registration_slot: '200' }]), 'external'],
    );
  });

  it('rejects acquired epoch context when Ogmios resolves a different epoch than the block history', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }]);
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

  it('fails hard when epoch params do not provide a valid nonce', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }]);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [{ nonce: null }],
    });

    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow(
      'Cardano epoch params lookup did not return a valid nonce for epoch 7',
    );
    expect(queryEpochContextAtPoint).not.toHaveBeenCalled();
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
          firstRegistrationSlot: null,
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
          firstRegistrationSlot: null,
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
          firstRegistrationSlot: null,
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
      '11'.repeat(32),
    );
    expect(queryEpochContextAtPoint).toHaveBeenNthCalledWith(
      2,
      'ws://ogmios.local',
      {
        slot: 1199n,
        hash: 'ef'.repeat(32),
      },
      '11'.repeat(32),
    );
  });
});
