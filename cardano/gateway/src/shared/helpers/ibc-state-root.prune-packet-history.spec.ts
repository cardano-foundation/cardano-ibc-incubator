import { ICS23MerkleTree } from './ics23-merkle-tree';
import { IbcTreeStateStore } from './ibc-state-root';
import { createTestTreeContext } from '../testing/ibc-tree-test-store';
import { Order } from '../types/channel/order';

const receiptPath = 'receipts/ports/transfer/channels/channel-0/sequences/7';
const acknowledgementPath = 'acks/ports/transfer/channels/channel-0/sequences/7';

describe('computeRootWithPrunePacketHistoryUpdate', () => {
  let store: IbcTreeStateStore;
  let fixture: ReturnType<typeof createTestTreeContext>;
  beforeEach(() => { fixture = createTestTreeContext(); store = fixture.store; });
  it('deletes receipt first and acknowledgement second without speculative mutation', async () => {
    const tree = new ICS23MerkleTree();
    tree.set(receiptPath, Buffer.from('40', 'hex'));
    tree.set(acknowledgementPath, Buffer.from('41aa', 'hex'));
    await fixture.restore(tree);
    const oldRoot = tree.getRoot();

    const update = store.computeRootWithPrunePacketHistoryUpdate(
      oldRoot,
      'transfer',
      'channel-0',
      7n,
      Order.Unordered,
    );

    expect(update.packetReceiptSiblings).toHaveLength(64);
    expect(update.packetAcknowledgementSiblings).toHaveLength(64);
    expect(update.newRoot).not.toBe(oldRoot);
    expect(store.getCurrentTree().get(receiptPath)).toEqual(Buffer.from('40', 'hex'));
    expect(store.getCurrentTree().get(acknowledgementPath)).toEqual(Buffer.from('41aa', 'hex'));

    await fixture.commit(update);
    expect(store.getCurrentTree().getRoot()).toBe(update.newRoot);
    expect(store.getCurrentTree().get(receiptPath)).toBeUndefined();
    expect(store.getCurrentTree().get(acknowledgementPath)).toBeUndefined();
  });

  it('fails closed when either retained history entry is missing', async () => {
    const tree = new ICS23MerkleTree();
    tree.set(receiptPath, Buffer.from('40', 'hex'));
    await fixture.restore(tree);

    expect(() =>
      store.computeRootWithPrunePacketHistoryUpdate(tree.getRoot(), 'transfer', 'channel-0', 7n, Order.Unordered),
    ).toThrow('expects an existing acknowledgement');
  });

  it('deletes only the acknowledgement for an ordered channel', async () => {
    const tree = new ICS23MerkleTree();
    tree.set(receiptPath, Buffer.from('40', 'hex'));
    tree.set(acknowledgementPath, Buffer.from('41aa', 'hex'));
    await fixture.restore(tree);
    const oldRoot = tree.getRoot();

    const update = store.computeRootWithPrunePacketHistoryUpdate(
      oldRoot,
      'transfer',
      'channel-0',
      7n,
      Order.Ordered,
    );

    expect(update.packetReceiptSiblings).toEqual([]);
    expect(update.packetAcknowledgementSiblings).toHaveLength(64);
    expect(update.newRoot).not.toBe(oldRoot);
    expect(store.getCurrentTree().get(receiptPath)).toEqual(Buffer.from('40', 'hex'));
    expect(store.getCurrentTree().get(acknowledgementPath)).toEqual(Buffer.from('41aa', 'hex'));

    await fixture.commit(update);
    expect(store.getCurrentTree().get(receiptPath)).toEqual(Buffer.from('40', 'hex'));
    expect(store.getCurrentTree().get(acknowledgementPath)).toBeUndefined();
  });

  it('allows an ordered channel with no receipt but still requires an acknowledgement', async () => {
    const tree = new ICS23MerkleTree();
    tree.set(acknowledgementPath, Buffer.from('41aa', 'hex'));
    await fixture.restore(tree);

    const update = store.computeRootWithPrunePacketHistoryUpdate(
      tree.getRoot(),
      'transfer',
      'channel-0',
      7n,
      Order.Ordered,
    );
    expect(update.packetReceiptSiblings).toEqual([]);

    const missingAcknowledgementTree = new ICS23MerkleTree();
    await fixture.restore(missingAcknowledgementTree);
    expect(() =>
      store.computeRootWithPrunePacketHistoryUpdate(
        missingAcknowledgementTree.getRoot(),
        'transfer',
        'channel-0',
        7n,
        Order.Ordered,
      ),
    ).toThrow('expects an existing acknowledgement');
  });
});
