import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2b';
import { readLocalEpochStake } from '../services/local-epoch-stake';
import { YaciHistoryService } from '../services/yaci-history.service';
import { bech32 } from 'bech32';

jest.mock('../../shared/helpers/ogmios', () => ({
  queryCurrentEpochVerificationData: jest.fn(async (_endpoint, nonce) => ({ epochNonce: nonce })),
}));

describe('actual local Praos ledger stake snapshots', () => {
  let directory: string;
  let snapshot: any;
  let ledger: any;
  const block = '22'.repeat(32);
  const pool = '33'.repeat(28);
  const vrf = '44'.repeat(32);
  const rawGenesis = Buffer.from(JSON.stringify({ networkMagic: 42, staking: { pools: { [pool]: { vrf } } } }));
  const genesis = Buffer.from(blake2b(rawGenesis, { dkLen: 32 })).toString('hex');
  const query = jest.fn();
  async function publish() {
    const raw = JSON.stringify(ledger);
    snapshot.ledgerSha256 = createHash('sha256').update(raw).digest('hex');
    await writeFile(join(directory, `${snapshot.ledgerSha256}.ledger.json`), raw);
    await mkdir(join(directory, '0'), { recursive: true });
    await writeFile(
      join(directory, '0', `${snapshot.blockHeight.padStart(20, '0')}-${block}.json`),
      JSON.stringify(snapshot),
    );
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'epoch-stake-'));
    await writeFile(join(directory, 'genesis-shelley.json'), rawGenesis);
    ledger = {
      lastEpoch: 0,
      stakeDistrib: {
        pdTotalActiveStake: 300,
        unPoolDistr: {
          [pool]: {
            individualTotalPoolStake: 300,
            individualPoolStakeVrf: vrf,
            individualPoolStake: { numerator: 1, denominator: 1 },
          },
        },
      },
    };
    snapshot = {
      schema: 1,
      networkMagic: 42,
      genesisNonce: genesis,
      epoch: 0,
      blockHash: block,
      blockHeight: '7',
      slot: '21',
      totalActiveStake: '300',
      pools: [{ poolId: pool, vrfKeyHash: vrf, stake: '300' }],
    };
    query.mockReset().mockResolvedValue([{ hash: block }]);
    await publish();
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const load = () => readLocalEpochStake(directory, 0, genesis, { query } as never);
  it('reads actual epoch fractions and rechecks canonical evidence on every read', async () => {
    expect((await load())[0]).toMatchObject({
      stake: 300n,
      relativeStakeNumerator: 300n,
      relativeStakeDenominator: 300n,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('epoch = $3 AND hash = $4'), ['7', '21', 0, block]);
    query.mockResolvedValue([]);
    await expect(load()).rejects.toThrow('not canonical');
  });
  it.each(['genesisNonce', 'blockHash', 'networkMagic', 'epoch'])('rejects invalid identity %s', async (field) => {
    snapshot[field] = 'incorrect';
    await publish();
    await expect(load()).rejects.toThrow('identity mismatch');
  });
  it('does not substitute another epoch when an archive is missing', async () => {
    await expect(readLocalEpochStake(directory, 1, genesis, { query } as never)).rejects.toThrow('ENOENT');
  });
  it('retains an older canonical capture after the newest capture rolls back across the epoch boundary', async () => {
    snapshot.blockHeight = '9';
    snapshot.blockHash = '77'.repeat(32);
    snapshot.slot = '25';
    await publish();
    query.mockImplementation(async (_sql: string, parameters: string[]) =>
      parameters[3] === block ? [{ hash: block }] : [],
    );
    expect((await load())[0].stake).toBe(300n);
    // If both captures disappear, fail closed rather than using another epoch.
    query.mockResolvedValue([]);
    await expect(load()).rejects.toThrow('not canonical');
  });
  it('rejects raw ledger mutation', async () => {
    await writeFile(join(directory, `${snapshot.ledgerSha256}.ledger.json`), '{}');
    await expect(load()).rejects.toThrow('raw ledger hash mismatch');
  });
  it('rejects an omitted pool even if a forged total matches the remaining list', async () => {
    ledger.stakeDistrib.unPoolDistr['55'.repeat(28)] = ledger.stakeDistrib.unPoolDistr[pool];
    await publish();
    await expect(load()).rejects.toThrow('Incomplete');
  });
  it('rejects duplicated pools', async () => {
    snapshot.pools.push(snapshot.pools[0]);
    await publish();
    await expect(load()).rejects.toThrow('Invalid or inconsistent');
  });
  it('rejects live-stake fractions that disagree with the actual active stake', async () => {
    ledger.stakeDistrib.unPoolDistr[pool].individualPoolStake.denominator = 2;
    await publish();
    await expect(load()).rejects.toThrow('Invalid or inconsistent');
  });
  it('rejects redirected VRF identity', async () => {
    snapshot.pools[0].vrfKeyHash = '66'.repeat(32);
    await publish();
    await expect(load()).rejects.toThrow('Invalid or inconsistent');
  });
  it('never assigns genesis registration to a pool with an unrecognized VRF', async () => {
    snapshot.pools[0].vrfKeyHash = '66'.repeat(32);
    ledger.stakeDistrib.unPoolDistr[pool].individualPoolStakeVrf = snapshot.pools[0].vrfKeyHash;
    await publish();
    await expect(load()).rejects.toThrow('non-genesis pool or changed VRF');
  });
  it('authenticates the pool-registration genesis against the configured chain hash', async () => {
    await writeFile(join(directory, 'genesis-shelley.json'), '{}');
    await expect(load()).rejects.toThrow('genesis hash mismatch');
  });
  it('integrates canonical stake using the same pool identifiers as block producers and refuses public networks', async () => {
    const environment = {
      CARDANO_LOCAL_EPOCH_SNAPSHOT_DIR: directory,
      CARDANO_EPOCH_NONCE_GENESIS: genesis,
      CARDANO_NETWORK_MAGIC: '42',
      CARDANO_CHAIN_NETWORK_MAGIC: '42',
      CARDANO_CHAIN_ID: 'cardano-devnet',
    };
    const prior = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
    Object.assign(process.env, environment);
    try {
      const config: Record<string, unknown> = {
        cardanoNetwork: 'Custom',
        cardanoChainId: 'cardano-devnet',
        cardanoChainNetworkMagic: 42,
        ogmiosEndpoint: 'http://local',
        cardanoEpochParamsEndpoint: 'http://local',
      };
      const service = new YaciHistoryService(
        { get: (key: string) => config[key] } as never,
        {} as never,
        { query } as never,
      );
      jest
        .spyOn(service as any, 'findEpochSlotBounds')
        .mockResolvedValue({ currentEpochStartSlot: 0n, currentEpochEndSlotExclusive: 5000n });
      jest.spyOn(service as any, 'fetchEpochNonce').mockResolvedValue(genesis);
      jest.spyOn(service as any, 'findKnownPoolRegistrationSlots').mockResolvedValue(new Map());
      const result = await service.findEpochContextAtBlock({ epochNo: 0 } as never);
      expect(result?.stakeDistribution[0].poolId).toBe(bech32.encode('pool', bech32.toWords(Buffer.from(pool, 'hex'))));
      config.cardanoNetwork = 'Mainnet';
      await expect(service.findEpochContextAtBlock({ epochNo: 0 } as never)).rejects.toThrow('explicit magic-42');
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      jest.restoreAllMocks();
    }
  });
});
