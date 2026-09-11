import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { YaciHistoryService } from '../services/yaci-history.service';

const genesisNonce = '11'.repeat(32);
const epochNonce = '22'.repeat(32);
const environmentKeys = [
  'CARDANO_CHAIN_ID',
  'CARDANO_NETWORK_MAGIC',
  'CARDANO_CHAIN_NETWORK_MAGIC',
  'CARDANO_EPOCH_NONCE_GENESIS',
  'CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE',
  'CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT',
];

describe('Yaci local epoch nonces', () => {
  const previousEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  let service: YaciHistoryService;
  let query: jest.Mock;
  let configuration: Record<string, unknown>;

  const row = (epoch = 1, nonce = epochNonce) => ({
    epoch,
    nonce,
    block_hash: '33'.repeat(32),
    block_epoch: epoch,
    genesis_nonce: genesisNonce,
    genesis_block_hash: '44'.repeat(32),
    genesis_block_epoch: 0,
    canonical_epoch_count: (BigInt(epoch) + 1n).toString(),
  });

  beforeEach(() => {
    process.env.CARDANO_CHAIN_ID = 'cardano-devnet';
    process.env.CARDANO_NETWORK_MAGIC = '42';
    process.env.CARDANO_CHAIN_NETWORK_MAGIC = '42';
    process.env.CARDANO_EPOCH_NONCE_GENESIS = genesisNonce;
    process.env.CARDANO_PROBABILISTIC_EPOCH_NONCE_OVERRIDE = 'ff'.repeat(32);
    process.env.CARDANO_STABILITY_ASSUME_POOL_REGISTRATION_SLOT = '1';
    configuration = {
      cardanoChainId: 'cardano-devnet',
      cardanoChainNetworkMagic: 42,
      cardanoNetwork: 'Custom',
    };
    query = jest.fn().mockResolvedValue([row()]);
    service = new YaciHistoryService(
      { get: (key: string) => configuration[key] } as ConfigService,
      {} as never,
      { query } as unknown as EntityManager,
    );
  });

  afterEach(() => {
    for (const [key, value] of previousEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.restoreAllMocks();
  });

  it('uses the requested replayed epoch and ignores the unscoped override', async () => {
    await expect(service['fetchEpochNonce'](1)).resolves.toBe(epochNonce);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE n.epoch = $1'), [1]);
  });

  it('uses the genuine genesis nonce only for unindexed epoch zero', async () => {
    query.mockResolvedValue([]);
    await expect(service['fetchEpochNonce'](0)).resolves.toBe(genesisNonce);
    await expect(service['fetchEpochNonce'](1)).rejects.toThrow('replay Yaci from genesis');
  });

  it('validates the replayed epoch-zero value against the configured actual genesis', async () => {
    query.mockResolvedValue([row(0, genesisNonce)]);
    await expect(service['fetchEpochNonce'](0)).resolves.toBe(genesisNonce);
    query.mockResolvedValue([row(0, epochNonce)]);
    await expect(service['fetchEpochNonce'](0)).rejects.toThrow('invalid or belongs to another genesis');
  });

  it.each([
    ['nonce', 'not-hex'],
    ['epoch', 2],
    ['block_epoch', 2],
    ['block_hash', null],
    ['genesis_nonce', '55'.repeat(32)],
    ['genesis_block_hash', null],
    ['genesis_block_epoch', 1],
  ])('rejects invalid or rolled-back %s evidence', async (field, value) => {
    query.mockResolvedValue([{ ...row(), [field as string]: value }]);
    await expect(service['fetchEpochNonce'](1)).rejects.toThrow('invalid or belongs to another genesis');
  });

  it('rejects duplicate evidence', async () => {
    query.mockResolvedValue([row(), row()]);
    await expect(service['fetchEpochNonce'](1)).rejects.toThrow('invalid or belongs to another genesis');
  });

  it('rejects a later nonce when a middle epoch is missing despite valid requested and genesis rows', async () => {
    query.mockResolvedValue([{ ...row(3), canonical_epoch_count: '3' }]);
    await expect(service['fetchEpochNonce'](3)).rejects.toThrow('incomplete or non-canonical');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('COUNT(DISTINCT history.epoch)::text'), [3]);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('history_block.number = history.block');
    expect(sql).toContain('history_block.slot = history.slot');
    expect(sql).toContain('history_block.epoch = history.epoch');
    expect(sql).toContain('history.epoch BETWEEN 0 AND $1');
    expect(sql).toContain("history.nonce ~* '^[0-9a-f]{64}$'");
    expect(sql).toContain("history_block.hash ~* '^[0-9a-f]{64}$'");
  });

  it.each([undefined, null, '', 'x', '-1', '2.0', ' 2 ', '02', '0', '1', '3', 2, 2n])(
    'rejects invalid or inconsistent canonical count %s',
    async (canonicalEpochCount) => {
      query.mockResolvedValue([{ ...row(), canonical_epoch_count: canonicalEpochCount }]);
      await expect(service['fetchEpochNonce'](1)).rejects.toThrow('incomplete or non-canonical');
    },
  );

  it('compares epoch plus one exactly beyond the safe integer boundary', async () => {
    const epoch = Number.MAX_SAFE_INTEGER;
    query.mockResolvedValue([row(epoch)]);
    await expect(service['fetchEpochNonce'](epoch)).resolves.toBe(epochNonce);
    query.mockResolvedValue([{ ...row(epoch), canonical_epoch_count: '9007199254740993' }]);
    await expect(service['fetchEpochNonce'](epoch)).rejects.toThrow('incomplete or non-canonical');
  });

  it('does not cache continuity across a rollback that removes an intermediate epoch', async () => {
    query.mockResolvedValue([row(3)]);
    await expect(service['fetchEpochNonce'](3)).resolves.toBe(epochNonce);
    query.mockResolvedValue([{ ...row(3), canonical_epoch_count: '3' }]);
    await expect(service['fetchEpochNonce'](3)).rejects.toThrow('incomplete or non-canonical');
  });

  it('does not retain stale epoch cache values across rollback and replay', async () => {
    await expect(service['fetchEpochNonce'](1)).resolves.toBe(epochNonce);
    query.mockResolvedValue([]);
    await expect(service['fetchEpochNonce'](1)).rejects.toThrow('not indexed');
    query.mockResolvedValue([row(1, '66'.repeat(32))]);
    await expect(service['fetchEpochNonce'](1)).resolves.toBe('66'.repeat(32));
  });

  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid requested epoch %s', async (epoch) => {
    await expect(service['fetchEpochNonce'](epoch)).rejects.toThrow('non-negative safe integer');
    expect(query).not.toHaveBeenCalled();
  });

  it('requires an actual configured genesis nonce', async () => {
    delete process.env.CARDANO_EPOCH_NONCE_GENESIS;
    await expect(service['fetchEpochNonce'](1)).rejects.toThrow('actual node genesis hash');
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ['CARDANO_CHAIN_ID', 'cardano-devnet '],
    ['CARDANO_NETWORK_MAGIC', '1'],
    ['CARDANO_CHAIN_NETWORK_MAGIC', '2'],
    ['CARDANO_NETWORK_MAGIC', undefined],
  ])('does not select local replay on ambiguous identity %s=%s', async (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    await expect(service['fetchEpochNonce'](1)).resolves.toBe('ff'.repeat(32));
    expect(query).not.toHaveBeenCalled();
  });

  it('does not select local replay when resolved configuration disagrees', async () => {
    configuration.cardanoNetwork = 'Mainnet';
    await expect(service['fetchEpochNonce'](1)).resolves.toBe('ff'.repeat(32));
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps the configured public Koios path unchanged', async () => {
    configuration.cardanoEpochParamsEndpoint = 'https://preprod.koios.rest/api/v1';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{ epoch_no: 1, nonce: '77'.repeat(32) }],
    } as Response);
    await expect(service['fetchEpochNonce'](1)).resolves.toBe('77'.repeat(32));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});
