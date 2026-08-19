import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as Lucid from '@lucid-evolution/lucid';
import {
  computeRootWithHandlePacketUpdate,
  createFetchIbcTreeRecoveryStore,
  createTreeCheckpoint,
  installVerifiedTreeRecovery,
  recoverTreeFromCheckpointAndJournal,
  resetTreeState,
  type IbcStateTreeJournalEntry,
} from './ibcStateRoot';
import { ICS23MerkleTree } from './ics23MerkleTree';
import { LucidIbcAdapter } from './lucidIbcAdapter';

const PORT_ID = 'transfer';
const CHANNEL_ID = 'channel-0';

type TestChannelDatum = {
  port: string;
  token: { policyId: string; name: string };
  state: {
    channel: {
      state: string;
      ordering: string;
      counterparty: { port_id: string; channel_id: string };
      connection_hops: string[];
      version: string;
    };
    next_sequence_send: bigint;
    next_sequence_recv: bigint;
    next_sequence_ack: bigint;
  };
};

function channelDatum(ordering: 'Ordered' | 'Unordered' = 'Unordered'): TestChannelDatum {
  return {
    port: Buffer.from(PORT_ID).toString('hex'),
    token: { policyId: '11'.repeat(28), name: '22'.repeat(8) },
    state: {
      channel: {
        state: 'Open',
        ordering,
        counterparty: {
          port_id: Buffer.from('transfer').toString('hex'),
          channel_id: Buffer.from('channel-1').toString('hex'),
        },
        connection_hops: [Buffer.from('connection-0').toString('hex')],
        version: Buffer.from('ics20-1').toString('hex'),
      },
      next_sequence_send: 1n,
      next_sequence_recv: 1n,
      next_sequence_ack: 1n,
    },
  };
}

function encodeChannelEnd(channel: TestChannelDatum['state']['channel']): Buffer {
  const StateSchema = Lucid.Data.Enum([
    Lucid.Data.Literal('Uninitialized'),
    Lucid.Data.Literal('Init'),
    Lucid.Data.Literal('TryOpen'),
    Lucid.Data.Literal('Open'),
    Lucid.Data.Literal('Closed'),
  ]);
  const OrderSchema = Lucid.Data.Enum([
    Lucid.Data.Literal('None'),
    Lucid.Data.Literal('Unordered'),
    Lucid.Data.Literal('Ordered'),
  ]);
  const ChannelSchema = Lucid.Data.Object({
    state: StateSchema,
    ordering: OrderSchema,
    counterparty: Lucid.Data.Object({
      port_id: Lucid.Data.Bytes(),
      channel_id: Lucid.Data.Bytes(),
    }),
    connection_hops: Lucid.Data.Array(Lucid.Data.Bytes()),
    version: Lucid.Data.Bytes(),
  });
  return Buffer.from(Lucid.Data.to(channel as any, ChannelSchema as any), 'hex');
}

function encodeInteger(value: bigint): Buffer {
  return Buffer.from(Lucid.Data.to(value as any, Lucid.Data.Integer() as any), 'hex');
}

function installChannelTree(datum: TestChannelDatum): string {
  const tree = new ICS23MerkleTree();
  tree.set(`channelEnds/ports/${PORT_ID}/channels/${CHANNEL_ID}`, encodeChannelEnd(datum.state.channel));
  tree.set(
    `nextSequenceSend/ports/${PORT_ID}/channels/${CHANNEL_ID}`,
    encodeInteger(datum.state.next_sequence_send),
  );
  tree.set(
    `nextSequenceRecv/ports/${PORT_ID}/channels/${CHANNEL_ID}`,
    encodeInteger(datum.state.next_sequence_recv),
  );
  tree.set(
    `nextSequenceAck/ports/${PORT_ID}/channels/${CHANNEL_ID}`,
    encodeInteger(datum.state.next_sequence_ack),
  );
  const checkpoint = createTreeCheckpoint(tree);
  installVerifiedTreeRecovery({ checkpoint, journal: [] }, checkpoint.root);
  return checkpoint.root;
}

describe('root-authoritative packet state transitions', () => {
  it('encodes and decodes a fixed-size ChannelDatum without packet maps', async () => {
    const adapter = new LucidIbcAdapter(Lucid, {} as any, {} as any);
    const datum = channelDatum();
    const encoded = await adapter.encode(datum, 'channel');
    const decoded = await adapter.decodeDatum<TestChannelDatum>(encoded, 'channel');

    assert.deepEqual(Object.keys(decoded.state), [
      'channel',
      'next_sequence_send',
      'next_sequence_recv',
      'next_sequence_ack',
    ]);
    assert.equal((decoded.state as any).packet_commitment, undefined);
    assert.equal((decoded.state as any).packet_receipt, undefined);
    assert.equal((decoded.state as any).packet_acknowledgement, undefined);
  });

  it('supports more than 64 unordered receives without growing ChannelDatum', async () => {
    resetTreeState();
    const datum = channelDatum();
    let root = installChannelTree(datum);

    for (let index = 1n; index <= 80n; index += 1n) {
      const result = await computeRootWithHandlePacketUpdate(
        root,
        PORT_ID,
        CHANNEL_ID,
        datum,
        datum,
        {
          kind: 'recv',
          sequence: index,
          acknowledgementCommitment: index.toString(16).padStart(64, '0'),
        },
        Lucid,
      );
      result.commit();
      root = result.newRoot;
    }

    assert.equal(Object.keys(datum.state).length, 4);
    assert.equal(createTreeCheckpoint().root, root);
    assert.equal(Object.keys(createTreeCheckpoint().leaves).length, 164);
  });

  it('uses authenticated non-membership to reject an unordered receive replay', async () => {
    resetTreeState();
    const datum = channelDatum();
    const initialRoot = installChannelTree(datum);
    const operation = {
      kind: 'recv' as const,
      sequence: 9n,
      acknowledgementCommitment: 'ab'.repeat(32),
    };
    const first = await computeRootWithHandlePacketUpdate(
      initialRoot,
      PORT_ID,
      CHANNEL_ID,
      datum,
      datum,
      operation,
      Lucid,
    );
    first.commit();

    await assert.rejects(
      computeRootWithHandlePacketUpdate(
        first.newRoot,
        PORT_ID,
        CHANNEL_ID,
        datum,
        datum,
        operation,
        Lucid,
      ),
      /expected <absent>, got/,
    );
  });

  it('rejects acknowledgement replay and deletion with a different packet commitment', async () => {
    resetTreeState();
    const input = channelDatum();
    const output = channelDatum();
    output.state.next_sequence_send = 2n;
    const initialRoot = installChannelTree(input);
    const commitment = 'cd'.repeat(32);
    const send = await computeRootWithHandlePacketUpdate(
      initialRoot,
      PORT_ID,
      CHANNEL_ID,
      input,
      output,
      { kind: 'send', sequence: 1n, commitment },
      Lucid,
    );
    send.commit();

    await assert.rejects(
      computeRootWithHandlePacketUpdate(
        send.newRoot,
        PORT_ID,
        CHANNEL_ID,
        output,
        output,
        { kind: 'acknowledge', sequence: 1n, commitment: 'ef'.repeat(32) },
        Lucid,
      ),
      /Authenticated IBC tree precondition failed/,
    );

    const acknowledgement = await computeRootWithHandlePacketUpdate(
      send.newRoot,
      PORT_ID,
      CHANNEL_ID,
      output,
      output,
      { kind: 'acknowledge', sequence: 1n, commitment },
      Lucid,
    );
    acknowledgement.commit();
    await assert.rejects(
      computeRootWithHandlePacketUpdate(
        acknowledgement.newRoot,
        PORT_ID,
        CHANNEL_ID,
        output,
        output,
        { kind: 'acknowledge', sequence: 1n, commitment },
        Lucid,
      ),
      /expected .* got <absent>/,
    );
  });

  it('closes an ordered channel on timeout and emits only the required witnesses', async () => {
    resetTreeState();
    const beforeSend = channelDatum('Ordered');
    const afterSend = channelDatum('Ordered');
    afterSend.state.next_sequence_send = 2n;
    const initialRoot = installChannelTree(beforeSend);
    const commitment = '34'.repeat(32);
    const send = await computeRootWithHandlePacketUpdate(
      initialRoot,
      PORT_ID,
      CHANNEL_ID,
      beforeSend,
      afterSend,
      { kind: 'send', sequence: 1n, commitment },
      Lucid,
    );
    send.commit();

    const afterTimeout = structuredClone(afterSend);
    afterTimeout.state.channel.state = 'Closed';
    const timeout = await computeRootWithHandlePacketUpdate(
      send.newRoot,
      PORT_ID,
      CHANNEL_ID,
      afterSend,
      afterTimeout,
      { kind: 'timeout', sequence: 1n, commitment },
      Lucid,
    );

    assert.equal(timeout.channelSiblings.length, 64);
    assert.equal(timeout.packetCommitmentSiblings.length, 64);
    assert.deepEqual(timeout.nextSequenceSendSiblings, []);
    assert.deepEqual(timeout.nextSequenceRecvSiblings, []);
    assert.deepEqual(timeout.nextSequenceAckSiblings, []);
    assert.deepEqual(timeout.packetReceiptSiblings, []);
    assert.deepEqual(timeout.packetAcknowledgementSiblings, []);
  });
});

describe('verified checkpoint and journal recovery', () => {
  it('keeps HTTP recovery read-only', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = input.toString();
      requestInit = init;
      return new Response(
        JSON.stringify({
          checkpoint: {
            formatVersion: 1,
            root: '00'.repeat(32),
            leaves: {},
          },
          journal: [],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const store = createFetchIbcTreeRecoveryStore(
      'https://gateway.test/api/ibc/tree-recovery',
      fetchImpl,
    );
    const recovery = await store.load('00'.repeat(32));

    assert.equal(
      requestUrl,
      `https://gateway.test/api/ibc/tree-recovery?root=${'00'.repeat(32)}`,
    );
    assert.equal(requestInit?.method, undefined);
    assert.equal(store.prepare, undefined);
    assert.equal(recovery?.checkpoint.root, '00'.repeat(32));
  });

  it('recovers forward and backward only when every journal root recomputes', async () => {
    resetTreeState();
    const input = channelDatum();
    const output = channelDatum();
    output.state.next_sequence_send = 2n;
    const initialRoot = installChannelTree(input);
    const initialCheckpoint = createTreeCheckpoint();
    const update = await computeRootWithHandlePacketUpdate(
      initialRoot,
      PORT_ID,
      CHANNEL_ID,
      input,
      output,
      { kind: 'send', sequence: 1n, commitment: '12'.repeat(32) },
      Lucid,
    );
    update.commit();
    const currentCheckpoint = createTreeCheckpoint();

    const recoveredCurrent = recoverTreeFromCheckpointAndJournal(
      { checkpoint: initialCheckpoint, journal: [update.journalEntry] },
      update.newRoot,
    );
    assert.equal(recoveredCurrent.getRoot(), update.newRoot);

    const recoveredPrevious = recoverTreeFromCheckpointAndJournal(
      { checkpoint: currentCheckpoint, journal: [update.journalEntry] },
      initialRoot,
    );
    assert.equal(recoveredPrevious.getRoot(), initialRoot);

    const corrupted: IbcStateTreeJournalEntry = {
      ...update.journalEntry,
      mutations: update.journalEntry.mutations.map((mutation, index) =>
        index === 0 ? { ...mutation, newValue: 'ff' } : mutation,
      ),
    };
    assert.throws(
      () => recoverTreeFromCheckpointAndJournal(
        { checkpoint: initialCheckpoint, journal: [corrupted] },
        update.newRoot,
      ),
      /Journal root mismatch/,
    );
  });
});
