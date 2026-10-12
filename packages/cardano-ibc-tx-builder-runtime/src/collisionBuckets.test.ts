import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';
import { describe, it, mock } from 'node:test';
import { ICS23MerkleTree } from './ics23MerkleTree';
import { IncrementalIbcTree, computeIbcTreeWitnessRoot } from './incrementalIbcTree';

const commitment = require('./ibcStateCommitment') as typeof import('./ibcStateCommitment');

function withCollisionKeys(run: (keys: string[]) => void): void {
  const keys = ['connections/connection-42', 'synthetic-collision-peer-0', 'synthetic-collision-peer-1'];
  const nativeKeyHash = commitment.keyHash;
  const digest = nativeKeyHash(keys[0]);
  const hashes = [digest, Buffer.concat([digest.subarray(0, 8), Buffer.alloc(24)]), Buffer.concat([digest.subarray(0, 8), Buffer.alloc(24, 255)])];
  // Substitute only the peer key digests. All other hashing stays native.
  const replacement = mock.method(commitment, 'keyHash', (key: string) => {
    const index = keys.indexOf(key);
    return index < 0 ? nativeKeyHash(key) : hashes[index];
  });
  try { run(keys); } finally { replacement.mock.restore(); }
}

describe('full-key collision buckets', () => {
  it('preserves all colliding records across updates, deletion and cache restoration', () => withCollisionKeys((keys) => {
    const tree = new ICS23MerkleTree();
    tree.set('ports/transfer', '01');
    tree.set(keys[1], 'aabb');
    const original = tree.getRoot();
    const missing = tree.generateNonExistenceProof(keys[0]);
    assert.ok(missing.left);
    assert.equal(missing.left.path.length, 65);
    assert.equal(tree.verifyProof(missing.left), true);
    assert.equal(computeIbcTreeWitnessRoot(keys[0], '', tree.getSiblings(keys[0]).map((v) => v.toString('hex'))), original);

    tree.set(keys[0], '010203');
    tree.set(keys[2], 'ccdd');
    const inserted = tree.getRoot();
    for (const key of keys) assert.equal(tree.verifyProof(tree.generateProof(key)), true);
    const rootFromReverseOrder = new ICS23MerkleTree();
    for (const key of [...tree.getKeys()].reverse()) rootFromReverseOrder.set(key, tree.get(key)!);
    assert.equal(rootFromReverseOrder.getRoot(), inserted);
    const restored = ICS23MerkleTree.fromJSON(tree.toJSON());
    assert.equal(restored.getRoot(), inserted);
    const clone = tree.clone();
    clone.set(keys[0], '040506');
    assert.notEqual(clone.getRoot(), inserted);
    assert.equal(tree.getRoot(), inserted);
    assert.deepEqual(clone.get(keys[1]), Buffer.from('aabb', 'hex'));

    tree.delete(keys[0]);
    assert.equal(tree.verifyProof(tree.generateNonExistenceProof(keys[0]).left!), true);
    tree.delete(keys[2]);
    assert.equal(tree.getRoot(), original);
    assert.equal(tree.generateProof(keys[1]).path.length, 64);
    assert.equal(tree.generateNonExistenceProof(keys[0]).left!.path.length, 65);
    tree.set(keys[1], '');
    assert.equal(tree.get(keys[1]), undefined);
  }));

  it('keeps the incremental SQLite tree identical through rollback and reopening', () => withCollisionKeys((keys) => {
    const db = new DatabaseSync(':memory:');
    try {
      const incremental = new IncrementalIbcTree(db);
      const reference = new ICS23MerkleTree();
      const changes: Array<[string, string]> = [['ports/transfer', '01'], [keys[1], 'aabb'], [keys[0], '010203'], [keys[2], 'ccdd'], [keys[0], '040506'], [keys[1], ''], [keys[0], ''], [keys[2], '']];
      for (const [key, value] of changes) {
        const before = incremental.getRoot();
        assert.equal(computeIbcTreeWitnessRoot(key, incremental.get(key) ?? '', incremental.getSiblings(key)), before);
        db.exec('SAVEPOINT test_rollback');
        incremental.set(key, value);
        db.exec('ROLLBACK TO test_rollback; RELEASE test_rollback');
        assert.equal(incremental.getRoot(), before);
        incremental.set(key, value);
        reference.set(key, value);
        assert.equal(incremental.getRoot(), reference.getRoot());
        for (const candidate of keys) {
          assert.deepEqual(incremental.getSiblings(candidate), reference.getSiblings(candidate).map((v) => v.toString('hex')));
          assert.equal(incremental.get(candidate), reference.get(candidate)?.toString('hex'));
        }
        incremental.assertIntegrity();
        const reopened = new IncrementalIbcTree(db);
        assert.equal(reopened.getRoot(), reference.getRoot());
        reopened.assertIntegrity();
      }
    } finally { db.close(); }
  }));

  it('migrates the old UNIQUE-path cache without changing its authenticated root', () => withCollisionKeys((keys) => {
    const db = new DatabaseSync(':memory:');
    try {
      const original = new IncrementalIbcTree(db);
      original.set(keys[0], '01');
      const reference = new ICS23MerkleTree();
      reference.set(keys[0], '01');
      // Recreate the old cache schema while retaining all of its stored nodes.
      db.exec(`
        CREATE TABLE old_leaves (key BLOB PRIMARY KEY, path TEXT NOT NULL UNIQUE, value TEXT NOT NULL) STRICT;
        INSERT INTO old_leaves SELECT key, path, value FROM ibc_tree_leaves;
        DROP TABLE ibc_tree_leaves;
        ALTER TABLE old_leaves RENAME TO ibc_tree_leaves;
      `);
      const tree = new IncrementalIbcTree(db);
      assert.equal(tree.getRoot(), reference.getRoot());
      tree.assertIntegrity();
      tree.set(keys[1], '02');
      reference.set(keys[1], '02');
      assert.equal(tree.getRoot(), reference.getRoot());
      assert.equal(tree.entries().length, 2);
      tree.assertIntegrity();
    } finally { db.close(); }
  }));

  it('rejects missing, duplicated, unsorted and foreign-path bucket records', () => withCollisionKeys((keys) => {
    const tree = new ICS23MerkleTree();
    tree.set(keys[0], '01');
    tree.set(keys[1], '02');
    const proof = tree.generateProof(keys[0]);
    const absent = { ...proof, value: Buffer.alloc(0) };
    assert.equal(tree.verifyProof(absent), false);
    for (const mutate of [
      (bytes: Buffer) => bytes.subarray(0, 65),
      (bytes: Buffer) => Buffer.concat([bytes.subarray(0, 65), bytes.subarray(1, 65)]),
      (bytes: Buffer) => Buffer.concat([Buffer.from([2]), bytes.subarray(65), bytes.subarray(1, 65)]),
      (bytes: Buffer) => { bytes[1] ^= 1; return bytes; },
    ]) {
      const changed = tree.generateProof(keys[0]);
      changed.path[0].prefix = mutate(Buffer.from(changed.path[0].prefix));
      assert.equal(tree.verifyProof(changed), false);
    }
  }));
});
