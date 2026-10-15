import { EpochContext } from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';
import { initialPoolRegistry } from './pool-registry-initialization';
import { withAuthenticatedPoolBindings } from './pool-registry-checkpoint';

const binding = (pool_id: string, byte: number) => ({
  pool_id,
  vrf_key_hash: Buffer.alloc(32, byte),
  first_registration_slot: 0n,
});

it('keeps a zero-stake registered pool independently of the initial election table', () => {
  const registry = initialPoolRegistry(7n, [binding('pool-a', 1), binding('pool-b', 2)], []);
  const epoch = EpochContext.fromPartial({ epoch: 7n, stake_distribution: [{ pool_id: 'pool-a', stake: 100n }] });
  expect(withAuthenticatedPoolBindings(epoch, registry).stake_distribution[0]).toMatchObject(binding('pool-a', 1));
  expect(registry.pools.map((r) => r.registration!.pool_id)).toEqual(['pool-a', 'pool-b']);
  epoch.stake_distribution[0].pool_id = 'invented';
  expect(() => withAuthenticatedPoolBindings(epoch, registry)).toThrow('no authenticated');
});

it('preserves native registration delays and pending key changes at the selected epoch', () => {
  const genesis = [binding('pool-a', 1)];
  const events = [
    { pool: 'pool-a', slot: 100n, epoch: 7n, order: 0, vrf: Buffer.alloc(32, 2) },
    { pool: 'pool-b', slot: 101n, epoch: 7n, order: 0, vrf: Buffer.alloc(32, 3) },
  ];
  const current = initialPoolRegistry(7n, genesis, events);
  expect(current.pools[0]).toMatchObject({ pending_effective_epoch: 8n, pending_vrf_key_hash: Buffer.alloc(32, 2) });
  expect(current.effective).toEqual([binding('pool-a', 1)]);
  const next = initialPoolRegistry(8n, genesis, events);
  expect(next.pools[0].registration!.vrf_key_hash).toEqual(Buffer.alloc(32, 2));
  expect(next.mark.map((r) => r.pool_id)).toEqual(['pool-a', 'pool-b']);
  expect(next.effective).toEqual([binding('pool-a', 1)]);
  const after = initialPoolRegistry(9n, genesis, events);
  expect(after.effective.find((r) => r.pool_id === 'pool-a')!.vrf_key_hash).toEqual(Buffer.alloc(32, 1));
  expect(after.effective.find((r) => r.pool_id === 'pool-b')!.vrf_key_hash).toEqual(Buffer.alloc(32, 3));
  expect(initialPoolRegistry(10n, genesis, events).effective.find((r) => r.pool_id === 'pool-a')!.vrf_key_hash).toEqual(
    Buffer.alloc(32, 2),
  );
});

it('keeps retirement timing and cancels it on re-registration without changing pool age', () => {
  const events = [{ pool: 'pool-a', slot: 100n, epoch: 7n, order: 0, retirement: 8n }];
  const genesis = [binding('pool-a', 1)];
  expect(initialPoolRegistry(8n, genesis, events).pools[0].registered).toBe(false);
  expect(
    initialPoolRegistry(8n, genesis, [
      ...events,
      { pool: 'pool-a', slot: 101n, epoch: 7n, order: 0, vrf: Buffer.alloc(32, 2) },
    ]).pools[0],
  ).toMatchObject({ registered: true, retirement_epoch: 0n, registration: { first_registration_slot: 0n } });
});
