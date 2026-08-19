import { EntityManager } from 'typeorm';

import { ICS23MerkleTree } from '../helpers/ics23-merkle-tree';
import {
  ibcTreeCacheIdForHeight,
  ibcTreeCacheIdForRoot,
  IbcTreeCacheService,
  MAX_RETAINED_PREPARED_TRANSITIONS,
} from './ibc-tree-cache.service';

type StoredTransition = {
  sequence_no: string;
  tx_hash: string;
  old_root: string;
  new_root: string;
  block_no: string | null;
  status: 'prepared' | 'confirmed';
  changes: string;
  updated_at: string;
  retention_class: 'build' | 'reorg';
};

class MemoryEntityManager {
  checkpoint: { root: string; block_no: string | null } | null = null;
  leaves = new Map<string, Buffer>();
  transitions: StoredTransition[] = [];

  async transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    return run(this as unknown as EntityManager);
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    const statement = sql.replace(/\s+/g, ' ').trim();
    if (
      statement.startsWith('CREATE TABLE') ||
      statement.startsWith('CREATE INDEX') ||
      statement.startsWith('ALTER TABLE')
    ) return [];

    if (statement.startsWith('SELECT root, block_no FROM ibc_state_tree_checkpoint')) {
      return this.checkpoint ? [{ ...this.checkpoint }] : [];
    }
    if (statement.startsWith('SELECT path, value FROM ibc_state_tree_leaves')) {
      return [...this.leaves.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, value]) => ({ path, value: Buffer.from(value) }));
    }
    if (statement.startsWith('INSERT INTO ibc_state_tree_leaves')) {
      this.leaves.set(params[0], Buffer.from(params[1]));
      return [];
    }
    if (statement.startsWith('DELETE FROM ibc_state_tree_leaves')) {
      this.leaves.delete(params[0]);
      return [];
    }
    if (statement.startsWith('DELETE FROM ibc_state_tree_transitions')) {
      if (statement.includes("updated_at < NOW()")) {
        const retentionClass = statement.includes("retention_class = 'build'") ? 'build' : 'reorg';
        const unitMs = statement.includes("INTERVAL '1 minute'") ? 60 * 1000 : 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - Number(params[0]) * unitMs;
        this.transitions = this.transitions.filter(
          (row) =>
            row.status !== 'prepared' ||
            row.retention_class !== retentionClass ||
            new Date(row.updated_at).getTime() >= cutoff,
        );
        return [];
      }
      this.transitions = this.transitions.filter(
        (row) =>
          !(
            row.status === 'prepared' &&
            (row.tx_hash === params[0] || (row.old_root === params[1] && row.new_root === params[1]))
          ),
      );
      return [];
    }
    if (statement.startsWith('INSERT INTO ibc_state_tree_checkpoint')) {
      this.checkpoint = { root: params[1], block_no: params[2] };
      return [];
    }
    if (statement.startsWith('UPDATE ibc_state_tree_checkpoint')) {
      this.checkpoint = { root: params[1], block_no: params[2] };
      return [];
    }
    if (statement.startsWith('INSERT INTO ibc_state_tree_transitions')) {
      const existing = this.transitions.find((row) => row.tx_hash === params[0]);
      if (existing?.status === 'prepared') {
        Object.assign(existing, { old_root: params[1], new_root: params[2], changes: params[3] });
      } else if (!existing) {
        const nextSequence = this.transitions.reduce(
          (highest, row) => (BigInt(row.sequence_no) > highest ? BigInt(row.sequence_no) : highest),
          0n,
        ) + 1n;
        this.transitions.push({
          sequence_no: nextSequence.toString(),
          tx_hash: params[0],
          old_root: params[1],
          new_root: params[2],
          block_no: null,
          status: 'prepared',
          changes: params[3],
          updated_at: new Date().toISOString(),
          retention_class: 'build',
        });
      }
      return [];
    }
    if (statement.startsWith('SELECT COUNT(*) AS count FROM ibc_state_tree_transitions')) {
      return [{
        count: this.transitions.filter(
          (row) =>
            row.status === 'prepared' &&
            row.retention_class === 'build' &&
            row.tx_hash !== params[0],
        ).length,
      }];
    }
    if (statement.includes("WHERE status = 'prepared' AND old_root = $1 AND new_root = $2")) {
      return this.transitions
        .filter(
          (row) => row.status === 'prepared' && row.old_root === params[0] && row.new_root === params[1],
        )
        .sort((left, right) => Number(right.sequence_no) - Number(left.sequence_no))
        .slice(0, 1)
        .map((row) => ({ ...row }));
    }
    if (statement.includes('WHERE tx_hash = $1 OR new_root = $2')) {
      return this.transitions
        .filter((row) => row.tx_hash === params[0] || row.new_root === params[1])
        .sort((left, right) => {
          const leftExact = left.tx_hash === params[0] ? 0 : 1;
          const rightExact = right.tx_hash === params[0] ? 0 : 1;
          return leftExact - rightExact || Number(right.sequence_no) - Number(left.sequence_no);
        })
        .slice(0, 1)
        .map((row) => ({ ...row }));
    }
    if (statement.includes("WHERE status = 'confirmed' AND new_root = $1")) {
      return this.transitions
        .filter((row) => row.status === 'confirmed' && row.new_root === params[0])
        .sort((left, right) => Number(right.sequence_no) - Number(left.sequence_no))
        .slice(0, 1)
        .map((row) => ({ ...row }));
    }
    if (statement.includes("WHERE status = 'confirmed' AND block_no <= $1")) {
      return this.transitions
        .filter((row) => row.status === 'confirmed' && row.block_no !== null && BigInt(row.block_no) <= BigInt(params[0]))
        .sort((left, right) => Number(BigInt(right.block_no!)) - Number(BigInt(left.block_no!)))
        .slice(0, 1)
        .map((row) => ({ ...row }));
    }
    if (statement.startsWith('SELECT sequence_no, tx_hash') && statement.includes("WHERE status = 'confirmed'")) {
      return this.transitions
        .filter((row) => row.status === 'confirmed')
        .sort((left, right) => Number(right.sequence_no) - Number(left.sequence_no))
        .map((row) => ({ ...row }));
    }
    if (statement.startsWith('SELECT sequence_no, tx_hash')) {
      return this.transitions
        .slice()
        .sort((left, right) => Number(left.sequence_no) - Number(right.sequence_no))
        .map((row) => ({ ...row }));
    }
    if (statement.startsWith("UPDATE ibc_state_tree_transitions SET status = 'confirmed'")) {
      const row = this.transitions.find((candidate) => candidate.sequence_no === String(params[0]));
      const canUpdate = !statement.includes("status = 'prepared'") || row?.status === 'prepared';
      if (row && canUpdate) {
        row.status = 'confirmed';
        if (params.length > 1) row.block_no = String(params[1]);
        row.updated_at = new Date().toISOString();
      }
      return row && canUpdate ? [{ sequence_no: row.sequence_no }] : [];
    }
    if (statement.startsWith("UPDATE ibc_state_tree_transitions SET status = 'prepared'")) {
      const row = this.transitions.find((candidate) => candidate.sequence_no === String(params[0]));
      const canUpdate = row?.status === 'confirmed';
      if (row && canUpdate) {
        row.status = 'prepared';
        row.block_no = null;
        row.updated_at = new Date().toISOString();
        row.retention_class = 'reorg';
      }
      return row && canUpdate ? [{ sequence_no: row.sequence_no }] : [];
    }

    throw new Error(`Unhandled test SQL: ${statement}`);
  }
}

function transitionFrom(tree: ICS23MerkleTree, path: string, value: string) {
  const updated = tree.clone();
  updated.set(path, Buffer.from(value, 'hex'));
  return {
    tree: updated,
    transition: {
      oldRoot: tree.getRoot(),
      newRoot: updated.getRoot(),
      changes: updated.getChanges(),
    },
  };
}

describe('IbcTreeCacheService durable recovery', () => {
  it('replays a prepared transition after restart and verifies the requested root', async () => {
    const manager = new MemoryEntityManager();
    const initial = new ICS23MerkleTree();
    initial.set('channelEnds/ports/transfer/channels/channel-0', Buffer.from('01', 'hex'));
    const firstProcess = new IbcTreeCacheService(manager as unknown as EntityManager);
    await firstProcess.bootstrapVerifiedTree(initial, 10n);

    const prepared = transitionFrom(
      initial,
      'commitments/ports/transfer/channels/channel-0/sequences/1',
      '42',
    );
    await firstProcess.prepareExternalTransition('aa'.repeat(32), prepared.transition);

    const restarted = new IbcTreeCacheService(manager as unknown as EntityManager);
    const resolveHeight = jest.fn(async () => 11n);
    const recovered = await restarted.recoverToRoot(prepared.transition.newRoot, {
      expectedRootInclusionHeight: 11n,
      resolveTransitionInclusionHeight: resolveHeight,
    });

    expect(recovered.root).toBe(prepared.transition.newRoot);
    expect(recovered.tree.get('commitments/ports/transfer/channels/channel-0/sequences/1')).toEqual(
      Buffer.from('42', 'hex'),
    );
    expect(manager.transitions[0].status).toBe('confirmed');
    expect(manager.transitions[0].block_no).toBe('11');
    expect(resolveHeight).toHaveBeenCalledWith('aa'.repeat(32));
    await expect(restarted.load(ibcTreeCacheIdForHeight(11n))).resolves.toMatchObject({
      root: prepared.transition.newRoot,
    });
  });

  it('fails closed when a journal mutation does not compute its declared root', async () => {
    const manager = new MemoryEntityManager();
    const initial = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(initial);
    const prepared = transitionFrom(initial, 'receipts/ports/transfer/channels/channel-0/sequences/1', '40');

    await expect(
      service.prepareExternalTransition('bb'.repeat(32), {
        ...prepared.transition,
        newRoot: 'cc'.repeat(32),
      }),
    ).rejects.toThrow('does not compute declared root');
  });

  it('persists duplicate builds after the shared in-memory delta has already been forgotten', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base);
    const next = transitionFrom(base, 'commitments/ports/transfer/channels/channel-0/sequences/2', '22');

    await service.prepareExternalTransition('d1'.repeat(32), next.transition);
    await service.prepareTransition('d2'.repeat(32), next.transition.newRoot);

    expect(manager.transitions).toHaveLength(2);
    expect(manager.transitions.map(({ tx_hash }) => tx_hash)).toEqual(['d1'.repeat(32), 'd2'.repeat(32)]);
  });

  it('rolls back to the bootstrap root, excludes the reverted branch, and accepts a new fork', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base, 1n);

    const branchOne = transitionFrom(base, 'commitments/ports/transfer/channels/channel-0/sequences/1', '11');
    await service.prepareExternalTransition('11'.repeat(32), branchOne.transition);
    await service.confirmTransition({ txHash: '11'.repeat(32), newRoot: branchOne.transition.newRoot, blockNo: 2n });
    const branchTwo = transitionFrom(branchOne.tree, 'commitments/ports/transfer/channels/channel-0/sequences/2', '22');
    await service.prepareExternalTransition('22'.repeat(32), branchTwo.transition);
    await service.confirmTransition({ txHash: '22'.repeat(32), newRoot: branchTwo.transition.newRoot, blockNo: 3n });

    const lateFirstConfirmation = await service.confirmTransition({
      txHash: '11'.repeat(32),
      newRoot: branchOne.transition.newRoot,
      blockNo: 2n,
    });
    expect(lateFirstConfirmation.root).toBe(branchTwo.transition.newRoot);
    expect(manager.checkpoint?.root).toBe(branchTwo.transition.newRoot);

    const rolledBack = await service.recoverToRoot(base.getRoot(), {
      expectedRootInclusionHeight: 1n,
      resolveTransitionInclusionHeight: async () => {
        throw new Error('rollback must not resolve forward-transition heights');
      },
    });
    expect(rolledBack.root).toBe(base.getRoot());
    expect(manager.transitions.map(({ status }) => status)).toEqual(['prepared', 'prepared']);

    const newFork = transitionFrom(base, 'acks/ports/transfer/channels/channel-0/sequences/9', '99');
    await service.prepareExternalTransition('33'.repeat(32), newFork.transition);
    await service.confirmTransition({ txHash: '33'.repeat(32), newRoot: newFork.transition.newRoot, blockNo: 4n });

    await expect(service.load(ibcTreeCacheIdForRoot(newFork.transition.newRoot))).resolves.toMatchObject({
      root: newFork.transition.newRoot,
    });
    await expect(service.load(ibcTreeCacheIdForRoot(branchTwo.transition.newRoot))).resolves.toBeNull();
    await expect(service.load(ibcTreeCacheIdForRoot(base.getRoot()))).resolves.toMatchObject({ root: base.getRoot() });
  });

  it('does not persist same-root self loops and cleans up legacy prepared no-op rows on confirmation', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base, 5n);

    await service.prepareExternalTransition('44'.repeat(32), {
      oldRoot: base.getRoot(),
      newRoot: base.getRoot(),
      changes: [],
    });
    expect(manager.transitions).toHaveLength(0);

    manager.transitions.push({
      sequence_no: '1',
      tx_hash: '44'.repeat(32),
      old_root: base.getRoot(),
      new_root: base.getRoot(),
      block_no: null,
      status: 'prepared',
      changes: '[]',
      updated_at: new Date().toISOString(),
      retention_class: 'build',
    });
    await service.confirmTransition({ txHash: '44'.repeat(32), newRoot: base.getRoot(), blockNo: 8n });

    expect(manager.transitions).toHaveLength(0);
    expect(manager.checkpoint?.block_no).toBe('8');
  });

  it('ignores a legacy self-loop while replaying the linear path to a new root', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base);
    manager.transitions.push({
      sequence_no: '1',
      tx_hash: '55'.repeat(32),
      old_root: base.getRoot(),
      new_root: base.getRoot(),
      block_no: null,
      status: 'prepared',
      changes: '[]',
      updated_at: new Date().toISOString(),
      retention_class: 'build',
    });
    const next = transitionFrom(base, 'commitments/ports/transfer/channels/channel-0/sequences/7', '77');
    await service.prepareExternalTransition('66'.repeat(32), next.transition);

    const recovered = await service.recoverToRoot(next.transition.newRoot, {
      expectedRootInclusionHeight: 12n,
      resolveTransitionInclusionHeight: async (txHash) => {
        expect(txHash).toBe('66'.repeat(32));
        return 12n;
      },
    });

    expect(recovered.root).toBe(next.transition.newRoot);
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === '55'.repeat(32))?.status).toBe('prepared');
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === '66'.repeat(32))).toMatchObject({
      status: 'confirmed',
      block_no: '12',
    });
  });

  it('atomically switches from a confirmed sibling fork back to a retained prepared branch', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base, 1n);

    const branchA = transitionFrom(base, 'commitments/ports/transfer/channels/channel-0/sequences/1', 'aa');
    await service.prepareExternalTransition('a1'.repeat(32), branchA.transition);
    await service.confirmTransition({ txHash: 'a1'.repeat(32), newRoot: branchA.transition.newRoot, blockNo: 2n });
    await service.recoverToRoot(base.getRoot(), {
      expectedRootInclusionHeight: 1n,
      resolveTransitionInclusionHeight: async () => {
        throw new Error('plain rollback has no forward edge');
      },
    });

    const branchB = transitionFrom(base, 'commitments/ports/transfer/channels/channel-0/sequences/2', 'bb');
    await service.prepareExternalTransition('b2'.repeat(32), branchB.transition);
    await service.confirmTransition({ txHash: 'b2'.repeat(32), newRoot: branchB.transition.newRoot, blockNo: 3n });

    const restarted = new IbcTreeCacheService(manager as unknown as EntityManager);
    const recovered = await restarted.recoverToRoot(branchA.transition.newRoot, {
      expectedRootInclusionHeight: 4n,
      resolveTransitionInclusionHeight: async (txHash) => {
        if (txHash !== 'a1'.repeat(32)) throw new Error('not on canonical fork');
        return 4n;
      },
    });

    expect(recovered.root).toBe(branchA.transition.newRoot);
    expect(recovered.tree.get('commitments/ports/transfer/channels/channel-0/sequences/1')).toEqual(
      Buffer.from('aa', 'hex'),
    );
    expect(recovered.tree.get('commitments/ports/transfer/channels/channel-0/sequences/2')).toBeUndefined();
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === 'a1'.repeat(32))).toMatchObject({
      status: 'confirmed',
      block_no: '4',
    });
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === 'b2'.repeat(32))).toMatchObject({
      status: 'prepared',
      block_no: null,
      retention_class: 'reorg',
    });
  });

  it('selects the indexed transaction when duplicate builds encode the same Merkle edge', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base);
    const next = transitionFrom(base, 'acks/ports/transfer/channels/channel-0/sequences/1', 'ab');
    await service.prepareExternalTransition('a3'.repeat(32), next.transition);
    await service.prepareExternalTransition('b4'.repeat(32), next.transition);

    const recovered = await service.recoverToRoot(next.transition.newRoot, {
      expectedRootInclusionHeight: 20n,
      resolveTransitionInclusionHeight: async (txHash) => {
        if (txHash === 'a3'.repeat(32)) return 21n;
        if (txHash === 'b4'.repeat(32)) return 20n;
        throw new Error('unexpected transaction');
      },
    });

    expect(recovered.root).toBe(next.transition.newRoot);
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === 'a3'.repeat(32))?.status).toBe('prepared');
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === 'b4'.repeat(32))).toMatchObject({
      status: 'confirmed',
      block_no: '20',
    });
  });

  it('backtracks to an included sequential path when an abandoned batched edge reaches the same root', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base, 1n);

    const pathA = 'commitments/ports/transfer/channels/channel-0/sequences/11';
    const pathB = 'receipts/ports/transfer/channels/channel-0/sequences/12';
    const first = transitionFrom(base, pathA, 'a1');
    const second = transitionFrom(first.tree, pathB, 'b2');
    const batchedTree = base.clone();
    batchedTree.set(pathA, Buffer.from('a1', 'hex'));
    batchedTree.set(pathB, Buffer.from('b2', 'hex'));
    expect(batchedTree.getRoot()).toBe(second.tree.getRoot());

    const stored = (
      sequence: number,
      txHash: string,
      transition: { oldRoot: string; newRoot: string; changes: unknown[] },
    ): StoredTransition => ({
      sequence_no: sequence.toString(),
      tx_hash: txHash,
      old_root: transition.oldRoot,
      new_root: transition.newRoot,
      block_no: null,
      status: 'prepared',
      changes: JSON.stringify(transition.changes),
      updated_at: new Date().toISOString(),
      retention_class: 'build',
    });
    const batchedHash = 'c1'.repeat(32);
    const firstHash = 'c2'.repeat(32);
    const secondHash = 'c3'.repeat(32);
    manager.transitions.push(
      stored(1, batchedHash, {
        oldRoot: base.getRoot(),
        newRoot: batchedTree.getRoot(),
        changes: batchedTree.getChanges(),
      }),
      stored(2, firstHash, first.transition),
      stored(3, secondHash, second.transition),
    );

    const recovered = await service.recoverToRoot(second.tree.getRoot(), {
      expectedRootInclusionHeight: 12n,
      resolveTransitionInclusionHeight: async (txHash) => {
        if (txHash === batchedHash) throw new Error('batched transaction was never included');
        if (txHash === firstHash) return 10n;
        if (txHash === secondHash) return 11n;
        throw new Error('unexpected transaction');
      },
    });

    expect(recovered.root).toBe(second.tree.getRoot());
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === batchedHash)?.status).toBe('prepared');
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === firstHash)).toMatchObject({
      status: 'confirmed',
      block_no: '10',
    });
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === secondHash)).toMatchObject({
      status: 'confirmed',
      block_no: '11',
    });
  });

  it('uses the root-establishing height when a later no-op checkpoint is rolled back', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base, 1n);

    const established = transitionFrom(base, 'channels/ports/transfer/channels/channel-0', '01');
    await service.prepareExternalTransition('e1'.repeat(32), established.transition);
    await service.confirmTransition({
      txHash: 'e1'.repeat(32),
      newRoot: established.transition.newRoot,
      blockNo: 90n,
    });
    const child = transitionFrom(
      established.tree,
      'commitments/ports/transfer/channels/channel-0/sequences/99',
      '99',
    );
    await service.prepareExternalTransition('e2'.repeat(32), child.transition);
    await service.confirmTransition({
      txHash: 'ef'.repeat(32),
      newRoot: established.transition.newRoot,
      blockNo: 100n,
    });

    const recovered = await service.recoverToRoot(child.transition.newRoot, {
      expectedRootInclusionHeight: 99n,
      resolveTransitionInclusionHeight: async (txHash) => {
        expect(txHash).toBe('e2'.repeat(32));
        return 99n;
      },
    });

    expect(recovered.root).toBe(child.transition.newRoot);
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === 'e2'.repeat(32))).toMatchObject({
      status: 'confirmed',
      block_no: '99',
    });
  });

  it('recovers an old included edge without treating age as proof that it was abandoned', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base);
    const next = transitionFrom(base, 'receipts/ports/transfer/channels/channel-0/sequences/3', '40');
    await service.prepareExternalTransition('c5'.repeat(32), next.transition);
    manager.transitions[0].updated_at = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const restarted = new IbcTreeCacheService(manager as unknown as EntityManager);
    const recovered = await restarted.recoverToRoot(next.transition.newRoot, {
      expectedRootInclusionHeight: 30n,
      resolveTransitionInclusionHeight: async () => 30n,
    });

    expect(recovered.root).toBe(next.transition.newRoot);
    expect(manager.transitions[0]).toMatchObject({ status: 'confirmed', block_no: '30' });
  });

  it('retains old state-changing builds and reorg branches during ordinary preparation', async () => {
    const manager = new MemoryEntityManager();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    const base = new ICS23MerkleTree();
    await service.bootstrapVerifiedTree(base);
    const now = Date.now();
    const row = (
      sequence: number,
      ageMs: number,
      retentionClass: 'build' | 'reorg',
    ): StoredTransition => ({
      sequence_no: sequence.toString(),
      tx_hash: sequence.toString(16).padStart(64, '0'),
      old_root: '00'.repeat(32),
      new_root: sequence.toString(16).padStart(64, '0'),
      block_no: null,
      status: 'prepared',
      changes: '[]',
      updated_at: new Date(now - ageMs).toISOString(),
      retention_class: retentionClass,
    });
    manager.transitions.push(
      row(1, 30 * 24 * 60 * 60 * 1000, 'build'),
      row(2, 30 * 24 * 60 * 60 * 1000, 'reorg'),
      row(3, 24 * 60 * 60 * 1000, 'reorg'),
    );
    const next = transitionFrom(base, 'commitments/ports/transfer/channels/channel-0/sequences/4', '44');

    await service.prepareExternalTransition('44'.repeat(32), next.transition);

    expect(manager.transitions.find(({ sequence_no }) => sequence_no === '1')).toMatchObject({
      retention_class: 'build',
    });
    expect(manager.transitions.find(({ sequence_no }) => sequence_no === '2')).toMatchObject({
      retention_class: 'reorg',
    });
    expect(manager.transitions.find(({ sequence_no }) => sequence_no === '3')).toMatchObject({
      retention_class: 'reorg',
    });
    expect(manager.transitions.find(({ tx_hash }) => tx_hash === '44'.repeat(32))?.status).toBe('prepared');
  });

  it('rejects a new build instead of evicting still-valid prepared candidates at the hard bound', async () => {
    const manager = new MemoryEntityManager();
    const base = new ICS23MerkleTree();
    const service = new IbcTreeCacheService(manager as unknown as EntityManager);
    await service.bootstrapVerifiedTree(base);
    manager.transitions.push(
      ...Array.from({ length: MAX_RETAINED_PREPARED_TRANSITIONS }, (_, index): StoredTransition => ({
        sequence_no: (index + 1).toString(),
        tx_hash: (index + 1).toString(16).padStart(64, '0'),
        old_root: base.getRoot(),
        new_root: (index + 2).toString(16).padStart(64, '0'),
        block_no: null,
        status: 'prepared',
        changes: '[]',
        updated_at: new Date().toISOString(),
        retention_class: 'build',
      })),
    );
    const next = transitionFrom(base, 'acks/ports/transfer/channels/channel-0/sequences/8', '88');

    await expect(service.prepareExternalTransition('ee'.repeat(32), next.transition)).rejects.toThrow(
      'prepared-transition capacity',
    );
    expect(manager.transitions).toHaveLength(MAX_RETAINED_PREPARED_TRANSITIONS);
  });
});
