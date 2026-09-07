import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as Lucid from '@lucid-evolution/lucid';
import {
  IbcTreeStateStore,
  type IbcTreeDeployment,
  type IbcTreeKupoService,
  type IbcTreeLucidService,
} from './ibcStateRoot';
import { ICS23MerkleTree } from './ics23MerkleTree';

const emptyRoot = '0'.repeat(64);
const deployment: IbcTreeDeployment = {
  network: 'Preview',
  hostStateNFT: { policyId: 'aa'.repeat(28), name: '01' },
};

function emptyReaders(): { kupo: IbcTreeKupoService; lucid: IbcTreeLucidService } {
  return {
    kupo: {
      queryAllClientUtxos: async () => [],
      queryAllConnectionUtxos: async () => [],
      queryAllChannelUtxos: async () => [],
    },
    lucid: {
      LucidImporter: Lucid,
      findUtxoAtHostStateNFT: async () => ({ datum: 'empty-host', assets: {} }),
      decodeDatum: async <T>() => ({
        state: { ibc_state_root: emptyRoot },
        control: { port_registry: new Map() },
      }) as T,
    },
  };
}

describe('shared IBC state root updates', () => {
  let store: IbcTreeStateStore;
  beforeEach(() => {
    const readers = emptyReaders();
    store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
  });

  it('uses a committed channel update for packet construction and query proofs', async () => {
    const channelValue = Buffer.from('d87980', 'hex');
    const sequenceValue = Buffer.from('01', 'hex');
    const channel = store.computeRootWithCreateChannelUpdate(
      emptyRoot, 'transfer', 'channel-0', channelValue, sequenceValue, sequenceValue, sequenceValue,
    );
    assert.equal(store.getCurrentRoot(), emptyRoot);
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
    const packet = await store.computeRootWithHandlePacketUpdate(
      channel.newRoot, 'transfer', 'channel-0', input, output, Lucid,
    );
    assert.equal(store.getCurrentRoot(), channel.newRoot);
    assert.equal(packet.nextSequenceSendSiblings.length, 64);
    assert.equal(packet.packetCommitmentSiblings.length, 64);
    packet.commit();
    const tree = store.getCurrentTree();
    const proof = tree.generateProof('commitments/ports/transfer/channels/channel-0/sequences/1');
    assert.equal(tree.getRoot(), packet.newRoot);
    assert.equal(tree.verifyProof(proof), true);
    assert.equal(proof.value.toString('hex'), '42aabb');
  });

  it('retains the client-update existence checks and consensus deletion order', () => {
    const client = store.computeRootWithCreateClientUpdate(
      emptyRoot, '07-tendermint-0', Buffer.from('01', 'hex'), Buffer.from('02', 'hex'), 7n,
    );
    client.commit();
    const update = store.computeRootWithUpdateClientUpdate(
      client.newRoot, '07-tendermint-0', Buffer.from('03', 'hex'), [7n],
      { height: 8n, value: Buffer.from('04', 'hex') },
    );
    assert.equal(store.getCurrentRoot(), client.newRoot);
    assert.equal(update.removedConsensusStateSiblings.length, 1);
    assert.equal(update.removedConsensusStateSiblings[0].length, 64);
    update.commit();
    assert.equal(store.getCurrentTree().get('clients/07-tendermint-0/consensusStates/7'), undefined);
    assert.equal(store.getCurrentTree().get('clients/07-tendermint-0/consensusStates/8')?.toString('hex'), '04');
    assert.throws(() => store.computeRootWithUpdateClientUpdate(
      update.newRoot, '07-tendermint-0', Buffer.from('05', 'hex'), [7n], undefined,
    ), /existing consensusState/);
    assert.equal(store.getCurrentRoot(), update.newRoot);
  });

  it('does not change confirmed state when pruning missing packet history fails', () => {
    assert.throws(() => store.computeRootWithPrunePacketHistoryUpdate(
      emptyRoot, 'transfer', 'channel-0', 7n, 'Unordered',
    ), /existing receipt/);
    assert.equal(store.getCurrentRoot(), emptyRoot);
  });
});

describe('deployment-bound tree stores', () => {
  it('copies and freezes its deployment binding', () => {
    const binding = { network: 'Preview', hostStateNFT: { policyId: 'aa'.repeat(28), name: '01' } };
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(binding, readers.kupo, readers.lucid);

    binding.network = 'Preprod';
    binding.hostStateNFT.policyId = 'bb'.repeat(28);
    binding.hostStateNFT.name = '02';
    assert.deepEqual(store.deployment, deployment);
    assert.notEqual(store.deployment, binding);
    assert.notEqual(store.deployment.hostStateNFT, binding.hostStateNFT);
    assert.ok(Object.isFrozen(store.deployment));
    assert.ok(Object.isFrozen(store.deployment.hostStateNFT));
    assert.throws(() => Object.assign(store.deployment, { network: 'Mainnet' }), TypeError);
    assert.throws(() => Object.assign(store.deployment.hostStateNFT, { name: '03' }), TypeError);
  });

  const otherBindings: Array<{ description: string; binding: IbcTreeDeployment }> = [
    { description: 'the same deployment identity', binding: deployment },
    { description: 'a different network', binding: { ...deployment, network: 'Preprod' } },
    {
      description: 'a different HostState on the same network',
      binding: { ...deployment, hostStateNFT: { policyId: 'bb'.repeat(28), name: '02' } },
    },
  ];
  for (const { description, binding } of otherBindings) {
    it(`isolates speculative commits and reset with ${description}`, () => {
      const readersA = emptyReaders();
      const readersB = emptyReaders();
      const storeA = new IbcTreeStateStore(deployment, readersA.kupo, readersA.lucid);
      const storeB = new IbcTreeStateStore(binding, readersB.kupo, readersB.lucid);
      const updateA = storeA.computeRootWithCreateClientUpdate(
        emptyRoot, '07-tendermint-0', Buffer.from('01', 'hex'), Buffer.from('02', 'hex'), 7n,
      );
      const updateB = storeB.computeRootWithCreateClientUpdate(
        emptyRoot, '07-tendermint-0', Buffer.from('03', 'hex'), Buffer.from('04', 'hex'), 7n,
      );
      assert.equal(storeA.getCurrentRoot(), emptyRoot);
      assert.equal(storeB.getCurrentRoot(), emptyRoot);
      updateB.commit();
      updateA.commit();
      assert.equal(storeA.getCurrentRoot(), updateA.newRoot);
      assert.equal(storeB.getCurrentRoot(), updateB.newRoot);
      assert.notEqual(storeA.getCurrentRoot(), storeB.getCurrentRoot());
      assert.notEqual(storeA.getCurrentTree(), storeB.getCurrentTree());
      assert.equal(storeA.getCurrentTree().get('clients/07-tendermint-0/clientState')?.toString('hex'), '01');
      assert.equal(storeB.getCurrentTree().get('clients/07-tendermint-0/clientState')?.toString('hex'), '03');

      storeA.resetTreeState();
      assert.equal(storeA.getCurrentRoot(), emptyRoot);
      assert.equal(storeB.getCurrentRoot(), updateB.newRoot);
    });
  }

  it('keeps rebuild readers bound to their store across another context and reset', async () => {
    const registration = {
      module_script_hash: '11'.repeat(28),
      port_token: { policy_id: '22'.repeat(28), name: '01' },
      module_token: { policy_id: '33'.repeat(28), name: '02' },
    };
    // Existing Gateway/on-chain fixture bytes, independent of the runtime encoder.
    const registrationValue = Buffer.from(
      'd8799f581c11111111111111111111111111111111111111111111111111111111d8799f581c222222222222222222222222222222222222222222222222222222224101ffd8799f581c333333333333333333333333333333333333333333333333333333334102ffff',
      'hex',
    );
    function readersFor(portId: string) {
      const tree = new ICS23MerkleTree();
      tree.set(`ports/${portId}`, registrationValue);
      const calls: string[] = [];
      const kupo: IbcTreeKupoService = {
        queryAllClientUtxos: async () => { calls.push('clients'); return []; },
        queryAllConnectionUtxos: async () => { calls.push('connections'); return []; },
        queryAllChannelUtxos: async () => { calls.push('channels'); return []; },
      };
      const lucid: IbcTreeLucidService = {
        LucidImporter: Lucid,
        findUtxoAtHostStateNFT: async () => {
          calls.push('host');
          return { datum: `host-${portId}`, assets: {} };
        },
        decodeDatum: async <T>(encodedDatum: string, type: string) => {
          assert.equal(encodedDatum, `host-${portId}`);
          assert.equal(type, 'host_state');
          return {
            state: { ibc_state_root: tree.getRoot() },
            control: { port_registry: new Map([[Buffer.from(portId).toString('hex'), registration]]) },
          } as T;
        },
      };
      return { tree, calls, kupo, lucid };
    }

    const readersA = readersFor('transfer');
    const readersB = readersFor('Transfer-v2');
    const storeA = new IbcTreeStateStore(deployment, readersA.kupo, readersA.lucid);
    const storeB = new IbcTreeStateStore(deployment, readersB.kupo, readersB.lucid);
    const rebuiltA = await storeA.rebuildTreeFromChain();
    assert.equal(rebuiltA.root, readersA.tree.getRoot());
    assert.deepEqual(readersA.calls, ['host', 'clients', 'connections', 'channels']);
    assert.deepEqual(readersB.calls, []);
    assert.equal(storeB.getCurrentRoot(), emptyRoot);

    await storeB.alignTreeWithChain();
    assert.equal(storeB.getCurrentRoot(), readersB.tree.getRoot());
    assert.equal(storeA.getCurrentRoot(), readersA.tree.getRoot());
    assert.equal(storeA.getCurrentTree().get('ports/Transfer-v2'), undefined);
    assert.equal(storeB.getCurrentTree().get('ports/transfer'), undefined);

    storeA.resetTreeState();
    await storeA.alignTreeWithChain();
    assert.equal(storeA.getCurrentRoot(), readersA.tree.getRoot());
    assert.equal(storeB.getCurrentRoot(), readersB.tree.getRoot());
    assert.equal(readersA.calls.length, 8);
    assert.equal(readersB.calls.length, 4);
    assert.deepEqual(storeA.getCurrentTree().get('ports/transfer'), registrationValue);
  });

  it('keeps both stores unchanged when one rebuild fails root validation', async () => {
    const readersA = emptyReaders();
    const readersB = emptyReaders();
    readersA.lucid.decodeDatum = async <T>() => ({
      state: { ibc_state_root: 'aa'.repeat(32) },
      control: { port_registry: new Map() },
    }) as T;
    const storeA = new IbcTreeStateStore(deployment, readersA.kupo, readersA.lucid);
    const storeB = new IbcTreeStateStore(deployment, readersB.kupo, readersB.lucid);
    storeA.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('01', 'hex')).commit();
    storeB.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('02', 'hex')).commit();
    const rootA = storeA.getCurrentRoot();
    const rootB = storeB.getCurrentRoot();

    await assert.rejects(storeA.rebuildTreeFromChain(), /Tree rebuild failed/);
    assert.equal(storeA.getCurrentRoot(), rootA);
    assert.equal(storeB.getCurrentRoot(), rootB);
  });
});
