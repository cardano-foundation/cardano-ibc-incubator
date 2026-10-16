import { EpochContext, PoolRegistryState } from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';

export function withAuthenticatedPoolBindings(context: EpochContext, registry: PoolRegistryState): EpochContext {
  if (context.epoch !== registry.epoch) throw new Error('Pool registry is unavailable for the bootstrap epoch');
  const bindings = new Map(registry.effective.map((entry) => [entry.pool_id, entry]));
  return {
    ...context,
    stake_distribution: context.stake_distribution.map((entry) => {
      const binding = bindings.get(entry.pool_id);
      if (!binding) throw new Error(`Pool ${entry.pool_id} has no authenticated effective registration`);
      return { ...entry, vrf_key_hash: binding.vrf_key_hash, first_registration_slot: binding.first_registration_slot };
    }),
  };
}
