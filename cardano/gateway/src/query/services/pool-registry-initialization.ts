import {
  PoolRegistryState,
  PoolRegistrationBinding,
} from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';

export type InitialPoolEvent = {
  pool: string;
  slot: bigint;
  epoch: bigint;
  order: number;
  vrf?: Uint8Array;
  retirement?: bigint;
};

// Initialization trusts the configured node and history provider. Afterwards
// the client derives these transitions from authenticated block bodies.
export function initialPoolRegistry(
  epoch: bigint,
  genesis: PoolRegistrationBinding[],
  events: InitialPoolEvent[],
): PoolRegistryState {
  const state: PoolRegistryState = {
    epoch: 0n,
    pools: genesis.map((registration) => ({
      registration: { ...registration },
      registered: true,
      pending_vrf_key_hash: new Uint8Array(),
      pending_effective_epoch: 0n,
      retirement_epoch: 0n,
    })),
    mark: genesis.map((r) => ({ ...r })),
    effective: genesis.map((r) => ({ ...r })),
  };
  const records = new Map(state.pools.map((r) => [r.registration!.pool_id, r]));
  const tick = (target: bigint) => {
    if (target < state.epoch) throw new Error('Pool initialization history moves backwards');
    while (state.epoch < target) {
      const next = state.epoch + 1n;
      state.effective = state.mark.map((r) => ({ ...r }));
      state.mark = state.pools.filter((r) => r.registered).map((r) => ({ ...r.registration! }));
      for (const record of state.pools) {
        if (record.pending_effective_epoch === next) {
          record.registration!.vrf_key_hash = record.pending_vrf_key_hash;
          record.pending_vrf_key_hash = new Uint8Array();
          record.pending_effective_epoch = 0n;
        }
        if (record.retirement_epoch === next) {
          record.registered = false;
          record.retirement_epoch = 0n;
        }
      }
      state.epoch = next;
    }
  };
  const ordered = [...events].sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.order - b.order));
  for (const event of ordered) {
    if (event.epoch > epoch) throw new Error('Pool initialization contains future history');
    tick(event.epoch);
    let record = records.get(event.pool);
    if (event.retirement !== undefined) {
      if (!record?.registered || event.retirement <= state.epoch)
        throw new Error('Pool retirement has no initial registration');
      record.retirement_epoch = event.retirement;
    } else {
      if (event.vrf?.length !== 32) throw new Error('Pool registration has no VRF binding');
      if (!record) {
        record = {
          registration: { pool_id: event.pool, vrf_key_hash: event.vrf, first_registration_slot: event.slot },
          registered: false,
          pending_vrf_key_hash: new Uint8Array(),
          pending_effective_epoch: 0n,
          retirement_epoch: 0n,
        };
        records.set(event.pool, record);
        state.pools.push(record);
      }
      if (record.registered) {
        record.pending_vrf_key_hash = event.vrf;
        record.pending_effective_epoch = state.epoch + 1n;
      } else {
        record.registered = true;
        record.registration!.vrf_key_hash = event.vrf;
        record.pending_vrf_key_hash = new Uint8Array();
        record.pending_effective_epoch = 0n;
      }
      record.retirement_epoch = 0n;
    }
  }
  tick(epoch);
  state.pools.sort((a, b) => a.registration!.pool_id.localeCompare(b.registration!.pool_id));
  return state;
}
