import * as Lucid from '@lucid-evolution/lucid';

import { ChannelDatum, encodeChannelEndValue } from '../types/channel/channel-datum';
import { Order } from '../types/channel/order';
import { ChannelState } from '../types/channel/state';
import { ICS23MerkleTree } from './ics23-merkle-tree';
import { computeRootWithHandlePacketUpdate, setCurrentTree } from './ibc-state-root';

const portId = 'transfer';
const channelId = 'channel-0';
const sequence = 2n;

function channelDatum(state: ChannelState): ChannelDatum {
  return {
    port: Buffer.from(portId).toString('hex'),
    token: { policyId: '11'.repeat(28), name: '22' },
    state: {
      channel: {
        state,
        ordering: Order.Ordered,
        counterparty: {
          port_id: Buffer.from('transfer').toString('hex'),
          channel_id: Buffer.from('channel-4').toString('hex'),
        },
        connection_hops: [Buffer.from('connection-0').toString('hex')],
        version: Buffer.from('ics20-1').toString('hex'),
      },
      next_sequence_send: 3n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
      packet_commitment: new Map([[sequence, 'aabb']]),
      packet_receipt: new Map(),
      packet_acknowledgement: new Map(),
      minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
    },
  };
}

async function treeFor(datum: ChannelDatum): Promise<ICS23MerkleTree> {
  const tree = new ICS23MerkleTree();
  const { Data } = Lucid;
  tree.set(
    `channelEnds/ports/${portId}/channels/${channelId}`,
    Buffer.from(await encodeChannelEndValue(datum.state.channel, Lucid), 'hex'),
  );
  tree.set(
    `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence}`,
    Buffer.from(Data.to('aabb' as any, Data.Bytes() as any), 'hex'),
  );
  return tree;
}

describe('IBC state root packet timeout updates', () => {
  it('updates the channel leaf when an ordered timeout closes an open channel', async () => {
    const input = channelDatum(ChannelState.Open);
    const output: ChannelDatum = {
      ...input,
      state: {
        ...input.state,
        channel: { ...input.state.channel, state: ChannelState.Close },
        packet_commitment: new Map(),
      },
    };
    const tree = await treeFor(input);
    setCurrentTree(tree);

    const update = await computeRootWithHandlePacketUpdate(
      tree.getRoot(),
      portId,
      channelId,
      input,
      output,
      Lucid,
    );

    expect(update.channelSiblings).toHaveLength(64);
    expect(update.packetCommitmentSiblings).toHaveLength(64);
  });

  it('does not update the channel leaf when timeout on close preserves Closed', async () => {
    const input = channelDatum(ChannelState.Close);
    const output: ChannelDatum = {
      ...input,
      state: {
        ...input.state,
        channel: { ...input.state.channel },
        packet_commitment: new Map(),
      },
    };
    const tree = await treeFor(input);
    setCurrentTree(tree);

    const update = await computeRootWithHandlePacketUpdate(
      tree.getRoot(),
      portId,
      channelId,
      input,
      output,
      Lucid,
    );

    expect(update.channelSiblings).toEqual([]);
    expect(update.packetCommitmentSiblings).toHaveLength(64);
  });
});
