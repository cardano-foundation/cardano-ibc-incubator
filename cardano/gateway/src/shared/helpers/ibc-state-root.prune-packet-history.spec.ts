import { ICS23MerkleTree } from './ics23-merkle-tree';
import {
  computeRootWithPrunePacketHistoryUpdate,
  getCurrentTree,
  setCurrentTree,
} from './ibc-state-root';

const receiptPath = 'receipts/ports/transfer/channels/channel-0/sequences/7';
const acknowledgementPath = 'acks/ports/transfer/channels/channel-0/sequences/7';

describe('computeRootWithPrunePacketHistoryUpdate', () => {
  it('deletes receipt first and acknowledgement second without speculative mutation', () => {
    const tree = new ICS23MerkleTree();
    tree.set(receiptPath, Buffer.from('40', 'hex'));
    tree.set(acknowledgementPath, Buffer.from('41aa', 'hex'));
    setCurrentTree(tree);
    const oldRoot = tree.getRoot();

    const update = computeRootWithPrunePacketHistoryUpdate(
      oldRoot,
      'transfer',
      'channel-0',
      7n,
    );

    expect(update.packetReceiptSiblings).toHaveLength(64);
    expect(update.packetAcknowledgementSiblings).toHaveLength(64);
    expect(update.newRoot).not.toBe(oldRoot);
    expect(getCurrentTree().get(receiptPath)).toEqual(Buffer.from('40', 'hex'));
    expect(getCurrentTree().get(acknowledgementPath)).toEqual(Buffer.from('41aa', 'hex'));

    update.commit();
    expect(getCurrentTree().getRoot()).toBe(update.newRoot);
    expect(getCurrentTree().get(receiptPath)).toBeUndefined();
    expect(getCurrentTree().get(acknowledgementPath)).toBeUndefined();
  });

  it('fails closed when either retained history entry is missing', () => {
    const tree = new ICS23MerkleTree();
    tree.set(receiptPath, Buffer.from('40', 'hex'));
    setCurrentTree(tree);

    expect(() =>
      computeRootWithPrunePacketHistoryUpdate(
        tree.getRoot(),
        'transfer',
        'channel-0',
        7n,
      ),
    ).toThrow('expects an existing acknowledgement');
  });
});
