import * as Lucid from '@lucid-evolution/lucid';

import { ChannelDatum } from '../types/channel/channel-datum';
import { Order } from '../types/channel/order';
import { ChannelState } from '../types/channel/state';
import {
  computeRootWithHandlePacketUpdate,
  getCurrentTree,
  resetTreeState,
} from './ibc-state-root';
import { listPacketStoreEntries, packetStorePath } from './packet-state-store';

const CHANNEL_DATUM: ChannelDatum = {
  port: Buffer.from('transfer').toString('hex'),
  token: { policyId: 'aa', name: 'bb' },
  state: {
    channel: {
      state: ChannelState.Open,
      ordering: Order.Unordered,
      counterparty: { port_id: 'aa', channel_id: 'bb' },
      connection_hops: ['cc'],
      version: 'dd',
    },
    next_sequence_send: 1n,
    next_sequence_recv: 1n,
    next_sequence_ack: 1n,
  },
};

describe('root-authoritative packet state', () => {
  beforeEach(() => resetTreeState());
  afterEach(() => resetTreeState());

  it('supports more than the former 64-entry channel limit and preserves non-membership proofs', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    let root = '0'.repeat(64);

    for (let sequence = 1n; sequence <= 100n; sequence += 1n) {
      const update = await computeRootWithHandlePacketUpdate(
        root,
        'transfer',
        'channel-0',
        CHANNEL_DATUM,
        CHANNEL_DATUM,
        {
          kind: 'recv',
          sequence,
          acknowledgementCommitment: sequence.toString(16).padStart(64, '0'),
        },
        Lucid,
      );
      update.commit();
      root = update.newRoot;
    }

    const tree = getCurrentTree();
    expect(tree.size()).toBe(200);
    expect(listPacketStoreEntries(tree, 'receipts', 'transfer', 'channel-0', Lucid)).toHaveLength(100);
    expect(listPacketStoreEntries(tree, 'acks', 'transfer', 'channel-0', Lucid)).toHaveLength(100);
    const missingPath = packetStorePath('receipts', 'transfer', 'channel-0', 101n);
    expect(tree.get(missingPath)).toBeUndefined();
    expect(tree.generateNonExistenceProof(missingPath).key).toEqual(Buffer.from(missingPath));

    log.mockRestore();
  });
});
