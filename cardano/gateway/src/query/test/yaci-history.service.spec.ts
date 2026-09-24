import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import {
  queryCurrentEpochStakeDistribution,
  queryCurrentEpochVerificationData,
  queryEpochContextAtPoint,
  queryOperationalCertificateCountersAtPoint,
} from '../../shared/helpers/ogmios';
import { YaciHistoryService } from '../services/yaci-history.service';

jest.mock('../../shared/helpers/ogmios', () => ({
  queryCurrentEpochStakeDistribution: jest.fn(),
  queryCurrentEpochVerificationData: jest.fn(),
  queryEpochContextAtPoint: jest.fn(),
  queryOperationalCertificateCountersAtPoint: jest.fn(),
}));

const exactStake = (stake: bigint, totalStake: bigint = stake) => ({
  stake,
  relativeStakeNumerator: stake,
  relativeStakeDenominator: totalStake,
});

const activeSlotCoefficient = {
  activeSlotCoefficientNumerator: 1n,
  activeSlotCoefficientDenominator: 20n,
};

const defaultVerificationData = {
  currentEpoch: 7,
  epochNonce: '11'.repeat(32),
  slotsPerKesPeriod: 129600,
  ...activeSlotCoefficient,
  maxKesEvolutions: 62,
};

const registrationResponse = (
  url: URL,
  registrations: {
    poolId: string;
    txHash: string;
    vrf: string;
    slot: number;
    blockTime?: number;
    activeEpoch?: number;
  }[],
) => {
  for (const registration of registrations) {
    const { poolId, txHash, vrf, slot } = registration;
    let body: unknown;
    if (url.pathname.endsWith(`/pools/${poolId}/updates`)) {
      body = [{ tx_hash: txHash, cert_index: 0, action: 'registered' }];
    } else if (url.pathname.endsWith(`/txs/${txHash}/pool_updates`)) {
      body = [{ cert_index: 0, pool_id: poolId, vrf_key: vrf, active_epoch: registration.activeEpoch ?? 2 }];
    } else if (url.pathname.endsWith(`/txs/${txHash}`)) {
      body = { block_time: registration.blockTime ?? 1, slot };
    } else {
      continue;
    }
    return { ok: true, json: async () => body };
  }
  return undefined;
};

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
      json: async () => ({ epoch: 7, nonce: '11'.repeat(32) }),
    });
    configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ogmiosEndpoint') {
          return 'ws://ogmios.local';
        }
        if (key === 'cardanoEpochParamsEndpoint') {
          return 'https://cardano-preprod.blockfrost.io/api/v0';
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
    (queryCurrentEpochVerificationData as jest.Mock).mockResolvedValue(defaultVerificationData);
    (queryCurrentEpochStakeDistribution as jest.Mock).mockResolvedValue([]);

    service = new YaciHistoryService(
      configServiceMock as unknown as ConfigService,
      {} as any,
      entityManagerMock as unknown as EntityManager,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
    delete process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT;
    delete process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE;
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('sources a full epoch context from Ogmios local state at the block point', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      stakeDistribution: [
        {
          poolId: 'pool1ogmiospool',
          ...exactStake(900n),
          vrfKeyHash: '0x' + 'AA'.repeat(32),
        },
      ],
    });

    await expect(service.findEpochContextAtBlock(block)).resolves.toEqual({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1ogmiospool',
          ...exactStake(900n),
          vrfKeyHash: 'aa'.repeat(32),
          firstRegistrationSlot: null,
        },
      ],
      verificationContext: {
        epochNonce: '11'.repeat(32),
        slotsPerKesPeriod: 129600,
        ...activeSlotCoefficient,
        maxKesEvolutions: 62,
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
      false,
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/api/v0/epochs/7/parameters',
      }),
      expect.objectContaining({
        headers: { accept: 'application/json' },
      }),
    );
  });

  it('queries operational certificate counters at the exact block point', async () => {
    const snapshot = new Map([
      ['pool1a', 2n],
      ['pool1b', 5n],
    ]);
    (queryOperationalCertificateCountersAtPoint as jest.Mock).mockResolvedValue(snapshot);

    await expect(service.findOperationalCertificateCountersAtBlock(block)).resolves.toBe(snapshot);
    expect(queryOperationalCertificateCountersAtPoint).toHaveBeenCalledTimes(1);
    expect(queryOperationalCertificateCountersAtPoint).toHaveBeenCalledWith('ws://ogmios.local', {
      slot: 1100n,
      hash: 'ab'.repeat(32),
    });
    expect(queryEpochContextAtPoint).not.toHaveBeenCalled();
  });

  it('does not substitute a same-epoch point when the exact counter snapshot is stale', async () => {
    (queryOperationalCertificateCountersAtPoint as jest.Mock).mockRejectedValue(
      new Error('Failed to acquire requested point. Target point is too old.'),
    );

    await expect(service.findOperationalCertificateCountersAtBlock(block)).rejects.toThrow('Target point is too old');
    expect(queryOperationalCertificateCountersAtPoint).toHaveBeenCalledTimes(1);
    expect(entityManagerMock.query).not.toHaveBeenCalled();
  });

  it('hydrates first registration slots from the cache before local or external lookups', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ pool_id: 'pool1cachedpool', first_registration_slot: '42' }]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      stakeDistribution: [
        {
          poolId: 'pool1cachedpool',
          ...exactStake(900n),
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
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url.pathname)).not.toContain('/api/v0/pools/pool1cachedpool/updates');
  });

  it('uses explicit local registration-slot and static-stake assumptions together', async () => {
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      stakeDistribution: [
        {
          poolId: 'pool1assumedpoola',
          ...exactStake(500n, 900n),
          vrfKeyHash: 'aa'.repeat(32),
        },
        {
          poolId: 'pool1assumedpoolb',
          ...exactStake(400n, 900n),
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
    expect(queryEpochContextAtPoint).toHaveBeenCalledWith(
      'ws://ogmios.local',
      {
        slot: 1100n,
        hash: 'ab'.repeat(32),
      },
      '11'.repeat(32),
      true,
    );
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
      ...defaultVerificationData,
      stakeDistribution: [
        {
          poolId: 'pool1localpool',
          ...exactStake(900n),
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
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url.pathname)).not.toContain('/api/v0/pools/pool1localpool/updates');
  });

  it('looks up missing first registration slots externally and caches them', async () => {
    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'ogmiosEndpoint') return 'ws://ogmios.local';
      if (key === 'cardanoEpochParamsEndpoint') return 'https://cardano-preprod.blockfrost.io/api/v0';
      if (key === 'cardanoEpochLength') return 432000;
      if (key === 'cardanoPoolRegistrationHistoryEndpoint') return 'https://cardano-preprod.blockfrost.io/api/v0';
      return undefined;
    });
    entityManagerMock.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) =>
      registrationResponse(url, [{
        poolId: 'pool1externalpool', txHash: 'ab'.repeat(32), vrf: 'aa'.repeat(32),
        slot: 200, blockTime: 1000,
      }])
    );

    await expect(
      service.findFirstPoolRegistrationSlots(['pool1externalpool'], {
        slotNo: 100n,
        timestampUnixNs: 900_000_000_000n,
      }),
    ).resolves.toEqual(new Map([['pool1externalpool', 200n]]));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: '/api/v0/pools/pool1externalpool/updates',
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

  it('uses the direct epoch snapshot when the latest completed pool-history row is absent', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) => ({
      ok: true,
      json: async () => url.pathname.endsWith('/history')
        ? []
        : url.pathname.endsWith('/epochs/1429/stakes/pool1historicala')
        ? [{ amount: '128498584722' }]
        : [],
    }));

    await expect(service['fetchBlockfrostPoolStake'](
      'https://cardano-preview.blockfrost.io/api/v0',
      'pool1historicala',
      1429,
    )).resolves.toBe(128498584722n);
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url.pathname)).toEqual([
      '/api/v0/pools/pool1historicala/history',
      '/api/v0/epochs/1429/stakes/pool1historicala',
    ]);
  });

  it('uses the certificate activation epoch for a later pool update', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) =>
      registrationResponse(url, [{
        poolId: 'pool1updated', txHash: 'ab'.repeat(32), vrf: 'aa'.repeat(32),
        slot: 200, activeEpoch: 9,
      }])
    );

    const rows = await service['fetchBlockfrostPoolRegistrationUpdates'](
      'https://cardano-preview.blockfrost.io/api/v0',
      'pool1updated',
    );
    expect(rows).toMatchObject([{ active_epoch_no: 9, registration_slot: 200 }]);
    expect(service['resolveHistoricalProducerRegistrations'](
      [{ ...rows[0], active_epoch_no: 7, vrf_key_hash: 'cc'.repeat(32), registration_slot: 100 }, ...rows],
      ['pool1updated'], 8, block,
    ).get('pool1updated')).toEqual({ vrfKeyHash: 'cc'.repeat(32), firstRegistrationSlot: 100n });
    expect((global.fetch as jest.Mock).mock.calls.map(([url]) => url.pathname)).not.toContain(
      '/api/v0/blocks/latest',
    );
  });

  it('sends the Blockfrost project id to epoch and pool-history endpoints', async () => {
    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'ogmiosEndpoint') return 'ws://ogmios.local';
      if (key === 'cardanoEpochParamsEndpoint') return 'https://cardano-preprod.blockfrost.io/api/v0';
      if (key === 'cardanoEpochLength') return 432000;
      if (key === 'cardanoPoolRegistrationHistoryEndpoint') return 'https://cardano-preprod.blockfrost.io/api/v0';
      if (key === 'cardanoBlockfrostProjectId') return 'blockfrost-project';
      return undefined;
    });

    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      stakeDistribution: [
        {
          poolId: 'pool1externalpool',
          ...exactStake(900n),
          vrfKeyHash: 'aa'.repeat(32),
        },
      ],
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ epoch: 7, nonce: '11'.repeat(32) }),
    });

    await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
      stakeDistribution: [
        {
          poolId: 'pool1externalpool',
          firstRegistrationSlot: null,
        },
      ],
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.objectContaining({ pathname: '/api/v0/epochs/7/parameters' }),
      expect.objectContaining({
        headers: {
          accept: 'application/json',
          project_id: 'blockfrost-project',
        },
      }),
    );

    (global.fetch as jest.Mock).mockClear().mockImplementation(async (url: URL) =>
      registrationResponse(url, [{
        poolId: 'pool1externalpool', txHash: 'ab'.repeat(32), vrf: 'aa'.repeat(32),
        slot: 200, blockTime: 1000,
      }])
    );
    entityManagerMock.query
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);

    await expect(
      service.findFirstPoolRegistrationSlots(['pool1externalpool'], {
        slotNo: 100n,
        timestampUnixNs: 900_000_000_000n,
      }),
    ).resolves.toEqual(new Map([['pool1externalpool', 200n]]));

    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/api/v0/pools/pool1externalpool/updates' }),
      expect.objectContaining({
        headers: {
          accept: 'application/json',
          project_id: 'blockfrost-project',
        },
      }),
    );
  });

  it('rejects acquired epoch context when Ogmios resolves a different epoch than the block history', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      currentEpoch: 8,
      epochNonce: '22'.repeat(32),
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
      json: async () => ({ epoch: 7, nonce: null }),
    });

    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow(
      'Cardano epoch params lookup did not return a valid nonce for epoch 7',
    );
    expect(queryEpochContextAtPoint).not.toHaveBeenCalled();
  });

  it('caches a validated epoch nonce for the same network and epoch', async () => {
    const fetchEpochNonce = (service as any).fetchEpochNonce.bind(service);

    await expect(fetchEpochNonce(7)).resolves.toBe('11'.repeat(32));
    await expect(fetchEpochNonce(7)).resolves.toBe('11'.repeat(32));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent epoch nonce lookups', async () => {
    let resolveResponse: (response: unknown) => void;
    (global.fetch as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve;
      }),
    );
    const fetchEpochNonce = (service as any).fetchEpochNonce.bind(service);

    const firstLookup = fetchEpochNonce(7);
    const secondLookup = fetchEpochNonce(7);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveResponse!({
      ok: true,
      json: async () => ({ epoch: 7, nonce: '22'.repeat(32) }),
    });

    await expect(Promise.all([firstLookup, secondLookup])).resolves.toEqual(['22'.repeat(32), '22'.repeat(32)]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('backs off according to Retry-After and recovers from a transient 429', async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'retry-after': '1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ epoch: 7, nonce: '33'.repeat(32) }),
      });
    const fetchEpochNonce = (service as any).fetchEpochNonce.bind(service);

    const lookup = fetchEpochNonce(7);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(999);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);

    await expect(lookup).resolves.toBe('33'.repeat(32));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache an invalid epoch params response', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ epoch: 8, nonce: '44'.repeat(32) }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ epoch: 7, nonce: '55'.repeat(32) }),
      });
    const fetchEpochNonce = (service as any).fetchEpochNonce.bind(service);

    await expect(fetchEpochNonce(7)).rejects.toThrow('Cardano epoch params lookup did not return params for epoch 7');
    await expect(fetchEpochNonce(7)).resolves.toBe('55'.repeat(32));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('fails closed when an epoch params lookup times out', async () => {
    jest.useFakeTimers();
    (global.fetch as jest.Mock).mockImplementationOnce(
      (_url: URL, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );
    const fetchEpochNonce = (service as any).fetchEpochNonce.bind(service);

    const lookup = fetchEpochNonce(7);
    const rejection = expect(lookup).rejects.toThrow('Cardano epoch params lookup timed out for epoch 7 after 10000ms');
    await jest.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(queryEpochContextAtPoint).not.toHaveBeenCalled();
  });

  it('falls back to configured epoch length when the next epoch start slot is unavailable', async () => {
    entityManagerMock.query.mockResolvedValueOnce([{ start_slot: '0' }]).mockResolvedValueOnce([{ start_slot: null }]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      epochNonce: '33'.repeat(32),
      stakeDistribution: [
        {
          poolId: 'pool1fallbackpool',
          ...exactStake(1000n),
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
          ...exactStake(1000n),
          vrfKeyHash: 'bb'.repeat(32),
          firstRegistrationSlot: null,
        },
      ],
      verificationContext: {
        epochNonce: '33'.repeat(32),
        slotsPerKesPeriod: 129600,
        ...activeSlotCoefficient,
        maxKesEvolutions: 62,
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
        ...defaultVerificationData,
        epochNonce: '44'.repeat(32),
        stakeDistribution: [
          {
            poolId: 'pool1retrypool',
            ...exactStake(123n),
            vrfKeyHash: 'cc'.repeat(32),
          },
        ],
      });

    await expect(service.findEpochContextAtBlock(block)).resolves.toEqual({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1retrypool',
          ...exactStake(123n),
          vrfKeyHash: 'cc'.repeat(32),
          firstRegistrationSlot: null,
        },
      ],
      verificationContext: {
        epochNonce: '44'.repeat(32),
        slotsPerKesPeriod: 129600,
        ...activeSlotCoefficient,
        maxKesEvolutions: 62,
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
      false,
    );
    expect(queryEpochContextAtPoint).toHaveBeenNthCalledWith(
      2,
      'ws://ogmios.local',
      {
        slot: 1199n,
        hash: 'ef'.repeat(32),
      },
      '11'.repeat(32),
      false,
    );
  });

  it('reconstructs a completed historical epoch when public Ogmios can no longer acquire it', async () => {
    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'ogmiosEndpoint') return 'ws://ogmios.local';
      if (key === 'cardanoNetwork') return 'Preprod';
      if (key === 'cardanoChainId') return 'cardano-preprod';
      if (key === 'cardanoChainNetworkMagic') return 1;
      if (key === 'cardanoEpochParamsEndpoint') return 'https://cardano-preprod.blockfrost.io/api/v0';
      if (key === 'cardanoPoolRegistrationHistoryEndpoint') return 'https://cardano-preprod.blockfrost.io/api/v0';
      if (key === 'cardanoEpochLength') return 432000;
      return undefined;
    });
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
          slot_leader: 'pool1historicalb',
        },
      ])
      .mockResolvedValueOnce([
        {
          block_count: '20',
          pool_ids: ['pool1historicalb', 'pool1historicala'],
        },
      ]);
    (queryEpochContextAtPoint as jest.Mock).mockRejectedValue(
      new Error('Failed to acquire requested point. Target point is too old.'),
    );
    (queryCurrentEpochVerificationData as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      currentEpoch: 9,
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith('/epochs/7/parameters')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, nonce: '11'.repeat(32) }),
        };
      }
      if (url.pathname.endsWith('/epochs/7')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, active_stake: '1000', block_count: 20 }),
        };
      }
      if (url.pathname.endsWith('/history')) {
        const poolId = url.pathname.split('/')[4];
        return {
          ok: true,
          json: async () => [
            {
              epoch: 7,
              active_stake: poolId === 'pool1historicala' ? '600' : '300',
            },
          ],
        };
      }
      const registration = registrationResponse(url, [
        { poolId: 'pool1historicala', txHash: 'ab'.repeat(32), vrf: 'aa'.repeat(32), slot: 1100 },
        { poolId: 'pool1historicalb', txHash: 'cd'.repeat(32), vrf: 'bb'.repeat(32), slot: 1100 },
      ]);
      if (registration) return registration;
      throw new Error(`Unexpected fetch URL ${url.toString()}`);
    });

    await expect(service.findEpochContextAtBlock(block)).resolves.toEqual({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1historicala',
          ...exactStake(600n, 1000n),
          vrfKeyHash: 'aa'.repeat(32),
          firstRegistrationSlot: 1100n,
        },
        {
          poolId: 'pool1historicalb',
          ...exactStake(300n, 1000n),
          vrfKeyHash: 'bb'.repeat(32),
          firstRegistrationSlot: 1100n,
        },
        {
          poolId: '__historical_unproduced_stake__:7',
          ...exactStake(100n, 1000n),
          vrfKeyHash: '00'.repeat(32),
          firstRegistrationSlot: 1n,
        },
      ],
      verificationContext: {
        epochNonce: '11'.repeat(32),
        slotsPerKesPeriod: 129600,
        ...activeSlotCoefficient,
        maxKesEvolutions: 62,
        currentEpochStartSlot: 1000n,
        currentEpochEndSlotExclusive: 1200n,
      },
    });
    expect(queryEpochContextAtPoint).toHaveBeenCalledTimes(2);
    expect(queryCurrentEpochStakeDistribution).not.toHaveBeenCalled();
  });
});

describe('YaciHistoryService stake snapshot source selection', () => {
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

  const configureNetwork = (
    network?: 'Preprod' | 'Preview' | 'Mainnet',
    endpoint: string | null = 'https://cardano-preprod.blockfrost.io/api/v0',
  ) => {
    configServiceMock.get.mockImplementation((key: string) => {
      if (key === 'ogmiosEndpoint') return 'ws://ogmios.local';
      if (key === 'cardanoNetwork') return network;
      if (key === 'cardanoChainId') {
        return `cardano-${network?.toLowerCase() || 'devnet'}`;
      }
      if (key === 'cardanoChainNetworkMagic') {
        return network ? { Preprod: 1, Preview: 2, Mainnet: 764824073 }[network] : 42;
      }
      if (key === 'cardanoEpochParamsEndpoint') {
        return endpoint ?? undefined;
      }
      if (key === 'cardanoPoolRegistrationHistoryEndpoint') {
        return network ? 'https://cardano-preprod.blockfrost.io/api/v0' : undefined;
      }
      if (key === 'cardanoEpochLength') return 432000;
      return undefined;
    });
  };

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ epoch: 7, nonce: '11'.repeat(32) }),
    });
    configServiceMock = { get: jest.fn() };
    configureNetwork();
    entityManagerMock = { query: jest.fn().mockResolvedValue([]) };
    (queryCurrentEpochVerificationData as jest.Mock).mockResolvedValue(defaultVerificationData);
    (queryCurrentEpochStakeDistribution as jest.Mock).mockResolvedValue([]);
    service = new YaciHistoryService(
      configServiceMock as unknown as ConfigService,
      {} as any,
      entityManagerMock as unknown as EntityManager,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT;
    delete process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE;
    delete process.env.CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE;
    delete process.env.CARDANO_EPOCH_NONCE_GENESIS;
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  const liveStakeDistribution = [
    { poolId: 'pool1live', ...exactStake(8n, 100n), vrfKeyHash: 'aa'.repeat(32) },
    { poolId: 'pool1other', ...exactStake(92n, 100n), vrfKeyHash: 'bb'.repeat(32) },
  ];

  it.each([
    ['CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE', false],
    ['CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE', true],
    ['CARDANO_EPOCH_NONCE_GENESIS', false],
    ['CARDANO_EPOCH_NONCE_GENESIS', true],
  ] as const)(
    'rejects Mainnet without a snapshot endpoint with %s and static stake %p',
    async (nonceSetting, staticStake) => {
      configureNetwork('Mainnet', null);
      process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
      process.env[nonceSetting] = '11'.repeat(32);
      if (staticStake) process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';
      entityManagerMock.query
        .mockResolvedValueOnce([{ start_slot: '1000' }])
        .mockResolvedValueOnce([{ start_slot: '1200' }]);
      (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
        ...defaultVerificationData,
        stakeDistribution: liveStakeDistribution,
      });

      await expect(service.findEpochContextAtBlock(block)).rejects.toThrow(
        'CARDANO_BLOCKFROST_ENDPOINT is required for stake-weighted-stability on Mainnet',
      );
      expect(queryEpochContextAtPoint).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['Mainnet', 'Preprod', 'Preview'] as const)(
    'rejects static stake on %s before querying Ogmios',
    async (network) => {
      configureNetwork(network);
      process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';

      await expect(service.findEpochContextAtBlock(block)).rejects.toThrow(
        `CARDANO_STABILITY_ASSUME_STATIC_STAKE must be unset on ${network}`,
      );
      expect(queryEpochContextAtPoint).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['Mainnet', 'Preprod', 'Preview'] as const)(
    'refuses live stake in the snapshot selector when the %s endpoint is missing',
    async (network) => {
      configureNetwork(network, null);

      await expect((service as any).findCurrentEpochStakeSnapshot(block, liveStakeDistribution)).rejects.toThrow(
        `CARDANO_BLOCKFROST_ENDPOINT is required for stake-weighted-stability on ${network}`,
      );
    },
  );

  it.each(['CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE', 'CARDANO_EPOCH_NONCE_GENESIS'])(
    'keeps the local static-stake fallback with %s',
    async (nonceSetting) => {
      configureNetwork(undefined, null);
      process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
      process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';
      process.env[nonceSetting] = '11'.repeat(32);
      entityManagerMock.query
        .mockResolvedValueOnce([{ start_slot: '1000' }])
        .mockResolvedValueOnce([{ start_slot: '1200' }]);
      (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
        ...defaultVerificationData,
        stakeDistribution: liveStakeDistribution,
      });

      await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
        stakeDistribution: liveStakeDistribution.map((entry) => ({ ...entry, firstRegistrationSlot: 1n })),
      });
      expect(queryEpochContextAtPoint).toHaveBeenCalledWith(
        'ws://ogmios.local',
        { slot: block.slotNo, hash: block.hash },
        '11'.repeat(32),
        true,
      );
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it('does not use the local stale-point fallback from a registration-slot assumption alone', async () => {
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValue([]);
    (queryEpochContextAtPoint as jest.Mock).mockRejectedValue(
      new Error('Failed to acquire requested point. Target point is too old.'),
    );

    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow(
      'no historical stake-distribution fallback is configured',
    );
    expect(queryEpochContextAtPoint).toHaveBeenCalledWith(
      'ws://ogmios.local',
      { slot: 1100n, hash: 'ab'.repeat(32) },
      '11'.repeat(32),
      false,
    );
    expect(queryCurrentEpochStakeDistribution).not.toHaveBeenCalled();
  });

  it('uses the local stale-point fallback only with both static-stake and registration-slot assumptions', async () => {
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValue([]);
    (queryEpochContextAtPoint as jest.Mock).mockRejectedValue(
      new Error('Failed to acquire requested point. Target point is too old.'),
    );
    (queryCurrentEpochStakeDistribution as jest.Mock).mockResolvedValue([
      {
        poolId: 'pool1static',
        ...exactStake(1n),
        vrfKeyHash: 'aa'.repeat(32),
      },
    ]);

    await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1static',
          firstRegistrationSlot: 1n,
        },
      ],
    });
    expect(queryCurrentEpochStakeDistribution).toHaveBeenCalledWith('ws://ogmios.local', true);
  });

  it('reconstructs a completed public epoch instead of returning an acquired live distribution', async () => {
    configureNetwork('Preprod');
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce([
        {
          block_count: '20',
          pool_ids: ['pool1historicala'],
        },
      ]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      stakeDistribution: [
        {
          poolId: 'pool1liveonly',
          ...exactStake(9n, 56n),
          vrfKeyHash: 'cc'.repeat(32),
        },
      ],
    });
    (queryCurrentEpochVerificationData as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      currentEpoch: 9,
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith('/epochs/7/parameters')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, nonce: '11'.repeat(32) }),
        };
      }
      if (url.pathname.endsWith('/blocks/latest')) {
        return { ok: true, json: async () => ({ epoch: 9 }) };
      }
      if (url.pathname.endsWith('/epochs/7')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, active_stake: '1000', block_count: 20 }),
        };
      }
      if (url.pathname.endsWith('/history')) {
        return {
          ok: true,
          json: async () => [{ epoch: 7, active_stake: '600' }],
        };
      }
      const registration = registrationResponse(url, [
        { poolId: 'pool1historicala', txHash: 'ab'.repeat(32), vrf: 'aa'.repeat(32), slot: 1100 },
      ]);
      if (registration) return registration;
      throw new Error(`Unexpected fetch URL ${url.toString()}`);
    });

    const context = await service.findEpochContextAtBlock(block);

    expect(context?.stakeDistribution).toEqual([
      {
        poolId: 'pool1historicala',
        ...exactStake(600n, 1000n),
        vrfKeyHash: 'aa'.repeat(32),
        firstRegistrationSlot: 1100n,
      },
      {
        poolId: '__historical_unproduced_stake__:7',
        ...exactStake(400n, 1000n),
        vrfKeyHash: '00'.repeat(32),
        firstRegistrationSlot: 1n,
      },
    ]);
    expect(context?.stakeDistribution).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ poolId: 'pool1liveonly' })]),
    );
    expect(queryEpochContextAtPoint).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the public snapshot source tip is behind the requested block epoch', async () => {
    configureNetwork('Preprod');
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }]);
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      stakeDistribution: [
        {
          poolId: 'pool1liveonly',
          ...exactStake(9n, 56n),
          vrfKeyHash: 'cc'.repeat(32),
        },
      ],
    });
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith('/epochs/7/parameters')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, nonce: '11'.repeat(32) }),
        };
      }
      if (url.pathname.endsWith('/blocks/latest')) {
        return { ok: true, json: async () => ({ epoch: 6 }) };
      }
      throw new Error(`Unexpected fetch URL ${url.toString()}`);
    });

    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow(
      'Blockfrost tip epoch 6 is behind requested block epoch 7; refusing live Ogmios stake fallback',
    );
    expect(entityManagerMock.query).toHaveBeenCalledTimes(2);
  });
});

describe.each(['Preprod', 'Preview', 'Mainnet'])('Current epoch stake snapshots on %s', (network) => {
  let service: YaciHistoryService;
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
    const configServiceMock = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ogmiosEndpoint') return 'ws://ogmios.local';
        if (key === 'cardanoNetwork') return network;
        if (key === 'cardanoEpochParamsEndpoint') {
          return 'https://cardano-preprod.blockfrost.io/api/v0';
        }
        if (key === 'cardanoPoolRegistrationHistoryEndpoint') {
          return 'https://cardano-preprod.blockfrost.io/api/v0';
        }
        if (key === 'cardanoEpochLength') return 432000;
        return undefined;
      }),
    };
    entityManagerMock = {
      query: jest.fn().mockResolvedValue([]),
    };
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      ...defaultVerificationData,
      stakeDistribution: [
        {
          poolId: 'pool1active',
          ...exactStake(50n),
          vrfKeyHash: 'aa'.repeat(32),
        },
      ],
    });
    global.fetch = jest.fn();
    service = new YaciHistoryService(
      configServiceMock as unknown as ConfigService,
      {} as any,
      entityManagerMock as unknown as EntityManager,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('includes a retired producer omitted by the Ogmios live registry', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { pool_id: 'pool1active', first_registration_slot: '41' },
        { pool_id: 'pool1retired', first_registration_slot: '42' },
      ]);
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith('/epochs/7/parameters')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, nonce: '11'.repeat(32) }),
        };
      }
      if (url.pathname.endsWith('/blocks/latest')) {
        return { ok: true, json: async () => ({ epoch: 7 }) };
      }
      if (url.pathname.endsWith('/pools/extended')) {
        return {
          ok: true,
          json: async () => [
            { pool_id: 'pool1active', active_stake: '600' },
            { pool_id: 'pool1retired', active_stake: '400' },
            { pool_id: 'pool1nostake', active_stake: null },
          ],
        };
      }
      if (url.pathname.endsWith('/epochs/7')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, active_stake: '1000' }),
        };
      }
      const registration = registrationResponse(url, [
        { poolId: 'pool1retired', txHash: 'ab'.repeat(32), vrf: 'bb'.repeat(32), slot: 42 },
      ]);
      if (registration) return registration;
      throw new Error(`Unexpected fetch URL ${url.toString()}`);
    });

    await expect(service.findEpochContextAtBlock(block)).resolves.toEqual({
      epoch: 7,
      stakeDistribution: [
        {
          poolId: 'pool1active',
          ...exactStake(600n, 1000n),
          vrfKeyHash: 'aa'.repeat(32),
          firstRegistrationSlot: 41n,
        },
        {
          poolId: 'pool1retired',
          ...exactStake(400n, 1000n),
          vrfKeyHash: 'bb'.repeat(32),
          firstRegistrationSlot: 42n,
        },
      ],
      verificationContext: {
        epochNonce: '11'.repeat(32),
        slotsPerKesPeriod: 129600,
        ...activeSlotCoefficient,
        maxKesEvolutions: 62,
        currentEpochStartSlot: 1000n,
        currentEpochEndSlotExclusive: 1200n,
      },
    });

    const requestedPaths = (global.fetch as jest.Mock).mock.calls.map(([url]) => url.pathname);
    expect(requestedPaths).toEqual(
      expect.arrayContaining(['/api/v0/blocks/latest', '/api/v0/pools/extended', '/api/v0/epochs/7', '/api/v0/pools/pool1retired/updates']),
    );
  });

  it('keeps omitted retired stake in a non-producing remainder', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) => ({
      ok: true,
      json: async () => url.pathname.endsWith('/pools/extended')
        ? [{ pool_id: 'pool1active', active_stake: '600' }]
        : { epoch: 7, active_stake: '1000' },
    }));

    await expect(service['buildCurrentEpochStakeSnapshot'](
      'https://cardano-preprod.blockfrost.io/api/v0',
      block,
      [{ poolId: 'pool1active', ...exactStake(600n, 1000n), vrfKeyHash: 'aa'.repeat(32) }],
    )).resolves.toEqual([
      { poolId: 'pool1active', ...exactStake(600n, 1000n), vrfKeyHash: 'aa'.repeat(32) },
      {
        poolId: '__historical_unproduced_stake__:7',
        ...exactStake(400n, 1000n),
        vrfKeyHash: '00'.repeat(32),
        firstRegistrationSlot: 1n,
      },
    ]);
  });

  it('fails closed when pool stake exceeds total active stake', async () => {
    entityManagerMock.query
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1200' }]);
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) => {
      if (url.pathname.endsWith('/epochs/7/parameters')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, nonce: '11'.repeat(32) }),
        };
      }
      if (url.pathname.endsWith('/blocks/latest')) {
        return { ok: true, json: async () => ({ epoch: 7 }) };
      }
      if (url.pathname.endsWith('/pools/extended')) {
        return {
          ok: true,
          json: async () => [
            {
              pool_id: 'pool1active',
              active_stake: '1200',
            },
          ],
        };
      }
      if (url.pathname.endsWith('/epochs/7')) {
        return {
          ok: true,
          json: async () => ({ epoch: 7, active_stake: '1000' }),
        };
      }
      throw new Error(`Unexpected fetch URL ${url.toString()}`);
    });

    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow(
      'Blockfrost current epoch stake snapshot total 1200 exceeds epoch 7 active stake 1000',
    );
  });
});
