import {
  ClientState,
  PoolProductionHistory,
  PoolProductionRecord,
} from '@cardano-ibc/proto-types/ibc/lightclients/probabilistic/v1/probabilistic';
import type { HistoryBlock } from './history.service';

export function productionRecords(history: PoolProductionHistory, epoch: bigint): Map<string, PoolProductionRecord> {
  if (!history || history.epoch !== epoch)
    throw new Error('Pool production history is unavailable at the checkpoint epoch');
  const records = new Map<string, PoolProductionRecord>();
  for (const record of history.pools) {
    if (!record.pool_id || record.pool_id !== record.pool_id.trim().toLowerCase() || records.has(record.pool_id))
      throw new Error('Invalid or duplicate production pool identity');
    const bitmap = record.completed_epochs_bitmap;
    if (
      !Number.isInteger(bitmap) ||
      bitmap < 0 ||
      bitmap > 31 ||
      (epoch < 5n && BigInt(bitmap) >> epoch !== 0n) ||
      (bitmap === 0 && !record.produced_current_epoch)
    )
      throw new Error('Invalid five-epoch production bitmap');
    records.set(record.pool_id, { ...record });
  }
  return records;
}

// Gateway observations only guide evidence selection. The light client repeats
// this transition from its own history using authenticated bridge blocks and anchors.
export function productionAtAnchor(
  client: ClientState,
  bridge: HistoryBlock[],
  anchor: HistoryBlock,
): PoolProductionHistory {
  const saved = client.latest_checkpoint_pool_production;
  const records = productionRecords(saved!, client.current_epoch);
  let epoch = saved!.epoch;
  for (const block of [...bridge, anchor]) {
    const target = BigInt(block.epochNo);
    if (target < epoch) throw new Error('Production observation moves backwards in epoch');
    const distance = target - epoch;
    if (distance) {
      for (const [pool, record] of records) {
        let bitmap = 0;
        if (distance <= 5n) {
          bitmap = Number((BigInt(record.completed_epochs_bitmap) << distance) & 31n);
          if (record.produced_current_epoch) bitmap |= Number(1n << (distance - 1n));
        }
        record.completed_epochs_bitmap = bitmap;
        record.produced_current_epoch = false;
        if (!bitmap) records.delete(pool);
      }
    }
    epoch = target;
    const pool = block.slotLeader.toLowerCase();
    if (!pool || pool !== pool.trim()) throw new Error('Production observation has no canonical issuer');
    const record = records.get(pool) ?? { pool_id: pool, completed_epochs_bitmap: 0, produced_current_epoch: false };
    record.produced_current_epoch = true;
    records.set(pool, record);
  }
  return { epoch, pools: [...records.values()].sort((a, b) => a.pool_id.localeCompare(b.pool_id)) };
}
