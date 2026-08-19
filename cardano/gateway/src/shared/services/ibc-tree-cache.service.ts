import { Injectable, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';

import {
  forgetPreparedIbcTreeTransition,
  getCurrentTree,
  getPreparedIbcTreeTransition,
  IbcTreeLeafChange,
  setCurrentTree,
} from '../helpers/ibc-state-root';
import { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';

export const CURRENT_IBC_TREE_CACHE_ID = 'current';

export function ibcTreeCacheIdForRoot(root: string): string {
  return `root:${root.toLowerCase()}`;
}

export function ibcTreeCacheIdForHeight(height: bigint | number | string): string {
  return `height:${height.toString()}`;
}

type IbcTransitionInclusionHeightResolver = (txHash: string) => Promise<bigint>;
type IbcTreeRecoveryEvidence = {
  /** Inclusion height of the currently observed HostState UTxO. */
  expectedRootInclusionHeight: bigint;
  /** Canonical-history lookup used for every journal edge promoted during replay. */
  resolveTransitionInclusionHeight: IbcTransitionInclusionHeightResolver;
};

// Durable state-changing rows are intentionally not age-pruned automatically:
// a client can submit a Gateway-built transaction elsewhere, and indexer lag
// makes age insufficient evidence that it was never included. The hard bound
// fails new builds safely instead of deleting a potentially canonical edge.
export const MAX_RETAINED_PREPARED_TRANSITIONS = 4096;

type CheckpointRow = {
  root: string;
  block_no: string | number | null;
};

type LeafRow = {
  path: string;
  value: Buffer;
};

type TransitionRow = {
  sequence_no: string | number;
  tx_hash: string;
  old_root: string;
  new_root: string;
  block_no: string | number | null;
  status: 'prepared' | 'confirmed';
  changes: IbcTreeLeafChange[] | string;
  updated_at?: Date | string;
  retention_class?: 'build' | 'reorg';
};

function parseChanges(value: TransitionRow['changes']): IbcTreeLeafChange[] {
  return (typeof value === 'string' ? JSON.parse(value) : value).map((change: IbcTreeLeafChange) => ({
    path: change.path,
    oldValue: change.oldValue ?? null,
    newValue: change.newValue ?? null,
  }));
}

function transitionEdgeKey(transition: TransitionRow): string {
  return [
    transition.old_root.toLowerCase(),
    transition.new_root.toLowerCase(),
    JSON.stringify(parseChanges(transition.changes)),
  ].join('|');
}

function applyChanges(tree: ICS23MerkleTree, changes: IbcTreeLeafChange[], direction: 'forward' | 'reverse'): void {
  for (const change of direction === 'forward' ? changes : [...changes].reverse()) {
    const expected = direction === 'forward' ? change.oldValue : change.newValue;
    const replacement = direction === 'forward' ? change.newValue : change.oldValue;
    const actual = tree.get(change.path)?.toString('hex') ?? null;
    if (actual !== expected) {
      throw new Error(
        `IBC tree journal mismatch at '${change.path}': expected ${expected ?? 'absent'}, got ${actual ?? 'absent'}`,
      );
    }
    tree.set(change.path, replacement === null ? Buffer.alloc(0) : Buffer.from(replacement, 'hex'));
  }
}

/**
 * Durable proof store for the root-authoritative IBC tree.
 *
 * Storage is one normalized current-leaf checkpoint plus append-only deltas.
 * We do not write a full compressed tree for every height/root. Prepared deltas
 * are persisted before an unsigned transaction leaves the Gateway, which lets a
 * restart replay a transaction that reached Cardano before the in-memory commit.
 */
@Injectable()
export class IbcTreeCacheService {
  private readonly logger = new Logger(IbcTreeCacheService.name);
  private operationTail: Promise<void> = Promise.resolve();

  constructor(@InjectEntityManager('gateway') private readonly entityManager: EntityManager) {}

  private async serializeOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async loadCheckpointMetadata(
    manager: EntityManager = this.entityManager,
    forUpdate = false,
  ): Promise<{ root: string; blockNo: bigint | null } | null> {
    const checkpoints: CheckpointRow[] = await manager.query(
      `SELECT root, block_no FROM ibc_state_tree_checkpoint WHERE id = $1 LIMIT 1${forUpdate ? ' FOR UPDATE' : ''};`,
      [CURRENT_IBC_TREE_CACHE_ID],
    );
    if (!checkpoints.length) return null;
    return {
      root: checkpoints[0].root.toLowerCase(),
      blockNo: checkpoints[0].block_no === null ? null : BigInt(checkpoints[0].block_no),
    };
  }

  async ensureSchema(): Promise<void> {
    await this.entityManager.query(`
      CREATE TABLE IF NOT EXISTS ibc_state_tree_checkpoint (
        id TEXT PRIMARY KEY,
        root TEXT NOT NULL,
        block_no NUMERIC NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.entityManager.query(`
      CREATE TABLE IF NOT EXISTS ibc_state_tree_leaves (
        path TEXT PRIMARY KEY,
        value BYTEA NOT NULL
      );
    `);
    await this.entityManager.query(`
      CREATE TABLE IF NOT EXISTS ibc_state_tree_transitions (
        sequence_no BIGSERIAL PRIMARY KEY,
        tx_hash TEXT NOT NULL UNIQUE,
        old_root TEXT NOT NULL,
        new_root TEXT NOT NULL,
        block_no NUMERIC NULL,
        status TEXT NOT NULL CHECK (status IN ('prepared', 'confirmed')),
        changes JSONB NOT NULL,
        retention_class TEXT NOT NULL DEFAULT 'build'
          CHECK (retention_class IN ('build', 'reorg')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        confirmed_at TIMESTAMPTZ NULL
      );
    `);
    await this.entityManager.query(`
      ALTER TABLE ibc_state_tree_transitions
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);
    await this.entityManager.query(`
      ALTER TABLE ibc_state_tree_transitions
      ADD COLUMN IF NOT EXISTS retention_class TEXT NOT NULL DEFAULT 'build';
    `);
    await this.entityManager.query(`
      CREATE INDEX IF NOT EXISTS ibc_state_tree_transitions_new_root_idx
      ON ibc_state_tree_transitions (new_root);
    `);
    await this.entityManager.query(`
      CREATE INDEX IF NOT EXISTS ibc_state_tree_transitions_block_no_idx
      ON ibc_state_tree_transitions (block_no)
      WHERE status = 'confirmed';
    `);
  }

  private async assertPreparedBuildCapacity(
    txHash: string,
    manager: EntityManager = this.entityManager,
  ): Promise<void> {
    const rows: Array<{ count: string | number }> = await manager.query(
      `SELECT COUNT(*) AS count
       FROM ibc_state_tree_transitions
       WHERE status = 'prepared'
         AND retention_class = 'build'
         AND tx_hash <> $1;`,
      [txHash.toLowerCase()],
    );
    const count = Number(rows[0]?.count ?? 0);
    if (!Number.isSafeInteger(count) || count >= MAX_RETAINED_PREPARED_TRANSITIONS) {
      throw new Error(
        `IBC prepared-transition capacity (${MAX_RETAINED_PREPARED_TRANSITIONS}) is exhausted; reconcile inclusion evidence or perform reviewed manual cleanup before retrying`,
      );
    }
  }

  private async loadCheckpoint(
    manager: EntityManager = this.entityManager,
    forUpdate = false,
  ): Promise<{
    tree: ICS23MerkleTree;
    root: string;
    blockNo: bigint | null;
  } | null> {
    const checkpoint = await this.loadCheckpointMetadata(manager, forUpdate);
    if (!checkpoint) return null;

    const leaves: LeafRow[] = await manager.query(`SELECT path, value FROM ibc_state_tree_leaves ORDER BY path ASC;`);
    const tree = new ICS23MerkleTree();
    for (const leaf of leaves) {
      tree.set(leaf.path, Buffer.from(leaf.value));
    }

    const storedRoot = checkpoint.root;
    const computedRoot = tree.getRoot().toLowerCase();
    if (computedRoot !== storedRoot) {
      throw new Error(`IBC proof-store checkpoint mismatch: stored ${storedRoot}, computed ${computedRoot}`);
    }

    return {
      tree,
      root: computedRoot,
      blockNo: checkpoint.blockNo,
    };
  }

  async bootstrapVerifiedTree(tree: ICS23MerkleTree, blockNo?: bigint): Promise<{ root: string }> {
    await this.ensureSchema();
    const root = tree.getRoot().toLowerCase();
    await this.serializeOperation(async () => {
      await this.entityManager.transaction(async (manager) => {
        const existing = await this.loadCheckpoint(manager);
        if (existing) {
          if (existing.root !== root) {
            throw new Error(
              `Refusing to overwrite IBC proof-store checkpoint ${existing.root} with unrelated root ${root}`,
            );
          }
          return;
        }

        for (const [path, value] of Object.entries(tree.toJSON().leaves)) {
          await manager.query(`INSERT INTO ibc_state_tree_leaves (path, value) VALUES ($1, $2);`, [
            path,
            Buffer.from(value, 'hex'),
          ]);
        }
        await manager.query(
          `INSERT INTO ibc_state_tree_checkpoint (id, root, block_no, updated_at)
           VALUES ($1, $2, $3, NOW());`,
          [CURRENT_IBC_TREE_CACHE_ID, root, blockNo?.toString() ?? null],
        );
      });
      setCurrentTree(tree.clone());
    });
    return { root };
  }

  async prepareTransition(txHash: string, expectedNewRoot: string): Promise<void> {
    if (!txHash || !expectedNewRoot) return;
    await this.ensureSchema();

    const prepared = getPreparedIbcTreeTransition(expectedNewRoot);
    const checkpoint = await this.loadCheckpointMetadata();
    let transition = prepared;
    if (!transition && checkpoint && checkpoint.root !== expectedNewRoot.toLowerCase()) {
      // Another concurrent build may already have persisted and then forgotten
      // the same root-keyed in-memory delta. Reuse its root-verified durable edge
      // so duplicate unsigned tx bodies remain independently recoverable.
      const durableMatches: TransitionRow[] = await this.entityManager.query(
        `SELECT sequence_no, tx_hash, old_root, new_root, block_no, status, changes
         FROM ibc_state_tree_transitions
         WHERE status = 'prepared' AND old_root = $1 AND new_root = $2
         ORDER BY sequence_no DESC
         LIMIT 1;`,
        [checkpoint.root, expectedNewRoot.toLowerCase()],
      );
      if (durableMatches.length) {
        transition = {
          oldRoot: durableMatches[0].old_root.toLowerCase(),
          newRoot: durableMatches[0].new_root.toLowerCase(),
          changes: parseChanges(durableMatches[0].changes),
        };
      }
    }
    transition ??=
      checkpoint?.root === expectedNewRoot.toLowerCase()
        ? { oldRoot: checkpoint.root, newRoot: checkpoint.root, changes: [] }
        : undefined;
    if (!transition) {
      throw new Error(`No serializable IBC tree transition was prepared for root ${expectedNewRoot}`);
    }
    if (!checkpoint || checkpoint.root !== transition.oldRoot.toLowerCase()) {
      throw new Error(
        `IBC proof store is stale before tx construction: expected ${transition.oldRoot.toLowerCase()}, got ${checkpoint?.root ?? 'missing'}`,
      );
    }
    if (transition.oldRoot.toLowerCase() === transition.newRoot.toLowerCase()) {
      if (transition.changes.length !== 0) {
        throw new Error('A same-root IBC transition cannot contain leaf mutations');
      }
      forgetPreparedIbcTreeTransition(expectedNewRoot);
      return;
    }
    await this.prepareExternalTransition(txHash, transition);
    // The exact delta is durable now. Keeping another copy in the process-local
    // prepared map until confirmation would leak one entry for every unsigned
    // transaction that a wallet declines to sign.
    forgetPreparedIbcTreeTransition(expectedNewRoot);
  }

  async prepareExternalTransition(
    txHash: string,
    transition: { oldRoot: string; newRoot: string; changes: IbcTreeLeafChange[] },
  ): Promise<void> {
    if (!/^[0-9a-f]{64}$/i.test(txHash)) throw new Error('txHash must be 64 hexadecimal characters');
    if (!/^[0-9a-f]{64}$/i.test(transition.oldRoot) || !/^[0-9a-f]{64}$/i.test(transition.newRoot)) {
      throw new Error('IBC transition roots must be 64 hexadecimal characters');
    }
    for (const change of transition.changes) {
      if (!change.path || typeof change.path !== 'string') throw new Error('IBC transition path must be non-empty');
      if (change.oldValue !== null && !/^(?:[0-9a-f]{2})+$/i.test(change.oldValue)) {
        throw new Error(`IBC transition oldValue for '${change.path}' must be even-length hex or null`);
      }
      if (change.newValue !== null && !/^(?:[0-9a-f]{2})+$/i.test(change.newValue)) {
        throw new Error(`IBC transition newValue for '${change.path}' must be even-length hex or null`);
      }
    }

    await this.ensureSchema();
    const normalized = {
      oldRoot: transition.oldRoot.toLowerCase(),
      newRoot: transition.newRoot.toLowerCase(),
      changes: transition.changes.map((change) => ({
        path: change.path,
        oldValue: change.oldValue?.toLowerCase() ?? null,
        newValue: change.newValue?.toLowerCase() ?? null,
      })),
    };
    if (normalized.oldRoot === normalized.newRoot) {
      if (normalized.changes.length !== 0) {
        throw new Error('A same-root IBC transition cannot contain leaf mutations');
      }
      // Root-preserving HostState transactions do not form a Merkle journal
      // edge. Their inclusion height is recorded when submission confirms, so
      // persisting a self-loop here would only leak rows and complicate replay.
      return;
    }
    await this.serializeOperation(() =>
      this.entityManager.transaction(async (manager) => {
        // Preparing, confirming, and recovering all serialize on the singleton
        // checkpoint so the durable graph and in-memory canonical tip advance in
        // one order.
        const checkpoint = await this.loadCheckpointMetadata(manager, true);
        if (!checkpoint) {
          throw new Error('IBC proof store has no verified checkpoint; refusing to persist a transition');
        }
        if (checkpoint.root !== normalized.oldRoot) {
          throw new Error(
            `IBC proof store is stale before tx construction: expected ${normalized.oldRoot}, got ${checkpoint.root}`,
          );
        }
        const currentTree = getCurrentTree();
        if (currentTree.getRoot().toLowerCase() !== checkpoint.root) {
          throw new Error(`In-memory IBC tree is not aligned with proof-store checkpoint ${checkpoint.root}`);
        }
        const verified = currentTree.clone();
        applyChanges(verified, normalized.changes, 'forward');
        if (verified.getRoot().toLowerCase() !== normalized.newRoot) {
          throw new Error(`Prepared IBC transition does not compute declared root ${normalized.newRoot}`);
        }

        // Age is not proof that a build was never submitted: a client may submit
        // it outside this Gateway while the indexer is lagging. Retain all durable
        // candidates and reject at the hard bound rather than risking loss of the
        // only edge to an authoritative on-chain root.
        await this.assertPreparedBuildCapacity(txHash, manager);
        await manager.query(
          `INSERT INTO ibc_state_tree_transitions
           (tx_hash, old_root, new_root, block_no, status, changes)
         VALUES ($1, $2, $3, NULL, 'prepared', $4::jsonb)
         ON CONFLICT (tx_hash) DO UPDATE SET
           old_root = EXCLUDED.old_root,
           new_root = EXCLUDED.new_root,
           changes = EXCLUDED.changes,
           updated_at = NOW()
        WHERE ibc_state_tree_transitions.status = 'prepared';`,
          [txHash.toLowerCase(), normalized.oldRoot, normalized.newRoot, JSON.stringify(normalized.changes)],
        );
      }),
    );
  }

  async confirmTransition(params: {
    txHash: string;
    newRoot: string;
    blockNo: bigint;
  }): Promise<{ root: string; tree: ICS23MerkleTree }> {
    await this.ensureSchema();
    const newRoot = params.newRoot.toLowerCase();

    return this.serializeOperation(async () => {
      let resolvedCurrentRoot = newRoot;
      let resolvedCurrentTree: ICS23MerkleTree | null = null;
      await this.entityManager.transaction(async (manager) => {
        // Serialize every promotion on the singleton checkpoint row. Locking the
        // transition alone is insufficient because two child txs can otherwise
        // both observe and overwrite the same predecessor.
        const checkpoint = await this.loadCheckpointMetadata(manager, true);
        if (!checkpoint) throw new Error('IBC proof store has no verified checkpoint');
        const liveTree = getCurrentTree();
        if (liveTree.getRoot().toLowerCase() !== checkpoint.root) {
          throw new Error(`In-memory IBC tree is not aligned with locked checkpoint ${checkpoint.root}`);
        }
        if (checkpoint.root === newRoot) {
          const newestBlockNo =
            checkpoint.blockNo === null || params.blockNo > checkpoint.blockNo ? params.blockNo : checkpoint.blockNo;
          await this.writeCurrentState(manager, [], checkpoint.root, newestBlockNo);
          await manager.query(
            `DELETE FROM ibc_state_tree_transitions
           WHERE status = 'prepared'
             AND (tx_hash = $1 OR (old_root = $2 AND new_root = $2));`,
            [params.txHash.toLowerCase(), newRoot],
          );
          resolvedCurrentRoot = checkpoint.root;
          resolvedCurrentTree = liveTree;
          return;
        }

        const rows: TransitionRow[] = await manager.query(
          `SELECT sequence_no, tx_hash, old_root, new_root, block_no, status, changes
         FROM ibc_state_tree_transitions
         WHERE tx_hash = $1 OR new_root = $2
         ORDER BY CASE WHEN tx_hash = $1 THEN 0 ELSE 1 END, sequence_no DESC
         LIMIT 1
         FOR UPDATE;`,
          [params.txHash.toLowerCase(), newRoot],
        );
        if (!rows.length) {
          throw new Error(`No durable prepared IBC transition found for confirmed root ${newRoot}`);
        }
        const transition = rows[0];
        if (transition.status === 'confirmed') {
          const canonicalAncestor = await this.isCanonicalAncestor(manager, checkpoint.root, newRoot);
          if (!canonicalAncestor) {
            throw new Error(`Previously confirmed root ${newRoot} is not an ancestor of checkpoint ${checkpoint.root}`);
          }
          // Late duplicate submission/finalization: the current checkpoint has
          // already advanced beyond this tx. Never move it backwards.
          resolvedCurrentRoot = checkpoint.root;
          resolvedCurrentTree = liveTree;
          return;
        }
        if (transition.old_root.toLowerCase() !== checkpoint.root || transition.new_root.toLowerCase() !== newRoot) {
          throw new Error(
            `Confirmed IBC transition is not chained to checkpoint: ${transition.old_root} -> ${transition.new_root}, checkpoint=${checkpoint.root}`,
        );
        }

        const changes = parseChanges(transition.changes);
        const promotedTree = liveTree.clone();
        applyChanges(promotedTree, changes, 'forward');
        if (promotedTree.getRoot().toLowerCase() !== newRoot) {
          throw new Error(`Confirmed IBC transition failed root verification for ${newRoot}`);
        }
        await this.writeCurrentState(manager, changes, newRoot, params.blockNo);
        const promoted: Array<{ sequence_no: string | number }> = await manager.query(
          `UPDATE ibc_state_tree_transitions
         SET status = 'confirmed', block_no = $2,
             updated_at = NOW(), confirmed_at = NOW()
         WHERE sequence_no = $1 AND status = 'prepared'
         RETURNING sequence_no;`,
          [transition.sequence_no, params.blockNo.toString()],
        );
        if (!promoted.length) {
          throw new Error(`Confirmed IBC transition ${transition.sequence_no} was no longer prepared`);
        }
        resolvedCurrentRoot = newRoot;
        resolvedCurrentTree = promotedTree;
      });

      forgetPreparedIbcTreeTransition(newRoot);
      if (!resolvedCurrentTree) throw new Error('IBC confirmation did not resolve a verified current tree');
      setCurrentTree(resolvedCurrentTree);
      return { root: resolvedCurrentRoot, tree: resolvedCurrentTree };
    });
  }

  private async isCanonicalAncestor(manager: EntityManager, currentRoot: string, targetRoot: string): Promise<boolean> {
    const target = targetRoot.toLowerCase();
    let root = currentRoot.toLowerCase();
    if (root === target) return true;

    const canonicalHistory: TransitionRow[] = await manager.query(
      `SELECT sequence_no, tx_hash, old_root, new_root, block_no, status, changes
       FROM ibc_state_tree_transitions
       WHERE status = 'confirmed'
       ORDER BY sequence_no DESC;`,
    );
    for (const transition of canonicalHistory) {
      if (transition.old_root.toLowerCase() === transition.new_root.toLowerCase()) continue;
      if (root !== transition.new_root.toLowerCase()) {
        throw new Error(`IBC canonical-history root mismatch at transition ${transition.sequence_no}`);
      }
      root = transition.old_root.toLowerCase();
      if (root === target) return true;
    }
    return false;
  }

  private async writeCurrentState(
    manager: EntityManager,
    changes: IbcTreeLeafChange[],
    root: string,
    blockNo: bigint | null,
  ): Promise<void> {
    for (const change of changes) {
      if (change.newValue === null) {
        await manager.query(`DELETE FROM ibc_state_tree_leaves WHERE path = $1;`, [change.path]);
      } else {
        await manager.query(
          `INSERT INTO ibc_state_tree_leaves (path, value) VALUES ($1, $2)
           ON CONFLICT (path) DO UPDATE SET value = EXCLUDED.value;`,
          [change.path, Buffer.from(change.newValue, 'hex')],
        );
      }
    }
    await manager.query(
      `UPDATE ibc_state_tree_checkpoint
       SET root = $2, block_no = $3, updated_at = NOW()
       WHERE id = $1;`,
      [CURRENT_IBC_TREE_CACHE_ID, root, blockNo?.toString() ?? null],
    );
  }

  /** Replay durable prepared/confirmed deltas until the exact on-chain root is reached. */
  async recoverToRoot(
    expectedRoot: string,
    evidence: IbcTreeRecoveryEvidence,
  ): Promise<{ tree: ICS23MerkleTree; root: string }> {
    await this.ensureSchema();
    const expected = expectedRoot.toLowerCase();
    const expectedRootInclusionHeight = BigInt(evidence.expectedRootInclusionHeight);
    if (expectedRootInclusionHeight < 0n) {
      throw new Error('Expected HostState root inclusion height must be non-negative');
    }
    return this.serializeOperation(async () => {
      const recovered = await this.entityManager.transaction(async (manager) => {
        // Recovery is rare and may hydrate all leaves once, but it holds the same
        // checkpoint lock as prepare/confirm/GC for its entire plan. Thus no stale
        // candidate can be deleted after it was selected but before promotion.
        const checkpoint = await this.loadCheckpoint(manager, true);
        if (!checkpoint) throw new Error('IBC proof store has no verified checkpoint');
        if (checkpoint.root === expected) {
          return { tree: checkpoint.tree, root: expected };
        }

        const rows: TransitionRow[] = await manager.query(
          `SELECT sequence_no, tx_hash, old_root, new_root, block_no, status, changes
         FROM ibc_state_tree_transitions
         ORDER BY sequence_no ASC
         FOR UPDATE;`,
        );

        type RecoveryEdge = { transition: TransitionRow; alternatives: TransitionRow[] };
        type RecoveryStep = { transition: TransitionRow; inclusionHeight: bigint };
        const edgeByKey = new Map<string, RecoveryEdge>();
        const edgesByOldRoot = new Map<string, RecoveryEdge[]>();
        for (const row of rows) {
          // Legacy root-preserving rows are metadata-only and must never become
          // graph self-loops.
          if (row.old_root.toLowerCase() === row.new_root.toLowerCase()) continue;
          const edgeKey = transitionEdgeKey(row);
          const existing = edgeByKey.get(edgeKey);
          if (existing) {
            existing.alternatives.push(row);
            continue;
          }
          const edge = { transition: row, alternatives: [row] };
          edgeByKey.set(edgeKey, edge);
          const oldRoot = row.old_root.toLowerCase();
          edgesByOldRoot.set(oldRoot, [...(edgesByOldRoot.get(oldRoot) ?? []), edge]);
        }

        // Reconstruct roots on the current canonical chain. Storing only a depth
        // avoids the former O(history^2) copies of the growing reverse-row prefix.
        const confirmedRowsDescending = rows
          .filter((row) => row.status === 'confirmed' && row.old_root.toLowerCase() !== row.new_root.toLowerCase())
          .sort((left, right) =>
            BigInt(left.sequence_no) === BigInt(right.sequence_no)
              ? 0
              : BigInt(left.sequence_no) > BigInt(right.sequence_no)
                ? -1
                : 1,
          );
        const canonicalBlockByRoot = new Map<string, bigint>();
        for (const transition of confirmedRowsDescending) {
          if (transition.block_no !== null && !canonicalBlockByRoot.has(transition.new_root.toLowerCase())) {
            canonicalBlockByRoot.set(transition.new_root.toLowerCase(), BigInt(transition.block_no));
          }
        }
        const canonicalProbe = checkpoint.tree.clone();
        const canonicalAncestors: Array<{ root: string; reverseDepth: number; minimumHeight: bigint }> = [
          {
            root: checkpoint.root,
            reverseDepth: 0,
            // Checkpoint height can come from a later root-preserving heartbeat.
            // The lower bound for a child is the state-changing tx that actually
            // established this root, otherwise a rollback of that heartbeat could
            // incorrectly reject a canonical child at an earlier height.
            minimumHeight: canonicalBlockByRoot.get(checkpoint.root) ?? 0n,
          },
        ];
        for (const [index, transition] of confirmedRowsDescending.entries()) {
          if (canonicalProbe.getRoot().toLowerCase() !== transition.new_root.toLowerCase()) {
            throw new Error(`IBC canonical journal root mismatch at transition ${transition.sequence_no}`);
          }
          applyChanges(canonicalProbe, parseChanges(transition.changes), 'reverse');
          if (canonicalProbe.getRoot().toLowerCase() !== transition.old_root.toLowerCase()) {
            throw new Error(`IBC canonical journal reverse replay failed at transition ${transition.sequence_no}`);
          }
          const ancestorRoot = transition.old_root.toLowerCase();
          canonicalAncestors.push({
            root: ancestorRoot,
            reverseDepth: index + 1,
            minimumHeight: canonicalBlockByRoot.get(ancestorRoot) ?? 0n,
          });
        }

        const inclusionHeightByTx = new Map<string, bigint | null>();
        const resolveIncludedHeight = async (transition: TransitionRow): Promise<bigint | null> => {
          const txHash = transition.tx_hash.toLowerCase();
          if (inclusionHeightByTx.has(txHash)) return inclusionHeightByTx.get(txHash)!;
          try {
            const height = BigInt(await evidence.resolveTransitionInclusionHeight(txHash));
            const included = height >= 0n && height <= expectedRootInclusionHeight ? height : null;
            inclusionHeightByTx.set(txHash, included);
            return included;
          } catch {
            inclusionHeightByTx.set(txHash, null);
        return null;
      }
        };

        // Inclusion evidence is part of path search, not a check performed after
        // choosing the first structurally valid path. This permits recovery when
        // an abandoned batched edge and an included sequential path reach the same
        // target, and backtracks across both distinct edges and duplicate txs.
        const findIncludedPath = async (
          root: string,
          minimumHeight: bigint,
          visited = new Set<string>(),
        ): Promise<RecoveryStep[] | null> => {
          if (root === expected) return [];
          if (visited.has(root)) return null;
          const nextVisited = new Set(visited).add(root);

          for (const edge of edgesByOldRoot.get(root) ?? []) {
            const alternatives: RecoveryStep[] = [];
            for (const candidate of edge.alternatives) {
              const inclusionHeight = await resolveIncludedHeight(candidate);
              if (inclusionHeight !== null && inclusionHeight >= minimumHeight) {
                alternatives.push({ transition: candidate, inclusionHeight });
              }
            }
            alternatives.sort((left, right) => {
              if (left.inclusionHeight !== right.inclusionHeight) {
                return left.inclusionHeight < right.inclusionHeight ? -1 : 1;
              }
              const leftSequence = BigInt(left.transition.sequence_no);
              const rightSequence = BigInt(right.transition.sequence_no);
              return leftSequence === rightSequence ? 0 : leftSequence > rightSequence ? -1 : 1;
            });
            for (const selected of alternatives) {
              const tail = await findIncludedPath(
                selected.transition.new_root.toLowerCase(),
                selected.inclusionHeight,
                nextVisited,
              );
              if (tail) return [selected, ...tail];
            }
          }
      return null;
        };

        let switchPlan: { commonRoot: string; reverseRows: TransitionRow[]; forwardSteps: RecoveryStep[] } | null =
          null;
        for (const ancestor of canonicalAncestors) {
          const forwardSteps = await findIncludedPath(ancestor.root, ancestor.minimumHeight);
          if (forwardSteps) {
            switchPlan = {
              commonRoot: ancestor.root,
              reverseRows: confirmedRowsDescending.slice(0, ancestor.reverseDepth),
              forwardSteps,
            };
            break;
          }
    }
        if (!switchPlan) {
          throw new Error(
            `No canonically included IBC journal branch reaches on-chain root ${expected} from checkpoint ${checkpoint.root}`,
          );
  }

        const verifiedTree = checkpoint.tree.clone();
        for (const transition of switchPlan.reverseRows) {
          if (verifiedTree.getRoot().toLowerCase() !== transition.new_root.toLowerCase()) {
            throw new Error(`IBC branch switch new-root mismatch at transition ${transition.sequence_no}`);
          }
          applyChanges(verifiedTree, parseChanges(transition.changes), 'reverse');
          if (verifiedTree.getRoot().toLowerCase() !== transition.old_root.toLowerCase()) {
            throw new Error(`IBC branch switch reverse replay failed at transition ${transition.sequence_no}`);
          }
        }
        if (verifiedTree.getRoot().toLowerCase() !== switchPlan.commonRoot) {
          throw new Error(`IBC branch switch did not reach common ancestor ${switchPlan.commonRoot}`);
        }
        for (const { transition } of switchPlan.forwardSteps) {
          if (verifiedTree.getRoot().toLowerCase() !== transition.old_root.toLowerCase()) {
            throw new Error(`IBC recovery journal old-root mismatch at transition ${transition.sequence_no}`);
          }
          applyChanges(verifiedTree, parseChanges(transition.changes), 'forward');
          if (verifiedTree.getRoot().toLowerCase() !== transition.new_root.toLowerCase()) {
            throw new Error(`IBC recovery journal new-root mismatch at transition ${transition.sequence_no}`);
          }
        }
        if (verifiedTree.getRoot().toLowerCase() !== expected) {
          throw new Error('IBC recovery ended at the wrong root');
        }

        // Apply the already-verified switch atomically. A row update must return
        // its identity; silently losing a selected edge would make the checkpoint
        // unrecoverable even though the leaf table happened to reach the root.
        const promotionTree = checkpoint.tree.clone();
        for (const transition of switchPlan.reverseRows) {
          const changes = parseChanges(transition.changes);
          applyChanges(promotionTree, changes, 'reverse');
          await this.writeCurrentState(
            manager,
            changes.map((change) => ({
              path: change.path,
              oldValue: change.newValue,
              newValue: change.oldValue,
            })),
            transition.old_root.toLowerCase(),
            canonicalBlockByRoot.get(transition.old_root.toLowerCase()) ?? null,
    );
          const demoted: Array<{ sequence_no: string | number }> = await manager.query(
            `UPDATE ibc_state_tree_transitions
           SET status = 'prepared', block_no = NULL,
               retention_class = 'reorg', updated_at = NOW(),
               confirmed_at = NULL
           WHERE sequence_no = $1 AND status = 'confirmed'
           RETURNING sequence_no;`,
            [transition.sequence_no],
          );
          if (!demoted.length) {
            throw new Error(`IBC recovery could not demote canonical transition ${transition.sequence_no}`);
          }
        }
        for (const { transition, inclusionHeight } of switchPlan.forwardSteps) {
          const changes = parseChanges(transition.changes);
          applyChanges(promotionTree, changes, 'forward');
          await this.writeCurrentState(manager, changes, transition.new_root.toLowerCase(), inclusionHeight);
          const promoted: Array<{ sequence_no: string | number }> = await manager.query(
            `UPDATE ibc_state_tree_transitions
           SET status = 'confirmed', block_no = $2,
               updated_at = NOW(),
               confirmed_at = COALESCE(confirmed_at, NOW())
           WHERE sequence_no = $1 AND status = 'prepared'
           RETURNING sequence_no;`,
            [transition.sequence_no, inclusionHeight.toString()],
          );
          if (!promoted.length) {
            throw new Error(`IBC recovery could not promote transition ${transition.sequence_no}`);
          }
        }
        if (promotionTree.getRoot().toLowerCase() !== expected) {
          throw new Error(`IBC recovery transaction ended at ${promotionTree.getRoot()} instead of ${expected}`);
        }
        // The latest HostState UTxO may preserve this root through a later no-op
        // heartbeat, so checkpoint height is sourced from the observed UTxO while
        // each state-changing transition retains its own actual inclusion height.
        await this.writeCurrentState(manager, [], expected, expectedRootInclusionHeight);

        return { tree: promotionTree, root: expected };
      });
      setCurrentTree(recovered.tree);
      return recovered;
    });
  }

  async load(id: string = CURRENT_IBC_TREE_CACHE_ID): Promise<{ tree: ICS23MerkleTree; root: string } | null> {
    await this.ensureSchema();
    return this.serializeOperation(async () => {
      const loaded = await this.entityManager.transaction(async (manager) => {
        // A single locked transaction prevents a concurrent writer from exposing
        // old checkpoint metadata with new leaves (or the inverse) to queries and
        // recovery API responses.
        const checkpoint = await this.loadCheckpoint(manager, true);
        if (!checkpoint) return null;
        if (id === CURRENT_IBC_TREE_CACHE_ID) return { tree: checkpoint.tree, root: checkpoint.root };

        let targetRoot: string | undefined;
        if (id.startsWith('root:')) {
          targetRoot = id.slice('root:'.length).toLowerCase();
          if (targetRoot === checkpoint.root) return { tree: checkpoint.tree, root: checkpoint.root };
        } else if (id.startsWith('height:')) {
          const height = BigInt(id.slice('height:'.length));
          const rows: TransitionRow[] = await manager.query(
            `SELECT sequence_no, tx_hash, old_root, new_root, block_no, status, changes
             FROM ibc_state_tree_transitions
             WHERE status = 'confirmed' AND block_no <= $1
             ORDER BY block_no DESC, sequence_no DESC LIMIT 1;`,
            [height.toString()],
          );
          if (!rows.length) return null;
          targetRoot = rows[0].new_root.toLowerCase();
        } else {
          return null;
  }

        const canonicalHistory: TransitionRow[] = await manager.query(
          `SELECT sequence_no, tx_hash, old_root, new_root, block_no, status, changes
           FROM ibc_state_tree_transitions
           WHERE status = 'confirmed'
           ORDER BY sequence_no DESC;`,
        );
        const historicalTree = checkpoint.tree.clone();
        for (const transition of canonicalHistory) {
          if (historicalTree.getRoot().toLowerCase() === targetRoot) {
            return { tree: historicalTree, root: targetRoot };
    }
          if (historicalTree.getRoot().toLowerCase() !== transition.new_root.toLowerCase()) {
            throw new Error(`IBC historical replay root mismatch at transition ${transition.sequence_no}`);
          }
          applyChanges(historicalTree, parseChanges(transition.changes), 'reverse');
          if (historicalTree.getRoot().toLowerCase() !== transition.old_root.toLowerCase()) {
            throw new Error(`IBC historical reverse replay failed at transition ${transition.sequence_no}`);
          }
        }
        // This also recognizes the original bootstrap checkpoint, which appears as
        // the old_root of the first confirmed transition rather than any new_root.
        if (historicalTree.getRoot().toLowerCase() === targetRoot) {
          return { tree: historicalTree, root: targetRoot };
        }
        return null;
      });
      if (loaded && id === CURRENT_IBC_TREE_CACHE_ID) setCurrentTree(loaded.tree);
      return loaded;
    });
  }
}
