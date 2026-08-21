import * as Lucid from '@lucid-evolution/lucid';

import { ICS23MerkleTree } from './ics23-merkle-tree';
import { encodeModuleRegistration } from '../types/host-state-datum';

describe('IBC state root - BindPort', () => {
  it('does not mutate the canonical tree unless commit() is called', async () => {
    jest.resetModules();

    const { computeRootWithPortBind, isTreeAligned } = await import('./ibc-state-root');

    const emptyRoot = '0'.repeat(64);
    expect(isTreeAligned(emptyRoot)).toBe(true);

    const registration = {
      module_script_hash: '11'.repeat(28),
      port_token: { policy_id: '22'.repeat(28), name: '01' },
      module_token: { policy_id: '33'.repeat(28), name: '02' },
    };
    const portValue = Buffer.from(await encodeModuleRegistration(registration, Lucid), 'hex');
    expect(portValue.toString('hex')).toBe(
      'd8799f581c11111111111111111111111111111111111111111111111111111111d8799f581c222222222222222222222222222222222222222222222222222222224101ffd8799f581c333333333333333333333333333333333333333333333333333333334102ffff',
    );

    const result = computeRootWithPortBind(emptyRoot, 'transfer', portValue);
    expect(result.portSiblings).toHaveLength(64);
    expect(result.newRoot).not.toBe(emptyRoot);

    // Because we did not call commit(), the canonical in-memory tree must still
    // match the old on-chain root.
    expect(isTreeAligned(emptyRoot)).toBe(true);

    // The helper must use the exact textual IBC store key `ports/{portId}`.
    const expectedTree = new ICS23MerkleTree();
    expectedTree.set('ports/transfer', portValue);
    expect(result.newRoot).toBe(expectedTree.getRoot());

    const wrongTree = new ICS23MerkleTree();
    wrongTree.set('ports/port-100', portValue);
    expect(result.newRoot).not.toBe(wrongTree.getRoot());

    // Calling commit() is the point where the Gateway updates its canonical tree.
    result.commit();
    expect(isTreeAligned(result.newRoot)).toBe(true);
    expect(isTreeAligned(emptyRoot)).toBe(false);
  });
});
