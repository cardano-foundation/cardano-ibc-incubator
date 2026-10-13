import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as commitment from '../../../../../packages/cardano-ibc-tx-builder-runtime/dist/ibcStateCommitment';
import { ICS23ExistenceProof, ICS23MerkleTree } from './ics23-merkle-tree';
import { serializeExistenceProof, serializeNonExistenceProof } from './ics23-proof-serialization';

const repository = resolve(__dirname, '../../../../..');
interface JsonExistence {
  key: string;
  value: string;
  path: Array<{ hash: number; prefix: string; suffix: string }>;
}
interface CollisionVector {
  name: string;
  key: string;
  committed: string;
  root: string;
  protobuf: string;
  proof: { proofs: Array<{ exist?: JsonExistence; nonexist?: { key: string; left: JsonExistence } }> };
}
const fixture: { syntheticPeerDigests: string[]; vectors: CollisionVector[] } = JSON.parse(readFileSync(resolve(repository, 'tests/ibc-state-commitment/collision-buckets.json'), 'utf8'));

function decodeExistence(proof: JsonExistence): ICS23ExistenceProof {
  return {
    key: Buffer.from(proof.key, 'hex'),
    value: Buffer.from(proof.value, 'hex'),
    leaf: { hash: 1, prehash_key: 0, prehash_value: 0, length: 0, prefix: Buffer.alloc(0) },
    path: proof.path.map((op) => ({ hash: op.hash, prefix: Buffer.from(op.prefix, 'hex'), suffix: Buffer.from(op.suffix, 'hex') })),
  };
}

describe('Gateway collision bucket proofs', () => {
  afterEach(() => jest.restoreAllMocks());

  it('produces the same occupied-position absence and membership bytes verified by Cosmos', () => {
    const nativeHash = commitment.keyHash;
    const peers = ['synthetic-collision-peer-0', 'synthetic-collision-peer-1'];
    jest.spyOn(commitment, 'keyHash').mockImplementation((key: string) => {
      const index = peers.indexOf(key);
      return index < 0 ? nativeHash(key) : Buffer.from(fixture.syntheticPeerDigests[index], 'hex');
    });
    const tree = new ICS23MerkleTree();
    tree.set('ports/transfer', 'd8799f01ff');
    tree.set(peers[0], 'aabb');
    const missing = fixture.vectors.find((vector) => vector.name === 'missing_in_singleton')!;
    expect(tree.getRoot()).toBe(missing.root);
    expect(serializeNonExistenceProof(tree.generateNonExistenceProof(missing.key)).toString('hex')).toBe(missing.protobuf);
    const inserted = fixture.vectors.find((vector) => vector.name === 'insert_collision')!;
    tree.set(inserted.key, inserted.committed);
    expect(tree.getRoot()).toBe(inserted.root);
    expect(serializeExistenceProof(tree.generateProof(inserted.key)).toString('hex')).toBe(inserted.protobuf);
  });

  it.each(fixture.vectors)('preserves the bucket descriptor in $name protobuf serialization', (vector) => {
    const proof = vector.proof.proofs[0];
    const encoded = proof.exist
      ? serializeExistenceProof(decodeExistence(proof.exist))
      : serializeNonExistenceProof({ key: Buffer.from(proof.nonexist!.key, 'hex'), left: decodeExistence(proof.nonexist!.left), right: null });
    expect(encoded.toString('hex')).toBe(vector.protobuf);
  });
});
