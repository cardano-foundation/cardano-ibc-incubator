import { readFileSync } from 'node:fs';
import {
  EpochContext,
  PoolRegistrationBinding,
  PoolRegistryState,
  PoolProductionHistory,
} from '@cardano-ibc/proto-types/build/ibc/lightclients/probabilistic/v1/probabilistic';
import { productionRecords } from './pool-production';

const MAX_UINT64 = (1n << 64n) - 1n;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a registry object');
  return value as Record<string, unknown>;
};
const integer = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error('Registry integers must be unsigned decimal strings');
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT64) throw new Error('Registry integer exceeds uint64');
  return parsed;
};
const hash = (value: unknown): Uint8Array => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))
    throw new Error('Expected a 32-byte lowercase hex hash');
  return Buffer.from(value, 'hex');
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('Registry snapshots and records must be arrays');
  return value;
};

export type PoolRegistryCheckpointPoint = {
  chainId: string;
  height: bigint;
  slot: bigint;
  hash: string;
  epoch: bigint;
};

// The file is an explicitly trusted checkpoint supplied by the operator.
// Its registry must come from native ledger state and authenticated age history.
// Neither a candidate epoch table nor an elapsed challenge can create it.
export function loadTrustedPoolRegistryCheckpoint(file: string, point: PoolRegistryCheckpointPoint): PoolRegistryState {
  const document = object(JSON.parse(readFileSync(file, 'utf8')));
  if (
    document.version !== 1 ||
    document.chain_id !== point.chainId ||
    integer(document.height) !== point.height ||
    integer(document.slot) !== point.slot ||
    typeof document.block_hash !== 'string' ||
    !Buffer.from(hash(document.block_hash)).equals(Buffer.from(hash(point.hash)))
  )
    throw new Error('Trusted pool registry checkpoint does not match the bootstrap chain point');
  const source = object(document.registry);
  const epoch = integer(source.epoch);
  if (epoch !== point.epoch) throw new Error('Trusted pool registry epoch does not match the bootstrap point');
  const binding = (value: unknown): PoolRegistrationBinding => {
    const record = object(value);
    if (
      typeof record.pool_id !== 'string' ||
      !record.pool_id ||
      record.pool_id !== record.pool_id.trim().toLowerCase()
    ) {
      throw new Error('Registry pool id must be canonical');
    }
    const first = integer(record.first_registration_slot);
    if (first > point.slot) throw new Error('Registry registration age lies after the checkpoint');
    return { pool_id: record.pool_id, vrf_key_hash: hash(record.vrf_key_hash), first_registration_slot: first };
  };
  const known = new Map<string, PoolRegistrationBinding>();
  const pools = array(source.pools).map((value) => {
    const record = object(value);
    const registration = binding(record.registration);
    if (known.has(registration.pool_id)) throw new Error('Duplicate registry pool id');
    known.set(registration.pool_id, registration);
    if (typeof record.registered !== 'boolean') throw new Error('Registry registration status must be explicit');
    const pending = record.pending_vrf_key_hash === '' ? new Uint8Array() : hash(record.pending_vrf_key_hash);
    const activation = integer(record.pending_effective_epoch);
    const retirement = integer(record.retirement_epoch);
    if (pending.length ? !record.registered || epoch === MAX_UINT64 || activation !== epoch + 1n : activation !== 0n) {
      throw new Error('Pending registry VRF change must activate at the next ledger epoch');
    }
    if (retirement !== 0n && (!record.registered || retirement <= epoch))
      throw new Error('Invalid registry retirement epoch');
    return {
      registration,
      registered: record.registered,
      pending_vrf_key_hash: pending,
      pending_effective_epoch: activation,
      retirement_epoch: retirement,
    };
  });
  const snapshot = (value: unknown) => {
    const seen = new Set<string>();
    return array(value).map((value) => {
      const entry = binding(value);
      if (
        seen.has(entry.pool_id) ||
        known.get(entry.pool_id)?.first_registration_slot !== entry.first_registration_slot
      ) {
        throw new Error('Registry snapshot has a duplicate or unknown registration age');
      }
      seen.add(entry.pool_id);
      return entry;
    });
  };
  return { epoch, pools, mark: snapshot(source.mark), effective: snapshot(source.effective) };
}

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

// This shares the explicitly trusted registry file and exact bootstrap chain point.
// It must describe accepted production history, never an epoch-table claim or count.
export function loadTrustedPoolProductionCheckpoint(
  file: string,
  point: PoolRegistryCheckpointPoint,
): PoolProductionHistory {
  const document = object(JSON.parse(readFileSync(file, 'utf8')));
  if (
    document.version !== 1 ||
    document.chain_id !== point.chainId ||
    integer(document.height) !== point.height ||
    integer(document.slot) !== point.slot ||
    !Buffer.from(hash(document.block_hash)).equals(Buffer.from(hash(point.hash)))
  )
    throw new Error('Trusted production checkpoint does not match the bootstrap chain point');
  const source = object(document.production);
  const history: PoolProductionHistory = {
    epoch: integer(source.epoch),
    pools: array(source.pools).map((value) => {
      const record = object(value);
      if (typeof record.pool_id !== 'string' || typeof record.produced_current_epoch !== 'boolean')
        throw new Error('Production identity and current-epoch observation must be explicit');
      return {
        pool_id: record.pool_id,
        completed_epochs_bitmap: Number(integer(record.completed_epochs_bitmap)),
        produced_current_epoch: record.produced_current_epoch,
      };
    }),
  };
  productionRecords(history, point.epoch);
  return history;
}
