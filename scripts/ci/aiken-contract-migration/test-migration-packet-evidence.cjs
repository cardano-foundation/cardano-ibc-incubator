const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { verifyTransition, verifyRedeemer, commitment } = require('./verify-migration-packet.cjs');
const { authenticateBlock } = require('./authenticate-migration-block.cjs');
const { verifyAcknowledgement, transactionRoot } = require('./verify-migration-cosmos-message.cjs');

test('CometBFT three-transaction commitment uses ordered transaction-hash leaves', () => {
  const sha = value => createHash('sha256').update(value).digest();
  const leaf = tx => sha(Buffer.concat([Buffer.from([0]), sha(tx)]));
  const node = (left, right) => sha(Buffer.concat([Buffer.from([1]), left, right]));
  const transactions = ['first', 'second', 'third'].map(s => Buffer.from(s));
  const expected = node(node(leaf(transactions[0]), leaf(transactions[1])), leaf(transactions[2]));
  assert.deepEqual(transactionRoot(transactions), expected);
  assert.notDeepEqual(transactionRoot([transactions[1], transactions[0], transactions[2]]), expected);
  assert.notDeepEqual(transactionRoot(transactions.slice(0, 2)), expected);
});

test('Cosmos acknowledgement body authenticates the payload omitted from its event', () => {
  const { BinaryWriter } = require('../../../proto-types/binary.js');
  const { MsgAcknowledgement } = require('../../../proto-types/ibc/core/channel/v1/tx.js');
  const packet = { sequence: 1, source_port: 'transfer', source_channel: 'channel-0',
    destination_port: 'transfer', destination_channel: 'channel-0', data: '7b7d',
    timeoutNanoseconds: '1767488263000000000', timeout_height: { revision_number: 0, revision_height: 0 } };
  const message = MsgAcknowledgement.fromPartial({ packet: { ...packet, sequence: 1n,
    data: Buffer.from(packet.data, 'hex'), timeout_timestamp: BigInt(packet.timeoutNanoseconds),
    timeout_height: { revision_number: 0n, revision_height: 0n } },
    acknowledgement: Buffer.from('{"result":"AQ=="}'), proof_acked: Buffer.from([1]),
    proof_height: { revision_number: 0n, revision_height: 42n }, signer: 'public-fixture' });
  const any = BinaryWriter.create().uint32(10).string('/ibc.core.channel.v1.MsgAcknowledgement')
    .uint32(18).bytes(MsgAcknowledgement.encode(message).finish()).finish();
  const body = BinaryWriter.create().uint32(10).bytes(any).finish();
  const tx = Buffer.from(BinaryWriter.create().uint32(10).bytes(body).uint32(18).bytes(Buffer.from([1]))
    .uint32(26).bytes(Buffer.from([2])).finish());
  // Independently spell out the known one-leaf CometBFT commitment.
  const hash = value => createHash('sha256').update(value).digest();
  const root = hash(Buffer.concat([Buffer.from([0]), hash(tx)])).toString('hex');
  const block = { header: { data_hash: root }, data: { txs: [tx.toString('base64')] } };
  assert.equal(verifyAcknowledgement(block, 0, packet, 0).proofHeight, '42');
  assert.equal(transactionRoot([tx]).toString('hex'), root);
  assert.throws(() => verifyAcknowledgement(block, 0, packet, 1), /message index/);
  assert.throws(() => verifyAcknowledgement(block, 0, packet), /message index/);
  const other = MsgAcknowledgement.fromPartial({ ...message, packet: { ...message.packet, data: Buffer.from('wrong') } });
  const otherAny = BinaryWriter.create().uint32(10).string('/ibc.core.channel.v1.MsgAcknowledgement')
    .uint32(18).bytes(MsgAcknowledgement.encode(other).finish()).finish();
  const batchBody = BinaryWriter.create().uint32(10).bytes(otherAny).uint32(10).bytes(any).finish();
  const batchTx = Buffer.from(BinaryWriter.create().uint32(10).bytes(batchBody).finish());
  const batch = { header: { data_hash: hash(Buffer.concat([Buffer.from([0]), hash(batchTx)])).toString('hex') },
    data: { txs: [batchTx.toString('base64')] } };
  assert.equal(verifyAcknowledgement(batch, 0, packet, 1).messageIndex, 1);
  assert.throws(() => verifyAcknowledgement(batch, 0, packet, 0), /payload mismatch/);
  for (const changed of [{ ...packet, data: '7b2278223a317d' }, { ...packet, sequence: 2 },
    { ...packet, source_channel: 'channel-1' }, { ...packet, timeoutNanoseconds: '1767488263000000001' },
    { ...packet, timeout_height: { revision_number: 1, revision_height: 0 } }])
    assert.throws(() => verifyAcknowledgement(block, 0, changed, 0), /mismatch/);
  const mutated = Buffer.from(tx); mutated[mutated.length - 1] ^= 1;
  assert.throws(() => verifyAcknowledgement({ ...block, data: { txs: [mutated.toString('base64')] } }, 0, packet, 0), /data root mismatch/);
  assert.throws(() => verifyAcknowledgement(block, 1, packet, 0), /transaction index/);
});

test('canonical body commitment binds witness bytes independently of transaction hashes', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { createRequire } = require('node:module');
  const req = createRequire(path.resolve(__dirname, '../../../cardano/gateway/package.json'));
  const CML = req('@dcspark/cardano-multiplatform-lib-nodejs');
  const bytes = Buffer.from(fs.readFileSync(path.resolve(__dirname,
    '../../../cosmos/cardano-probabilistic-light-client-core/testdata/conway_block.hex'), 'utf8').replace(/\s/g, ''), 'hex');
  const hash = '27807a70215e3e018eec9be8c619c692e06a78ebcb63daf90d7abe823f3bbf47';
  const valid = authenticateBlock(bytes, hash);
  const signature = Buffer.from(valid.transaction_witness_sets().get(0).vkeywitnesses().get(0).ed25519_signature().to_raw_bytes());
  const offset = bytes.indexOf(signature);
  assert(offset >= 0);
  const substituted = Buffer.from(bytes); substituted[offset] ^= 1;
  // This remains a fully decodable block with the same transaction-body hash.
  // A header-only/body-only evidence check would accept these substituted witnesses.
  const decoded = CML.Block.from_cbor_bytes(substituted);
  assert.equal(CML.hash_transaction(decoded.transaction_bodies().get(0)).to_hex(),
    CML.hash_transaction(valid.transaction_bodies().get(0)).to_hex());
  assert.equal(decoded.header().to_cbor_hex(), valid.header().to_cbor_hex());
  assert.throws(() => authenticateBlock(substituted, hash), /body\/witness hash mismatch/);
});
const packet = { sequence: 3, data: Buffer.from('{"amount":"100"}').toString('hex'), timeoutNanoseconds: '1767225600123456789',
  timeout_height: { revision_number: 0, revision_height: 0 } };
function source() {
  return { token: { policyId: 'aa', name: 'bb' }, port: 'transfer', state: {
    channel: { state: 'Open', ordering: 'Unordered' }, next_sequence_send: 3n, next_sequence_recv: 1n, next_sequence_ack: 1n,
    packet_commitment: new Map([[1n, 'old']]), packet_receipt: new Map([[2n, '']]), packet_acknowledgement: new Map([[2n, 'oldack']]),
    minimum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n }, maximum_receive_proof_height: { revisionNumber: 0n, revisionHeight: 0n },
  } };
}
test('known ICS04 commitment vector uses nanoseconds and both height components', () => {
  const digest = '58d7e7466cf92fab3f5149d7fdbee69961b3b1f582a372cf40ba200f5f62129d';
  assert.equal(commitment(packet), digest);
  assert.notEqual(commitment({ ...packet, timeout_height: { revision_number: 1, revision_height: 0 } }), digest);
});
test('send accepts exact transition and rejects checkpoint-only and overwritten obligations', () => {
  const before = source(), after = structuredClone(before);
  after.state.next_sequence_send = 4n; after.state.packet_commitment.set(3n, commitment(packet));
  verifyTransition(before, after, packet, 'SendPacket');
  assert.throws(() => verifyTransition(before, before, packet, 'SendPacket'), /Unexpected packet/);
  for (const mutate of [x => x.state.packet_commitment.delete(1n), x => x.state.packet_commitment.set(3n, 'wrong'),
                        x => x.state.next_sequence_recv++, x => x.token.name = 'substituted']) {
    const bad = structuredClone(after); mutate(bad);
    assert.throws(() => verifyTransition(before, bad, packet, 'SendPacket'));
  }
});
test('receive requires original absence and exact receipt and acknowledgement digest', () => {
  const before = source(), after = structuredClone(before);
  after.state.packet_receipt.set(3n, '');
  after.state.packet_acknowledgement.set(3n, createHash('sha256').update('{"result":"AQ=="}').digest('hex'));
  verifyTransition(before, after, packet, 'WriteAcknowledgement');
  assert.throws(() => verifyTransition(after, after, packet, 'WriteAcknowledgement'), /Duplicate receive/);
  after.state.packet_acknowledgement.set(3n, 'wrong');
  assert.throws(() => verifyTransition(before, after, packet, 'WriteAcknowledgement'), /Unexpected packet/);
});
for (const operation of ['AcknowledgePacket', 'TimeoutPacket']) {
  test(`${operation} removes exactly the original commitment once`, () => {
    const before = source(); before.state.packet_commitment.set(3n, commitment(packet));
    const after = structuredClone(before); after.state.packet_commitment.delete(3n);
    verifyTransition(before, after, packet, operation);
    assert.throws(() => verifyTransition(after, after, packet, operation), /Missing exact/);
    assert.throws(() => verifyTransition(before, after, { ...packet, data: '00' }, operation), /Missing exact/);
    after.state.packet_commitment.delete(1n);
    assert.throws(() => verifyTransition(before, after, packet, operation), /Unexpected packet/);
  });
}
test('canonical redeemer disambiguates equal state shapes and binds received payload', () => {
  const requested = { ...packet, source_port: 'transfer', source_channel: 'channel-0',
    destination_port: 'transfer', destination_channel: 'channel-1' };
  const encoded = { sequence: 3n, source_port: Buffer.from('transfer').toString('hex'),
    source_channel: Buffer.from('channel-0').toString('hex'), destination_port: Buffer.from('transfer').toString('hex'),
    destination_channel: Buffer.from('channel-1').toString('hex'), data: packet.data,
    timeout_height: { revisionNumber: 0n, revisionHeight: 0n }, timeout_timestamp: BigInt(packet.timeoutNanoseconds) };
  const received = { RecvPacket: { packet: encoded } };
  verifyRedeemer(received, requested, 'WriteAcknowledgement');
  assert.throws(() => verifyRedeemer(received, { ...requested, data: '01' }, 'WriteAcknowledgement'), /another packet/);
  assert.throws(() => verifyRedeemer(received, { ...requested, destination_channel: 'channel-9' }, 'WriteAcknowledgement'), /another packet/);
  const ack = { AcknowledgePacket: { packet: encoded, acknowledgement: Buffer.from('{"result":"AQ=="}').toString('hex') } };
  verifyRedeemer(ack, requested, 'AcknowledgePacket');
  assert.throws(() => verifyRedeemer(ack, requested, 'TimeoutPacket'), /another operation/);
  assert.throws(() => verifyRedeemer({ TimeoutPacket: { packet: encoded } }, requested, 'AcknowledgePacket'), /another operation/);
});
