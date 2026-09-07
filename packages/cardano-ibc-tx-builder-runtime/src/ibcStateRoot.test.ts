import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as Lucid from '@lucid-evolution/lucid';
import {
  computeRootWithCreateChannelUpdate,
  computeRootWithCreateClientUpdate,
  computeRootWithHandlePacketUpdate,
  computeRootWithPrunePacketHistoryUpdate,
  computeRootWithUpdateClientUpdate,
  getCurrentTree,
  getCurrentRoot,
  resetTreeState,
} from './ibcStateRoot';

const emptyRoot = '0'.repeat(64);

describe('shared IBC state root updates', () => {
  beforeEach(resetTreeState);

  it('uses a committed channel update for packet construction and query proofs', async () => {
    const channelValue = Buffer.from('d87980', 'hex');
    const sequenceValue = Buffer.from('01', 'hex');
    const channel = computeRootWithCreateChannelUpdate(
      emptyRoot, 'transfer', 'channel-0', channelValue, sequenceValue, sequenceValue, sequenceValue,
    );
    assert.equal(getCurrentRoot(), emptyRoot);
    channel.commit();

    const input = {
      port: Buffer.from('transfer').toString('hex'),
      state: {
        channel: {},
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
    const packet = await computeRootWithHandlePacketUpdate(
      channel.newRoot, 'transfer', 'channel-0', input, output, Lucid,
    );
    assert.equal(getCurrentRoot(), channel.newRoot);
    assert.equal(packet.nextSequenceSendSiblings.length, 64);
    assert.equal(packet.packetCommitmentSiblings.length, 64);
    packet.commit();
    const tree = getCurrentTree();
    const proof = tree.generateProof('commitments/ports/transfer/channels/channel-0/sequences/1');
    assert.equal(tree.getRoot(), packet.newRoot);
    assert.equal(tree.verifyProof(proof), true);
    assert.equal(proof.value.toString('hex'), '42aabb');
  });

  it('retains the client-update existence checks and consensus deletion order', () => {
    const client = computeRootWithCreateClientUpdate(
      emptyRoot, '07-tendermint-0', Buffer.from('01', 'hex'), Buffer.from('02', 'hex'), 7n,
    );
    client.commit();
    const update = computeRootWithUpdateClientUpdate(
      client.newRoot, '07-tendermint-0', Buffer.from('03', 'hex'), [7n],
      { height: 8n, value: Buffer.from('04', 'hex') },
    );
    assert.equal(getCurrentRoot(), client.newRoot);
    assert.equal(update.removedConsensusStateSiblings.length, 1);
    assert.equal(update.removedConsensusStateSiblings[0].length, 64);
    update.commit();
    assert.equal(getCurrentTree().get('clients/07-tendermint-0/consensusStates/7'), undefined);
    assert.equal(getCurrentTree().get('clients/07-tendermint-0/consensusStates/8')?.toString('hex'), '04');
    assert.throws(() => computeRootWithUpdateClientUpdate(
      update.newRoot, '07-tendermint-0', Buffer.from('05', 'hex'), [7n], undefined,
    ), /existing consensusState/);
    assert.equal(getCurrentRoot(), update.newRoot);
  });

  it('does not change confirmed state when pruning missing packet history fails', () => {
    assert.throws(() => computeRootWithPrunePacketHistoryUpdate(
      emptyRoot, 'transfer', 'channel-0', 7n, 'Unordered',
    ), /existing receipt/);
    assert.equal(getCurrentRoot(), emptyRoot);
  });
});
