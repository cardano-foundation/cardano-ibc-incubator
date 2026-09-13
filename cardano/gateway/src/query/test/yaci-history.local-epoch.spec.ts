import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { bech32 } from 'bech32';
import {
  queryCurrentEpochStakeDistribution, queryCurrentEpochVerificationData, queryEpochContextAtPoint,
} from '../../shared/helpers/ogmios';
import { YaciHistoryService } from '../services/yaci-history.service';

jest.mock('../../shared/helpers/ogmios', () => ({
  queryCurrentEpochStakeDistribution: jest.fn(),
  queryCurrentEpochVerificationData: jest.fn(),
  queryEpochContextAtPoint: jest.fn(),
}));

describe('Local epoch Set snapshots', () => {
  const poolHex = 'ab'.repeat(28);
  const poolId = bech32.encode('pool', bech32.toWords(Buffer.from(poolHex, 'hex')));
  const pool = { pool_id_hex: poolHex, active_stake: '300000000000', vrf_key_hash: 'bb'.repeat(32) };
  const block = {
    height: 100, hash: 'ab'.repeat(32), prevHash: 'cd'.repeat(32), slotNo: 1100n,
    epochNo: 7, timestampUnixNs: 1_000_000_000n, slotLeader: poolId,
  };
  let service: YaciHistoryService;
  let snapshot: Record<string, unknown>;

  beforeEach(() => {
    snapshot = {
      epoch_no: 7, total_active_stake: '300000000000',
      pools: [{ ...pool }],
    };
    global.fetch = jest.fn().mockImplementation(async (url: URL) => ({
      ok: true,
      json: async () => url.pathname === '/epoch_params'
        ? [{ epoch_no: 7, nonce: '11'.repeat(32) }]
        : snapshot,
    }));
    const configuration: Record<string, unknown> = {
      cardanoNetwork: 'Custom', ogmiosEndpoint: 'ws://ogmios.local',
      cardanoEpochParamsEndpoint: 'http://nonce:8080',
      cardanoLocalEpochContextEndpoint: 'http://nonce:8080', cardanoEpochLength: 600,
    };
    const entityManager = { query: jest.fn()
      .mockResolvedValueOnce([{ start_slot: '1000' }])
      .mockResolvedValueOnce([{ start_slot: '1600' }])
      .mockResolvedValue([]) };
    service = new YaciHistoryService(
      { get: (key: string) => configuration[key] } as ConfigService,
      {} as any, entityManager as unknown as EntityManager,
    );
    (queryEpochContextAtPoint as jest.Mock).mockResolvedValue({
      currentEpoch: 7, epochNonce: '11'.repeat(32), slotsPerKesPeriod: 129600,
      maxKesEvolutions: 62, activeSlotCoefficientNumerator: 1n, activeSlotCoefficientDenominator: 4n,
      stakeDistribution: [{ poolId, stake: 5000n, relativeStakeNumerator: 5000n,
        relativeStakeDenominator: 150008389n, vrfKeyHash: 'aa'.repeat(32) }],
    });
    (queryCurrentEpochVerificationData as jest.Mock).mockImplementation(async (_endpoint, nonce) => ({
      currentEpoch: 9, epochNonce: nonce, slotsPerKesPeriod: 129600, maxKesEvolutions: 62,
      activeSlotCoefficientNumerator: 1n, activeSlotCoefficientDenominator: 4n,
    }));
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE;
    delete process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT;
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('uses exact active Set stake and its frozen VRF rather than current pool parameters', async () => {
    await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
      epoch: 7, stakeDistribution: [{ poolId, stake: 300000000000n,
        relativeStakeNumerator: 300000000000n, relativeStakeDenominator: 300000000000n,
        vrfKeyHash: 'bb'.repeat(32) }],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/epoch_stake', search: '?_epoch_no=7' }), expect.any(Object),
    );
  });

  it.each([
    ['wrong epoch', { epoch_no: 8 }],
    ['zero total', { total_active_stake: '0' }],
    ['numeric total', { total_active_stake: 300000000000 }],
    ['empty pools', { pools: [] }],
    ['wrong total', { total_active_stake: '300000000001' }],
    ['invalid pool id', { pools: [{ ...pool, pool_id_hex: 'pool1invalid' }] }],
    ['zero stake', { pools: [{ ...pool, active_stake: '0' }] }],
    ['fractional stake', { pools: [{ ...pool, active_stake: '0.5' }] }],
    ['duplicate pool', { pools: [
      { ...pool, active_stake: '150000000000' },
      { ...pool, pool_id_hex: poolHex.toUpperCase(), active_stake: '150000000000' },
    ] }],
    ['missing frozen VRF', { pools: [{ ...pool, vrf_key_hash: undefined }] }],
    ['invalid frozen VRF', { pools: [{ ...pool, vrf_key_hash: 'invalid' }] }],
  ])('rejects %s without substituting live stake', async (_name, change) => {
    snapshot = { ...snapshot, ...(change as object) };
    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow();
  });

  it('rejects unavailable snapshots instead of returning live stake', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: URL) => url.pathname === '/epoch_params'
      ? { ok: true, json: async () => [{ epoch_no: 7, nonce: '11'.repeat(32) }] }
      : { ok: false, status: 404 });
    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow('HTTP 404');
  });

  it('serves recorded keys and stake after Ogmios retention with the requested epoch nonce', async () => {
    process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    (queryEpochContextAtPoint as jest.Mock).mockRejectedValue(new Error('Target point is too old'));
    await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
      epoch: 7,
      stakeDistribution: [{ poolId, stake: 300000000000n, vrfKeyHash: 'bb'.repeat(32),
        relativeStakeNumerator: 300000000000n, relativeStakeDenominator: 300000000000n }],
      verificationContext: { epochNonce: '11'.repeat(32), slotsPerKesPeriod: 129600,
        maxKesEvolutions: 62, activeSlotCoefficientNumerator: 1n, activeSlotCoefficientDenominator: 4n,
        currentEpochStartSlot: 1000n, currentEpochEndSlotExclusive: 1600n },
    });
    expect(queryCurrentEpochVerificationData).toHaveBeenCalledWith('ws://ogmios.local', '11'.repeat(32));
    expect(queryCurrentEpochStakeDistribution).not.toHaveBeenCalled();
  });

  it('refuses old records without frozen VRFs even when live keys and static shortcuts exist', async () => {
    process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    (queryEpochContextAtPoint as jest.Mock).mockRejectedValue(new Error('Target point is too old'));
    snapshot.pools = [{ ...pool, vrf_key_hash: undefined }];
    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow('Frozen VRF key is unavailable');
    expect(queryCurrentEpochStakeDistribution).not.toHaveBeenCalled();
  });

  it('does not mask an Ogmios connection error with historical records', async () => {
    (queryEpochContextAtPoint as jest.Mock).mockRejectedValue(new Error('Connection refused'));
    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow('Connection refused');
    expect(queryCurrentEpochVerificationData).not.toHaveBeenCalled();
  });
});
