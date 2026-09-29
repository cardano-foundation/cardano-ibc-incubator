import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2b';
import type { EntityManager } from 'typeorm';
import type { HistoryStakeDistributionEntry } from './history.service';

/** Explicit devnet adapter for real cardano-cli ledger snapshots. Not a stake
 * assumption: retain the raw ledger, validate its arithmetic, and reject a
 * capture whose chain point has rolled back. Missing epochs never use live stake.
 * Like the existing Koios adapter, this trusts the configured node/data source.
 */
export async function readLocalEpochStake(
  directory: string,
  epoch: number,
  genesisNonce: string,
  manager: Pick<EntityManager, 'query'>,
): Promise<HistoryStakeDistributionEntry[]> {
  if (!Number.isSafeInteger(epoch) || epoch < 0 || !/^[0-9a-f]{64}$/.test(genesisNonce)) {
    throw new Error('Invalid local epoch/genesis identity');
  }
  const rawGenesis = await readFile(join(directory, 'genesis-shelley.json'));
  if (Buffer.from(blake2b(rawGenesis, { dkLen: 32 })).toString('hex') !== genesisNonce) {
    throw new Error('Local stake archive genesis hash mismatch');
  }
  const genesis = JSON.parse(rawGenesis.toString());
  if (genesis.networkMagic !== 42 || !genesis.staking?.pools) throw new Error('Invalid local staking genesis');
  const archive = join(directory, `${epoch}`);
  const files = (await readdir(archive)).filter((file) => /^[0-9]{20}-[0-9a-f]{64}\.json$/.test(file)).sort();
  if (files.length > 10_000) throw new Error('Local epoch snapshot archive exceeds the supported capture limit');
  for (const file of files) {
    const snapshot = JSON.parse(await readFile(join(archive, file), 'utf8'));
    const entries = await readCapture(directory, epoch, genesisNonce, manager, snapshot);
    if (entries?.some((pool) => genesis.staking.pools[pool.poolId]?.vrf !== pool.vrfKeyHash)) {
      throw new Error(
        'Local stake archive contains a non-genesis pool or changed VRF; dynamic pool registration is unsupported in this rehearsal',
      );
    }
    if (entries) return entries;
  }
  throw new Error(
    `Local stake snapshot for epoch ${epoch} is not canonical/indexed; recapture from the node or restore historical evidence`,
  );
}

async function readCapture(
  directory: string,
  epoch: number,
  genesisNonce: string,
  manager: Pick<EntityManager, 'query'>,
  snapshot: any,
): Promise<HistoryStakeDistributionEntry[] | null> {
  const integer = (value: unknown): bigint => {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
      throw new Error('Invalid local stake snapshot integer');
    }
    return BigInt(value);
  };
  if (
    snapshot.schema !== 1 ||
    snapshot.networkMagic !== 42 ||
    snapshot.epoch !== epoch ||
    snapshot.genesisNonce !== genesisNonce ||
    !/^[0-9a-f]{64}$/.test(snapshot.blockHash) ||
    !/^[0-9a-f]{64}$/.test(snapshot.ledgerSha256) ||
    !Array.isArray(snapshot.pools)
  ) {
    throw new Error('Local stake snapshot identity mismatch');
  }
  const raw = await readFile(join(directory, `${snapshot.ledgerSha256}.ledger.json`));
  if (createHash('sha256').update(raw).digest('hex') !== snapshot.ledgerSha256) {
    throw new Error('Local stake snapshot raw ledger hash mismatch');
  }
  const ledger = JSON.parse(raw.toString());
  const total = integer(snapshot.totalActiveStake);
  if (
    ledger.lastEpoch !== epoch ||
    !Number.isSafeInteger(ledger.stakeDistrib?.pdTotalActiveStake) ||
    BigInt(ledger.stakeDistrib.pdTotalActiveStake) !== total ||
    total <= 0n
  ) {
    throw new Error('Local stake snapshot total/epoch mismatch');
  }
  const rawPools = ledger.stakeDistrib.unPoolDistr;
  const seen = new Set<string>();
  const entries = snapshot.pools.map((pool: { poolId: string; vrfKeyHash: string; stake: string }) => {
    const original = rawPools[pool.poolId];
    const stake = integer(pool.stake);
    if (
      !/^[0-9a-f]{56}$/.test(pool.poolId) ||
      !/^[0-9a-f]{64}$/.test(pool.vrfKeyHash) ||
      seen.has(pool.poolId) ||
      !original ||
      stake <= 0n ||
      !Number.isSafeInteger(original.individualTotalPoolStake) ||
      BigInt(original.individualTotalPoolStake) !== stake ||
      original.individualPoolStakeVrf !== pool.vrfKeyHash ||
      !Number.isSafeInteger(original.individualPoolStake?.numerator) ||
      !Number.isSafeInteger(original.individualPoolStake?.denominator) ||
      original.individualPoolStake.denominator <= 0 ||
      BigInt(original.individualPoolStake.numerator) * total !==
        BigInt(original.individualPoolStake.denominator) * stake
    ) {
      throw new Error('Invalid or inconsistent local ledger pool');
    }
    seen.add(pool.poolId);
    return {
      poolId: pool.poolId,
      vrfKeyHash: pool.vrfKeyHash,
      stake,
      relativeStakeNumerator: stake,
      relativeStakeDenominator: total,
      // This adapter checks each pool against the exact genesis above. Slot 1
      // conservatively encodes its genesis registration because the supported
      // verifier reserves zero for missing registration evidence.
      firstRegistrationSlot: 1n,
    };
  });
  if (
    seen.size !== Object.keys(rawPools).length ||
    entries.reduce((sum: bigint, pool: { stake: bigint }) => sum + pool.stake, 0n) !== total
  ) {
    throw new Error('Incomplete local ledger pool distribution');
  }
  const rows = await manager.query(
    'SELECT hash FROM block WHERE number = $1 AND slot = $2 AND epoch = $3 AND hash = $4',
    [integer(snapshot.blockHeight).toString(), integer(snapshot.slot).toString(), epoch, snapshot.blockHash],
  );
  if (rows.length !== 1 || rows[0].hash !== snapshot.blockHash) {
    return null;
  }
  return entries;
}
