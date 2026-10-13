import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ICS23MerkleTree } from './ics23-merkle-tree';
import { serializeExistenceProof, serializeNonExistenceProof } from './ics23-proof-serialization';

const fixture = JSON.parse(readFileSync(resolve(
  __dirname, '../../../../../tests/ibc-state-commitment/proofs.json',
), 'utf8')) as {
  version: number;
  vectors: Array<{ name: string; key: string; committed: string; root: string; protobuf: string }>;
};

describe('Cardano proof bytes shared with Go and Aiken', () => {
  const tree = new ICS23MerkleTree();
  for (const vector of fixture.vectors) {
    if (vector.committed) tree.set(vector.key, vector.committed);
  }

  it('regenerates the fixed CBOR values, roots and witnesses with the runtime', () => {
    execFileSync(process.execPath, [resolve(__dirname, '../../../../../tests/ibc-state-commitment/generate.mjs'), '--check'], { stdio: 'pipe' });
  });

  it.each(fixture.vectors)('serializes the exact Go fixture: $name', (vector) => {
    expect(fixture.version).toBe(1);
    expect(tree.getRoot()).toBe(vector.root);
    const bytes = vector.committed
      ? serializeExistenceProof(tree.generateProof(vector.key))
      : serializeNonExistenceProof(tree.generateNonExistenceProof(vector.key));
    expect(bytes.toString('hex')).toBe(vector.protobuf);
  });
});
