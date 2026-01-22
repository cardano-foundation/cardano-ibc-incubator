import { ICS23MerkleTree } from './ics23-merkle-tree';

describe('IBC state root - BindPort', () => {
  it('does not mutate the canonical tree unless commit() is called', async () => {
    jest.resetModules();

    const { computeRootWithPortBind, isTreeAligned } = await import('./ibc-state-root');

    const emptyRoot = '0'.repeat(64);
    expect(isTreeAligned(emptyRoot)).toBe(true);

    // Any non-empty bytes work as a "bound port marker" for the commitment tree.
    // On-chain we use the CBOR encoding of the integer port number, but the key
    // property here is that state root updates remain side-effect free until
    // a successful transaction is confirmed and commit() is invoked.
    const portValue = Buffer.from('01', 'hex');

    const result = computeRootWithPortBind(emptyRoot, 99, portValue);
    expect(result.portSiblings).toHaveLength(64);
    expect(result.newRoot).not.toBe(emptyRoot);

    // Because we did not call commit(), the canonical in-memory tree must still
    // match the old on-chain root.
    expect(isTreeAligned(emptyRoot)).toBe(true);

    // The helper must use the committed IBC store key `ports/port-<n>`.
    const expectedTree = new ICS23MerkleTree();
    expectedTree.set('ports/port-99', portValue);
    expect(result.newRoot).toBe(expectedTree.getRoot());

    const wrongTree = new ICS23MerkleTree();
    wrongTree.set('ports/99', portValue);
    expect(result.newRoot).not.toBe(wrongTree.getRoot());

    // Calling commit() is the point where the Gateway updates its canonical tree.
    result.commit();
    expect(isTreeAligned(result.newRoot)).toBe(true);
    expect(isTreeAligned(emptyRoot)).toBe(false);
  });
});

