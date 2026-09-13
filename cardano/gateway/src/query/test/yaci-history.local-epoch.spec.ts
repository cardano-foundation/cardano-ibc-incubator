import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { bech32 } from 'bech32';
import { queryCurrentEpochStakeDistribution, queryEpochContextAtPoint } from '../../shared/helpers/ogmios';
import { YaciHistoryService } from '../services/yaci-history.service';

jest.mock('../../shared/helpers/ogmios', () => ({
  queryCurrentEpochStakeDistribution: jest.fn(),
  queryEpochContextAtPoint: jest.fn(),
}));

describe('Local epoch Set snapshots', () => {
  const poolHex = 'ab'.repeat(28);
  const poolId = bech32.encode('pool', bech32.toWords(Buffer.from(poolHex, 'hex')));
  const block = {
    height: 100, hash: 'ab'.repeat(32), prevHash: 'cd'.repeat(32), slotNo: 1100n,
    epochNo: 7, timestampUnixNs: 1_000_000_000n, slotLeader: poolId,
  };
  let service: YaciHistoryService;
  let snapshot: Record<string, unknown>;

  beforeEach(() => {
    snapshot = {
      epoch_no: 7, total_active_stake: '300000000000',
      pools: [{ pool_id_hex: poolHex, active_stake: '300000000000' }],
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
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE;
    delete process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT;
    Reflect.deleteProperty(globalThis, 'fetch');
  });

  it('uses exact active Set stake and retains the acquired VRF key', async () => {
    await expect(service.findEpochContextAtBlock(block)).resolves.toMatchObject({
      epoch: 7, stakeDistribution: [{ poolId, stake: 300000000000n,
        relativeStakeNumerator: 300000000000n, relativeStakeDenominator: 300000000000n,
        vrfKeyHash: 'aa'.repeat(32) }],
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
    ['invalid pool id', { pools: [{ pool_id_hex: 'pool1invalid', active_stake: '300000000000' }] }],
    ['zero stake', { pools: [{ pool_id_hex: poolHex, active_stake: '0' }] }],
    ['fractional stake', { pools: [{ pool_id_hex: poolHex, active_stake: '0.5' }] }],
    ['duplicate pool', { pools: [
      { pool_id_hex: poolHex, active_stake: '150000000000' },
      { pool_id_hex: poolHex.toUpperCase(), active_stake: '150000000000' },
    ] }],
    ['missing acquired VRF', { pools: [{ pool_id_hex: 'cd'.repeat(28), active_stake: '300000000000' }] }],
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

  it('never substitutes static live stake when the requested point is too old', async () => {
    process.env.CARDANO_STABILITY_ASSUME_STATIC_STAKE = '1';
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    (queryEpochContextAtPoint as jest.Mock).mockRejectedValue(new Error('Target point is too old'));
    await expect(service.findEpochContextAtBlock(block)).rejects.toThrow('local epoch stake VRF keys');
    expect(queryCurrentEpochStakeDistribution).not.toHaveBeenCalled();
  });
});
