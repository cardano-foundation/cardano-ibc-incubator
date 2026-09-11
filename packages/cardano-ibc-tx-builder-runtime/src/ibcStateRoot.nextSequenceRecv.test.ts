import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { it } from 'node:test';
import * as Lucid from '@lucid-evolution/lucid';
import { IbcTreeStateStore, type IbcTreeLucidService } from './ibcStateRoot';

const fixture = JSON.parse(readFileSync(
  resolve(__dirname, '../../../tests/ibc-state-commitment/next-sequence-recv.json'), 'utf8',
)) as {
  version: number;
  key: string;
  channel: {
    state: string; ordering: string;
    counterparty: { port_id: string; channel_id: string };
    connection_hops: string[]; version: string;
  };
  proofPath: Array<{ prefix: string; suffix: string }>;
  vectors: Array<{ sequence: string; committed: string; expected: string; root: string }>;
};
assert.equal(fixture.version, 1);

for (const vector of fixture.vectors) {
  it(`matches the Go nextSequenceRecv fixture at ${vector.sequence}`, async () => {
    const channelDatum = {
      port: Buffer.from('mock').toString('hex'),
      state: {
        channel: fixture.channel,
        next_sequence_send: 1n,
        next_sequence_recv: BigInt(vector.sequence),
        next_sequence_ack: 1n,
        packet_commitment: new Map<bigint, string>(),
        packet_receipt: new Map<bigint, string>(),
        packet_acknowledgement: new Map<bigint, string>(),
        minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
        maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
      },
    };
    const host = { txHash: '11'.repeat(32), outputIndex: 0, datum: 'host', assets: {} };
    const channelUnit = 'aa'.repeat(28) + 'bb'.repeat(24) + '30';
    const lucid: IbcTreeLucidService = {
      LucidImporter: Lucid,
      findUtxoAtHostStateNFT: async () => host,
      decodeDatum: async <T>(datum: string) => (datum === 'host'
        ? { state: { ibc_state_root: vector.root }, control: { port_registry: new Map() } }
        : channelDatum) as T,
    };
    const store = new IbcTreeStateStore(
      { network: 'Preview', hostStateNFT: { policyId: 'cc'.repeat(28), name: '01' } },
      {
        queryAllClientUtxos: async () => [],
        queryAllConnectionUtxos: async () => [],
        queryAllChannelUtxos: async () => [{
          txHash: '22'.repeat(32), outputIndex: 0, datum: 'channel', assets: { [channelUnit]: 1n },
        }],
      },
      lucid,
    );
    const snapshot = await store.getAlignedSnapshot();
    const proof = snapshot.tree.generateProof(fixture.key);
    assert.equal(snapshot.root, vector.root);
    assert.equal(proof.value.toString('hex'), vector.committed);
    assert.deepEqual(proof.path.map(({ prefix, suffix }) => ({
      prefix: prefix.toString('hex'), suffix: suffix.toString('hex'),
    })), fixture.proofPath);
    const expected = Buffer.alloc(8);
    expected.writeBigUInt64BE(BigInt(vector.sequence));
    assert.equal(expected.toString('hex'), vector.expected);

    const next = fixture.vectors.find(({ sequence }) => BigInt(sequence) === BigInt(vector.sequence) + 1n);
    if (next) {
      const update = await store.computeRootWithHandlePacketUpdate(
        snapshot.root, 'mock', 'channel-0', channelDatum,
        { ...channelDatum, state: { ...channelDatum.state, next_sequence_recv: BigInt(next.sequence) } },
        Lucid,
      );
      assert.equal(update.newRoot, next.root);
    }
  });
}
