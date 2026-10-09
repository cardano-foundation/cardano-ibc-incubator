import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EpochContext } from '@cardano-ibc/proto-types/build/ibc/lightclients/probabilistic/v1/probabilistic';
import { loadTrustedPoolRegistryCheckpoint, withAuthenticatedPoolBindings } from './pool-registry-checkpoint';

describe('trusted pool registration checkpoint', () => {
  let directory: string;
  const point = { chainId: 'cardano-test', height: 12n, slot: 123n, epoch: 7n, hash: '01'.repeat(32) };
  const binding = { pool_id: 'pool-a', vrf_key_hash: '02'.repeat(32), first_registration_slot: '0' };
  const manifest = () => ({
    version: 1,
    chain_id: point.chainId,
    height: '12',
    slot: '123',
    block_hash: point.hash,
    registry: {
      epoch: '7',
      pools: [
        {
          registration: binding,
          registered: true,
          pending_vrf_key_hash: '03'.repeat(32),
          pending_effective_epoch: '8',
          retirement_epoch: '10',
        },
      ],
      mark: [binding],
      effective: [binding],
    },
  });
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pool-registry-'));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  const load = (document: unknown, override = point) => {
    const file = join(directory, 'checkpoint.json');
    writeFileSync(file, JSON.stringify(document));
    return loadTrustedPoolRegistryCheckpoint(file, override);
  };
  it('retains current, pending and frozen bindings independently of supplied stake', () => {
    const registry = load(manifest());
    expect(registry.pools[0].pending_effective_epoch).toBe(8n);
    expect(registry.pools[0].retirement_epoch).toBe(10n);
    const candidate = EpochContext.fromPartial({
      epoch: 7n,
      stake_distribution: [
        { pool_id: 'pool-a', stake: 123n, vrf_key_hash: Buffer.alloc(32, 9), first_registration_slot: 111n },
      ],
    });
    const result = withAuthenticatedPoolBindings(candidate, registry);
    expect(result.stake_distribution[0].vrf_key_hash).toEqual(Buffer.alloc(32, 2));
    expect(result.stake_distribution[0].first_registration_slot).toBe(0n);
    expect(result.stake_distribution[0].stake).toBe(123n);
    candidate.stake_distribution[0].pool_id = 'invented-pool';
    expect(() => withAuthenticatedPoolBindings(candidate, registry)).toThrow('no authenticated');
  });
  it('requires the exact chain, block, slot and epoch', () => {
    for (const change of [
      { chainId: 'other' },
      { height: 13n },
      { slot: 124n },
      { epoch: 8n },
      { hash: '04'.repeat(32) },
    ]) {
      expect(() => load(manifest(), { ...point, ...change })).toThrow(/does not match/);
    }
  });
  it('rejects absent history, duplicate pools and incorrectly timed pending keys', () => {
    const absent = manifest();
    absent.registry.pools = [];
    expect(() => load(absent)).toThrow('unknown registration age');
    const duplicate = manifest();
    duplicate.registry.pools.push(duplicate.registry.pools[0]);
    expect(() => load(duplicate)).toThrow('Duplicate');
    const pending = manifest();
    pending.registry.pools[0].pending_effective_epoch = '9';
    expect(() => load(pending)).toThrow('next ledger epoch');
    const future = manifest();
    future.registry.pools[0].registration = { ...binding, first_registration_slot: '124' };
    expect(() => load(future)).toThrow('after the checkpoint');
    expect(() => loadTrustedPoolRegistryCheckpoint(join(directory, 'missing.json'), point)).toThrow();
  });
});
