import * as Lucid from '@lucid-evolution/lucid';
import * as runtimeState from '@cardano-ibc/tx-builder-runtime/ibcStateRoot';
import { ICS23MerkleTree as RuntimeTree } from '@cardano-ibc/tx-builder-runtime/ics23MerkleTree';
import { ICS23MerkleTree } from './ics23-merkle-tree';
import * as gatewayState from './ibc-state-root';
import { createTestTreeContext } from '../testing/ibc-tree-test-store';

describe('Gateway shared commitment store', () => {
  it('uses the runtime tree for Gateway queries and packet updates', async () => {
    expect(ICS23MerkleTree).toBe(RuntimeTree);
    expect(gatewayState.IbcTreeStateStore).toBe(runtimeState.IbcTreeStateStore);
    const fixture = createTestTreeContext();
    const { store } = fixture;

    const originalTree = new ICS23MerkleTree();
    originalTree.set('ports/transfer', '01');
    await fixture.restore(originalTree);
    expect(store.getCurrentTree().toJSON()).toEqual(originalTree.toJSON());

    const channel = {
      state: 'Open',
      ordering: 'Unordered',
      counterparty: { port_id: Buffer.from('transfer').toString('hex'), channel_id: '' },
      connection_hops: [],
      version: Buffer.from('ics20-1').toString('hex'),
    };
    const input = {
      port: Buffer.from('transfer').toString('hex'),
      state: {
        channel,
        next_sequence_send: 1n,
        next_sequence_recv: 1n,
        next_sequence_ack: 1n,
        packet_commitment: new Map<bigint, string>(),
        packet_receipt: new Map<bigint, string>(),
        packet_acknowledgement: new Map<bigint, string>(),
        minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
        maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      },
    };
    const output = {
      ...input,
      state: {
        ...input.state,
        next_sequence_send: 2n,
        packet_commitment: new Map([[1n, 'aabb']]),
      },
    };
    const update = await store.computeRootWithHandlePacketUpdate(
      originalTree.getRoot(), 'transfer', 'channel-0', input, output, Lucid,
    );
    expect(store.getCurrentTree().toJSON()).toEqual(originalTree.toJSON());
    await fixture.commit(update);

    const queryTree = store.getCurrentTree();
    expect(store).toBeInstanceOf(runtimeState.IbcTreeStateStore);
    expect(queryTree.getRoot()).toBe(update.newRoot);
    const proof = queryTree.generateProof('commitments/ports/transfer/channels/channel-0/sequences/1');
    expect(queryTree.verifyProof(proof)).toBe(true);
    expect(proof.value.toString('hex')).toBe('42aabb');
  });
});
