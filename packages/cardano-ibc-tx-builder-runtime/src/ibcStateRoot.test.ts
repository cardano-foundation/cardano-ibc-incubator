import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as Lucid from '@lucid-evolution/lucid';
import {
  encodeClientStateValue,
  encodeConsensusStateValue,
  encodeChannelEndValue,
  IbcTreeStateStore,
  StaleIbcTreeStateError,
  type IbcTreeHostStateRef,
  type StateRootResult,
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

function hostRef(sequence: number): IbcTreeHostStateRef {
  return { txHash: sequence.toString(16).padStart(64, '0'), outputIndex: 0 };
}

function emptyReaders() {
  let live = { root: emptyRoot, hostState: hostRef(0) };
  const kupo: IbcTreeKupoService = {
    queryAllClientUtxos: async () => [],
    queryAllConnectionUtxos: async () => [],
    queryAllChannelUtxos: async () => [],
  };
  const lucid: IbcTreeLucidService = {
    LucidImporter: Lucid,
    findUtxoAtHostStateNFT: async () => ({ ...live.hostState, datum: live.root, assets: {} }),
    decodeDatum: async <T>(encodedDatum: string) => ({
      state: { ibc_state_root: encodedDatum },
      control: { port_registry: new Map() },
    }) as T,
  };
  return {
    kupo, lucid,
    setLive(root: string, hostState: IbcTreeHostStateRef) { live = { root, hostState }; },
  };
}

async function commitLive(store: IbcTreeStateStore, readers: ReturnType<typeof emptyReaders>, update: StateRootResult, sequence = 1) {
  const ref = hostRef(sequence);
  readers.setLive(update.newRoot, ref);
  const result = await update.commit(ref);
  assert.equal(result.published, true);
  assert.equal(store.getSnapshot().root, update.newRoot);
  return result;
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function sampleClientState(latestHeight: bigint) {
  return {
    chainId: Buffer.from('chain-1').toString('hex'),
    trustLevel: { numerator: 1n, denominator: 3n },
    trustingPeriod: 1_000n,
    unbondingPeriod: 2_000n,
    maxClockDrift: 10n,
    frozenHeight: { revisionNumber: 0n, revisionHeight: 0n },
    latestHeight: { revisionNumber: 0n, revisionHeight: latestHeight },
    proofSpecs: [],
  };
}

function sampleConsensusState(marker: string) {
  return {
    timestamp: 1_000n,
    next_validators_hash: marker.repeat(32),
    root: { hash: marker.repeat(32) },
  };
}

describe('shared IBC state root updates', () => {
  let store: IbcTreeStateStore;
  let readers: ReturnType<typeof emptyReaders>;
  beforeEach(() => {
    readers = emptyReaders();
    store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
  });

  it('uses a committed channel update for packet construction and query proofs', async () => {
    const channelEnd = {
      state: 'Open',
      ordering: 'Unordered',
      counterparty: { port_id: Buffer.from('transfer').toString('hex'), channel_id: '' },
      connection_hops: [],
      version: Buffer.from('ics20-1').toString('hex'),
    };
    const channelValue = Buffer.from(await encodeChannelEndValue(channelEnd, Lucid), 'hex');
    const sequenceValue = Buffer.from('01', 'hex');
    const channel = store.computeRootWithCreateChannelUpdate(
      emptyRoot, 'transfer', 'channel-0', channelValue, sequenceValue, sequenceValue, sequenceValue,
    );
    assert.equal(store.getCurrentRoot(), emptyRoot);
    await commitLive(store, readers, channel);

    const input = {
      port: Buffer.from('transfer').toString('hex'),
      state: {
        channel: channelEnd,
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
        channel: { ...input.state.channel },
        next_sequence_send: 2n,
        packet_commitment: new Map([[1n, 'aabb']]),
      },
    };
    const packet = await store.computeRootWithHandlePacketUpdate(
      channel.newRoot, 'transfer', 'channel-0', input, output, Lucid,
    );
    assert.equal(store.getCurrentRoot(), channel.newRoot);
    assert.deepEqual(packet.channelSiblings, []);
    assert.equal(packet.nextSequenceSendSiblings.length, 64);
    assert.equal(packet.packetCommitmentSiblings.length, 64);
    await commitLive(store, readers, packet, 2);
    const tree = store.getCurrentTree();
    const proof = tree.generateProof('commitments/ports/transfer/channels/channel-0/sequences/1');
    assert.equal(tree.getRoot(), packet.newRoot);
    assert.equal(tree.verifyProof(proof), true);
    assert.equal(proof.value.toString('hex'), '42aabb');
  });

  for (const initialState of ['Open', 'Close']) {
    it(`removes a timed-out commitment when an ordered channel starts ${initialState}`, async () => {
      const channelPath = 'channelEnds/ports/transfer/channels/channel-0';
      const commitmentPath = 'commitments/ports/transfer/channels/channel-0/sequences/1';
      const channelEnd = {
        state: initialState,
        ordering: 'Ordered',
        counterparty: { port_id: Buffer.from('transfer').toString('hex'), channel_id: '' },
        connection_hops: [],
        version: Buffer.from('ics20-1').toString('hex'),
      };
      const input = {
        port: Buffer.from('transfer').toString('hex'),
        state: {
          channel: channelEnd,
          next_sequence_send: 2n,
          next_sequence_recv: 1n,
          next_sequence_ack: 1n,
          packet_commitment: new Map([[1n, 'aabb']]),
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
          channel: { ...channelEnd, state: 'Close' },
          packet_commitment: new Map<bigint, string>(),
        },
      };
      const initialTree = new ICS23MerkleTree();
      initialTree.set(channelPath, await encodeChannelEndValue(channelEnd, Lucid));
      initialTree.set(commitmentPath, '42aabb');
      for (const [path, value] of [['nextSequenceSend', '02'], ['nextSequenceRecv', '01'], ['nextSequenceAck', '01']]) {
        initialTree.set(`${path}/ports/transfer/channels/channel-0`, value);
      }
      readers.setLive(initialTree.getRoot(), hostRef(1));
      await store.restoreTreeFromCache(initialTree);

      const expected = initialTree.clone();
      const channelSiblings = initialState === 'Open'
        ? expected.getSiblings(channelPath).map((hash) => hash.toString('hex'))
        : [];
      const closedChannelValue = await encodeChannelEndValue(output.state.channel, Lucid);
      expected.set(channelPath, closedChannelValue);
      const commitmentSiblings = expected.getSiblings(commitmentPath).map((hash) => hash.toString('hex'));
      expected.set(commitmentPath, Buffer.alloc(0));

      const timeout = await store.computeRootWithHandlePacketUpdate(
        initialTree.getRoot(), 'transfer', 'channel-0', input, output, Lucid,
      );
      assert.deepEqual(timeout.channelSiblings, channelSiblings);
      assert.deepEqual(timeout.packetCommitmentSiblings, commitmentSiblings);
      assert.deepEqual(timeout.nextSequenceSendSiblings, []);
      assert.deepEqual(timeout.nextSequenceRecvSiblings, []);
      assert.deepEqual(timeout.nextSequenceAckSiblings, []);
      assert.equal(timeout.newRoot, expected.getRoot());
      assert.equal(store.getCurrentRoot(), initialTree.getRoot());
      await commitLive(store, readers, timeout, 2);
      assert.equal(store.getCurrentTree().get(commitmentPath), undefined);
      assert.equal(store.getCurrentTree().get(channelPath)?.toString('hex'), closedChannelValue);
    });
  }

  it('preserves historical consensus leaves and rejects implicit removals', async () => {
    const client = store.computeRootWithCreateClientUpdate(
      emptyRoot, '07-tendermint-0', Buffer.from('01', 'hex'), Buffer.from('02', 'hex'), 7n,
    );
    await commitLive(store, readers, client);
    const update = store.computeRootWithUpdateClientUpdate(
      client.newRoot, '07-tendermint-0', Buffer.from('03', 'hex'), [],
      { height: 8n, value: Buffer.from('04', 'hex') },
    );
    assert.equal(store.getCurrentRoot(), client.newRoot);
    assert.deepEqual(update.removedConsensusStateSiblings, []);
    await commitLive(store, readers, update, 2);
    assert.equal(store.getCurrentTree().get('clients/07-tendermint-0/consensusStates/7')?.toString('hex'), '02');
    assert.equal(store.getCurrentTree().get('clients/07-tendermint-0/consensusStates/8')?.toString('hex'), '04');
    assert.throws(() => store.computeRootWithUpdateClientUpdate(
      update.newRoot, '07-tendermint-0', Buffer.from('05', 'hex'), [7n], undefined,
    ), /cannot remove consensus history/);
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
  async function historyFixture() {
    const policyId = '11'.repeat(28);
    const clientToken = { policyId, name: `${'aa'.repeat(24)}30` };
    const latestHeight = { revisionNumber: 0n, revisionHeight: 8n };
    const olderHeight = { revisionNumber: 0n, revisionHeight: 7n };
    const clientState = sampleClientState(8n);
    const latest = { clientToken, height: latestHeight, consensusState: sampleConsensusState('22'), processedTime: 2000n, processedHeight: 20n };
    const older = { ...latest, height: olderHeight, consensusState: sampleConsensusState('33'), processedTime: 1900n, processedHeight: 19n };
    const records = await Promise.all([older, latest].map(async (datum) => ({
      datum, consensusValue: await encodeConsensusStateValue(datum.consensusState, Lucid), archived: datum === older,
    })));
    const clientDatum = {
      token: clientToken, history_root: 'ab'.repeat(32),
      state: { clientState, consensusStates: new Map([[latestHeight, latest.consensusState]]) },
    };
    const clientValue = await encodeClientStateValue(clientState, Lucid);
    const h = new Lucid.Constr(0, [0n, 8n]);
    const encodedClient = Lucid.Data.to(new Lucid.Constr(0, [
      new Lucid.Constr(0, [
        Lucid.Data.from(clientValue), new Map([[h, Lucid.Data.from(records[1].consensusValue)]]),
        new Map([[h, latest.processedTime]]), new Map([[h, latest.processedHeight]]),
      ]),
      new Lucid.Constr(0, [policyId, clientToken.name]), clientDatum.history_root,
    ]));
    const clientUtxo = { ...hostRef(10), address: 'addr_test1_client', datum: encodedClient, assets: { [policyId + clientToken.name]: 1n } };
    const expected = new ICS23MerkleTree();
    expected.set('clients/07-tendermint-0/clientState', clientValue);
    for (const entry of records) expected.set(`clients/07-tendermint-0/consensusStates/${entry.datum.height.revisionHeight}`, entry.consensusValue);
    const readers = emptyReaders();
    readers.kupo.queryAllClientUtxos = async () => [clientUtxo];
    readers.lucid.consensusHistoryRecords = async (client) => {
      assert.equal(client.txHash, clientUtxo.txHash);
      assert.equal(client.outputIndex, clientUtxo.outputIndex);
      return records;
    };
    readers.lucid.decodeDatum = async <T>(encoded: string, type: string) => {
      if (type === 'host_state') return { state: { ibc_state_root: expected.getRoot() }, control: { port_registry: new Map() } } as T;
      if (type === 'client' && encoded === clientUtxo.datum) return clientDatum as T;
      throw new Error(`unexpected ${type} datum`);
    };
    readers.setLive(expected.getRoot(), hostRef(12));
    const historyDeployment: IbcTreeDeployment = { ...deployment, clientPolicyId: policyId };
    const makeStore = () => new IbcTreeStateStore(historyDeployment, readers.kupo, readers.lucid);
    return { records, clientDatum, clientUtxo, expected, readers, makeStore };
  }

  it('rebuilds public historical and latest consensus leaves from recovered records', async () => {
    const fixture = await historyFixture();
    const rebuilt = await fixture.makeStore().rebuildTreeFromChain();
    assert.equal(rebuilt.root, fixture.expected.getRoot());
    assert.equal(rebuilt.tree.get('clients/07-tendermint-0/consensusStates/7')?.toString('hex'), fixture.records[0].consensusValue);
    assert.equal(rebuilt.tree.get('clients/07-tendermint-0/consensusStates/8')?.toString('hex'), fixture.records[1].consensusValue);
  });

  it('rejects foreign-client, duplicate, missing and corrupted recovered records', async () => {
    {
      const fixture = await historyFixture();
      fixture.records[0].datum.clientToken = { ...fixture.records[0].datum.clientToken, name: 'bb'.repeat(24) + '31' };
      await assert.rejects(fixture.makeStore().rebuildTreeFromChain(), /Invalid recovered consensus/);
    }
    {
      const fixture = await historyFixture();
      fixture.records.push(fixture.records[0]);
      await assert.rejects(fixture.makeStore().rebuildTreeFromChain(), /Duplicate consensus state path/);
    }
    for (const removeLatest of [false, true]) {
      const fixture = await historyFixture();
      fixture.records.splice(removeLatest ? 1 : 0, 1);
      await assert.rejects(fixture.makeStore().rebuildTreeFromChain(), /Tree rebuild failed/);
    }
    {
      const fixture = await historyFixture();
      fixture.records[0].consensusValue = 'ff';
      await assert.rejects(fixture.makeStore().rebuildTreeFromChain(), /Tree rebuild failed/);
    }
  });

  it('requires a valid private-root datum, exact client NFT and a recovered-history reader', async () => {
    {
      const fixture = await historyFixture();
      fixture.clientDatum.history_root = '';
      await assert.rejects(fixture.makeStore().rebuildTreeFromChain(), /valid client root/);
    }
    {
      const fixture = await historyFixture();
      fixture.readers.lucid.consensusHistoryRecords = undefined;
      await assert.rejects(fixture.makeStore().rebuildTreeFromChain(), /historical chain reader/);
    }
    {
      const fixture = await historyFixture();
      fixture.clientUtxo.assets[Object.keys(fixture.clientUtxo.assets)[0]] = 2n;
      await assert.rejects(fixture.makeStore().rebuildTreeFromChain(), /failed authentication/);
    }
  });

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
    it(`isolates speculative commits and reset with ${description}`, async () => {
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
      await commitLive(storeB, readersB, updateB, 2);
      await commitLive(storeA, readersA, updateA, 1);
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
          return { ...hostRef(portId.length), datum: `host-${portId}`, assets: {} };
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
    assert.deepEqual(readersA.calls, ['host', 'clients', 'connections', 'channels', 'host']);
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
    assert.equal(readersA.calls.length, 10);
    assert.equal(readersB.calls.length, 5);
    assert.deepEqual(storeA.getCurrentTree().get('ports/transfer'), registrationValue);
  });

  it('keeps both stores unchanged when one rebuild fails root validation', async () => {
    const readersA = emptyReaders();
    const readersB = emptyReaders();
    const storeA = new IbcTreeStateStore(deployment, readersA.kupo, readersA.lucid);
    const storeB = new IbcTreeStateStore(deployment, readersB.kupo, readersB.lucid);
    await commitLive(storeA, readersA, storeA.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('01', 'hex')));
    await commitLive(storeB, readersB, storeB.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('02', 'hex')));
    const rootA = storeA.getCurrentRoot();
    const rootB = storeB.getCurrentRoot();
    readersA.lucid.decodeDatum = async <T>() => ({
      state: { ibc_state_root: 'aa'.repeat(32) },
      control: { port_registry: new Map() },
    }) as T;

    await assert.rejects(storeA.rebuildTreeFromChain(), /Tree rebuild failed/);
    assert.equal(storeA.getCurrentRoot(), rootA);
    assert.equal(storeB.getCurrentRoot(), rootB);
  });
});

describe('guarded tree publication', () => {
  it('returns independent snapshots and does not expose an unbound snapshot', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    assert.throws(() => store.getSnapshot(), /no bound HostState/);
    const initial = await store.getAlignedSnapshot();
    assert.deepEqual(initial.hostState, hostRef(0));

    const inputValue = Buffer.from('01', 'hex');
    const update = store.computeRootWithPortBind(emptyRoot, 'transfer', inputValue);
    inputValue.fill(2);
    const result = await commitLive(store, readers, update);
    const snapshot = store.getSnapshot();
    snapshot.tree.get('ports/transfer')!.fill(0);
    snapshot.tree.set('unrelated', 'aa');
    result.snapshot.tree.delete('ports/transfer');
    store.getCurrentTree().delete('ports/transfer');
    assert.equal(store.getCurrentRoot(), update.newRoot);
    assert.equal(store.getSnapshot().tree.get('ports/transfer')?.toString('hex'), '01');
    assert.throws(() => Object.assign(snapshot.hostState, { outputIndex: 8 }), TypeError);
    assert.throws(() => store.computeRootWithHeartbeatUpdate(emptyRoot), /out of sync/);
  });

  it('rejects a rebuild started at A when confirmed B publishes while it waits', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    await store.getAlignedSnapshot();
    const entered = gate();
    const resume = gate();
    readers.kupo.queryAllClientUtxos = async () => {
      entered.release();
      await resume.promise;
      return [];
    };
    const rebuildingA = store.rebuildTreeFromChain();
    await entered.promise;
    const updateB = store.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('01', 'hex'));
    await commitLive(store, readers, updateB, 2);
    const snapshotB = store.getSnapshot();
    resume.release();
    await assert.rejects(rebuildingA, StaleIbcTreeStateError);
    assert.equal(store.getCurrentRoot(), updateB.newRoot);
    assert.deepEqual(store.getSnapshot().hostState, snapshotB.hostState);
    assert.equal(store.getSnapshot().version, snapshotB.version);
  });

  it('rejects a changed live output even when its root and local generation are unchanged', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    const initial = await store.getAlignedSnapshot();
    const entered = gate();
    const resume = gate();
    readers.kupo.queryAllClientUtxos = async () => {
      entered.release();
      await resume.promise;
      return [];
    };
    const rebuilding = store.rebuildTreeFromChain();
    await entered.promise;
    readers.setLive(emptyRoot, { ...hostRef(0), outputIndex: 1 });
    resume.release();
    await assert.rejects(rebuilding, StaleIbcTreeStateError);
    assert.equal(store.getSnapshot().version, initial.version);
    assert.deepEqual(store.getSnapshot().hostState, initial.hostState);
  });

  it('retains historical A without overwriting a later confirmed B', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    await store.getAlignedSnapshot();
    const updateA = store.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('01', 'hex'));
    const treeA = new ICS23MerkleTree();
    treeA.set('ports/transfer', '01');
    readers.setLive(updateA.newRoot, hostRef(1));
    // A query sees A before its transaction observation completes.
    await store.restoreTreeFromCache(treeA);
    const updateB = store.computeRootWithPortBind(updateA.newRoot, 'transfer', Buffer.from('02', 'hex'));
    await commitLive(store, readers, updateB, 2);

    const lateA = await updateA.commit(hostRef(1));
    assert.equal(lateA.published, false);
    assert.equal(lateA.snapshot.root, updateA.newRoot);
    assert.deepEqual(lateA.snapshot.hostState, hostRef(1));
    assert.equal(lateA.snapshot.tree.get('ports/transfer')?.toString('hex'), '01');
    assert.equal(store.getSnapshot().root, updateB.newRoot);
    assert.deepEqual(store.getSnapshot().hostState, hostRef(2));
  });

  it('declines a confirmation superseded on-chain before any local publication', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    const initial = await store.getAlignedSnapshot();
    const updateA = store.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('01', 'hex'));
    // A and B have both confirmed, but this store has not observed either yet.
    readers.setLive(updateA.newRoot, hostRef(2));
    const result = await updateA.commit(hostRef(1));
    assert.equal(result.published, false);
    assert.equal(result.snapshot.root, updateA.newRoot);
    assert.equal(store.getSnapshot().version, initial.version);
    assert.deepEqual(store.getSnapshot().hostState, initial.hostState);
  });

  it('rechecks generation after awaiting confirmation publication evidence', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    await store.getAlignedSnapshot();
    const update = store.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('01', 'hex'));
    readers.setLive(update.newRoot, hostRef(1));
    const entered = gate();
    const resume = gate();
    const findLive = readers.lucid.findUtxoAtHostStateNFT;
    readers.lucid.findUtxoAtHostStateNFT = async () => {
      const captured = await findLive();
      entered.release();
      await resume.promise;
      return captured;
    };
    const committing = update.commit(hostRef(1));
    await entered.promise;
    store.resetTreeState();
    resume.release();
    assert.equal((await committing).published, false);
    assert.equal(store.getCurrentRoot(), emptyRoot);
    assert.throws(() => store.getSnapshot(), /no bound HostState/);
  });

  it('guards cached restore and copies cache input before asynchronous reads', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    const cached = new ICS23MerkleTree();
    cached.set('ports/transfer', '01');
    const expectedRoot = cached.getRoot();
    readers.setLive(expectedRoot, hostRef(1));
    const restoring = store.restoreTreeFromCache(cached);
    cached.set('ports/transfer', '02');
    const restored = await restoring;
    assert.equal(restored.root, expectedRoot);
    assert.equal(store.getSnapshot().root, expectedRoot);

    const initial = store.getSnapshot();
    let reads = 0;
    const findLive = readers.lucid.findUtxoAtHostStateNFT;
    readers.lucid.findUtxoAtHostStateNFT = async () => {
      if (++reads === 2) readers.setLive(expectedRoot, hostRef(2));
      return findLive();
    };
    await assert.rejects(store.restoreTreeFromCache(initial.tree), StaleIbcTreeStateError);
    assert.equal(store.getSnapshot().version, initial.version);
    assert.deepEqual(store.getSnapshot().hostState, hostRef(1));
  });

  it('advances heartbeat references and allows an authoritative rollback to an older output', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    const initial = await store.getAlignedSnapshot();
    const heartbeat = store.computeRootWithHeartbeatUpdate(emptyRoot);
    const result = await commitLive(store, readers, heartbeat, 2);
    assert.equal(result.snapshot.root, initial.root);
    assert.deepEqual(result.snapshot.hostState, hostRef(2));
    const afterHeartbeat = store.getSnapshot();

    readers.setLive(emptyRoot, hostRef(0));
    const rolledBack = await store.getAlignedSnapshot();
    assert.equal(rolledBack.root, initial.root);
    assert.deepEqual(rolledBack.hostState, initial.hostState);
    assert.ok(rolledBack.version > afterHeartbeat.version);

    const changed = store.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('01', 'hex'));
    await commitLive(store, readers, changed, 3);
    readers.setLive(emptyRoot, hostRef(0));
    assert.equal((await store.getAlignedSnapshot()).root, emptyRoot);
    assert.equal(store.getSnapshot().tree.size(), 0);
  });

  it('rejects a stale prepared computation after reset even when its output later becomes live', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    const pending = store.computeRootWithPortBind(emptyRoot, 'transfer', Buffer.from('01', 'hex'));
    store.resetTreeState();
    readers.setLive(pending.newRoot, hostRef(1));
    const result = await pending.commit(hostRef(1));
    assert.equal(result.published, false);
    assert.equal(result.snapshot.root, pending.newRoot);
    assert.equal(store.getCurrentRoot(), emptyRoot);
  });

  it('captures the version before asynchronous packet encoding', async () => {
    const readers = emptyReaders();
    const store = new IbcTreeStateStore(deployment, readers.kupo, readers.lucid);
    const input = {
      port: '',
      state: {
        channel: {
          state: 'Open', ordering: 'Unordered',
          counterparty: { port_id: '', channel_id: '' }, connection_hops: [], version: '',
        },
        next_sequence_send: 1n, next_sequence_recv: 1n, next_sequence_ack: 1n,
        packet_commitment: new Map<bigint, string>(),
        packet_receipt: new Map<bigint, string>(),
        packet_acknowledgement: new Map<bigint, string>(),
        minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
        maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      },
    };
    const output = { ...input, state: { ...input.state, channel: { ...input.state.channel, state: 'Close' } } };
    const preparing = store.computeRootWithHandlePacketUpdate(emptyRoot, 'transfer', 'channel-0', input, output, Lucid);
    // encodeChannelEndValue yields before the computation returns its callback.
    store.resetTreeState();
    const pending = await preparing;
    readers.setLive(pending.newRoot, hostRef(1));
    assert.equal((await pending.commit(hostRef(1))).published, false);
    assert.equal(store.getCurrentRoot(), emptyRoot);
  });
});
