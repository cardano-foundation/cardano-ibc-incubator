import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { ICS23MerkleTree } from './ics23MerkleTree';

function fixtureTree(): ICS23MerkleTree {
  return ICS23MerkleTree.fromJSON({
    leaves: {
      'clients/07-tendermint-0/clientState': 'd8799f4101ff',
      'nextSequenceSend/ports/transfer/channels/channel-0': '01',
      'receipts/ports/transfer/channels/channel-0/sequences/7': '40',
      'acks/ports/transfer/channels/channel-0/sequences/7': '42aabb',
    },
  });
}

describe('shared ICS23MerkleTree', () => {
  it('preserves the previous Gateway root and ordered sibling bytes', () => {
    const tree = fixtureTree();
    const receiptPath = 'receipts/ports/transfer/channels/channel-0/sequences/7';

    // Captured from the Gateway implementation before consolidating the tree.
    assert.equal(tree.getRoot(), 'c25ac9baeb2723f7404fb9cac0bf099b7043ca79324b2633248ed0c7625f2932');
    const siblings = tree.getSiblings(receiptPath);
    assert.equal(siblings.length, 64);
    assert.equal(
      createHash('sha256').update(Buffer.concat(siblings)).digest('hex'),
      '7ae9b32fba8cc9d0de753ae871ef7f95baacaa0dc4fc924dfce9ca8e346e2283',
    );

    tree.delete(receiptPath);
    assert.equal(tree.getRoot(), 'ed54bfc2201defafda9a5fdfe562068122ef18ce9272bffe741337bb70dbcd1d');
  });

  it('provides query proofs from the same tree that supplies update witnesses', () => {
    const tree = fixtureTree();
    const existingPath = 'receipts/ports/transfer/channels/channel-0/sequences/7';
    const missingPath = 'receipts/ports/transfer/channels/channel-0/sequences/8';

    const proof = tree.generateProof(existingPath);
    assert.deepEqual(proof.value, Buffer.from('40', 'hex'));
    assert.equal(tree.verifyProof(proof), true);
    const absenceProof = tree.generateNonExistenceProof(missingPath);
    assert.ok(absenceProof.left);
    assert.equal(tree.verifyProof(absenceProof.left), true);
    assert.equal(absenceProof.right, null);
    assert.throws(() => tree.generateProof(missingPath), /not found/);
    assert.throws(() => tree.generateNonExistenceProof(existingPath), /exists/);
  });

  it('round trips cached trees and keeps speculative clones independent', () => {
    const tree = fixtureTree();
    const restored = ICS23MerkleTree.fromJSON(tree.toJSON());
    assert.deepEqual(restored.toJSON(), tree.toJSON());
    assert.equal(restored.size(), 4);

    const clone = restored.clone();
    for (const key of clone.getKeys()) clone.set(key, Buffer.alloc(0));
    assert.equal(clone.getRoot(), '0'.repeat(64));
    assert.equal(restored.size(), 4);
    assert.equal(restored.getRoot(), tree.getRoot());
  });
});
