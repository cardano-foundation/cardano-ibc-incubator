const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { ICS23MerkleTree } = require('../../../packages/cardano-ibc-tx-builder-runtime/dist/ics23MerkleTree.js');

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const text = hex => Buffer.from(hex, 'hex').toString('utf8');
const sorted = map => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const height = value => value.fields.map(BigInt);
const greater = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

function laneRoot(datum) {
  const fields = datum.fields;
  const prefix = `ports/${text(fields[0])}/channels/${text(fields[1])}/sequences/`;
  const tree = new ICS23MerkleTree();
  for (const [sequence, value] of fields[6]) tree.set('commitments/' + prefix + sequence, value);
  for (const sequence of fields[7]) tree.set('receipts/' + prefix + sequence, '01');
  for (const [sequence, value] of fields[8]) tree.set('acks/' + prefix + sequence, value);
  return tree.getRoot();
}

function packetCommitment(packet) {
  const u64 = value => { const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(value)); return bytes; };
  return sha(Buffer.concat([u64(packet.timeoutNanoseconds), u64(packet.timeout_height.revision_number),
    u64(packet.timeout_height.revision_height), Buffer.from(sha(Buffer.from(packet.data, 'hex')), 'hex')]));
}

// Independent observation of one canonical packet operation. The ledger runs
// the actual validators. This checks retained packet obligations and balances
// without using the transaction builder's mutation functions.
function verifyLaneTransition(before, after, packet, kind, proofHeight) {
  assert.equal(before.index, 0);
  assert.equal(after.index, 0);
  assert.equal(before.fields.length, 12);
  assert.equal(after.fields.length, 12);
  assert.equal(before.fields[5], laneRoot(before), 'Original lane root mismatch');
  assert.equal(after.fields[5], laneRoot(after), 'Successor lane root mismatch');
  const old = before.fields;
  const expected = [...old];
  const sequence = BigInt(packet.sequence);
  const commitment = packetCommitment(packet);
  const commitments = new Map(old[6]), receipts = [...old[7]], acks = new Map(old[8]), balances = new Map(old[11]);
  expected[4] = old[4] + 1n;
  const data = JSON.parse(Buffer.from(packet.data, 'hex').toString('utf8'));
  const amount = BigInt(data.amount);
  assert.ok(amount > 0n);
  const localPrefix = `${text(old[0])}/${text(old[1])}/`;
  function balance(denom, delta) {
    const key = sha(Buffer.from(denom));
    balances.set(key, (balances.get(key) ?? 0n) + delta);
    if (balances.get(key) === 0n && commitments.size === 0) balances.delete(key);
  }
  if (kind === 'SendPacket') {
    assert.ok(!commitments.has(sequence), 'Packet was already sent');
    commitments.set(sequence, commitment);
    balance(data.denom, data.denom.startsWith(localPrefix) ? -amount : amount);
  } else if (kind === 'WriteAcknowledgement') {
    assert.ok(!receipts.includes(sequence) && !acks.has(sequence), 'Packet was already received');
    receipts.push(sequence);
    acks.set(sequence, sha(Buffer.from('{"result":"AQ=="}')));
    assert.ok(proofHeight, 'Receive proof height is required');
    if (greater(height(proofHeight), height(old[10]))) expected[10] = proofHeight;
    const sourcePrefix = `${packet.source_port}/${packet.source_channel}/`;
    const returning = data.denom.startsWith(sourcePrefix);
    balance(returning ? data.denom.slice(sourcePrefix.length) : localPrefix + data.denom, returning ? -amount : amount);
  } else if (kind === 'AcknowledgePacket' || kind === 'TimeoutPacket') {
    assert.equal(commitments.get(sequence), commitment, 'Exact original obligation is absent');
    commitments.delete(sequence);
    if (kind === 'TimeoutPacket') balance(data.denom, data.denom.startsWith(localPrefix) ? amount : -amount);
    if (commitments.size === 0) for (const [key, value] of balances) if (value === 0n) balances.delete(key);
  } else throw new Error('Unsupported packet operation');
  expected[6] = new Map(sorted(commitments));
  expected[7] = receipts.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  expected[8] = new Map(sorted(acks));
  expected[11] = new Map(sorted(balances));
  expected[5] = laneRoot({ fields: expected });
  assert.deepEqual(after.fields, expected, 'Unexpected lane obligations, accounting or identity change');
}

module.exports = { laneRoot, packetCommitment, verifyLaneTransition };
