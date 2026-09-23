#!/usr/bin/env node
// Bind an ibc-go acknowledgement's full packet to its canonical transaction.
// ibc-go v8 acknowledgement events intentionally omit packet_data_hex.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { BinaryReader } = require('../../../proto-types/binary.js');
const { MsgAcknowledgement } = require('../../../proto-types/ibc/core/channel/v1/tx.js');
const sha = value => createHash('sha256').update(value).digest();

function transactionRoot(transactions) {
  // CometBFT v0.38 types/tx.go: Merkle leaves contain SHA256(tx), not raw tx.
  function tree(hashes) {
    if (!hashes.length) return sha(Buffer.alloc(0));
    if (hashes.length === 1) return sha(Buffer.concat([Buffer.from([0]), hashes[0]]));
    let split = 1;
    while (split * 2 < hashes.length) split *= 2;
    return sha(Buffer.concat([Buffer.from([1]), tree(hashes.slice(0, split)), tree(hashes.slice(split))]));
  }
  return tree(transactions.map(sha));
}

function fields(bytes, selected) {
  const reader = new BinaryReader(bytes), found = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    assert(tag >>> 3 > 0, 'Invalid protobuf field');
    if (tag >>> 3 === selected) {
      assert.equal(tag & 7, 2, 'Expected length-delimited protobuf field');
      found.push(reader.bytes());
    } else reader.skipType(tag & 7);
  }
  return found;
}
function single(bytes, field) {
  const values = fields(bytes, field);
  assert.equal(values.length, 1, 'Missing or duplicate protobuf envelope field');
  return values[0];
}

function verifyAcknowledgement(block, txIndex, packet, messageIndex) {
  const transactions = (block.data.txs || []).map(tx => Buffer.from(tx, 'base64'));
  assert.equal(transactionRoot(transactions).toString('hex'), block.header.data_hash.toLowerCase(), 'Cosmos transaction data root mismatch');
  assert(Number.isSafeInteger(txIndex) && txIndex >= 0 && txIndex < transactions.length, 'Invalid transaction index');
  const transaction = transactions[txIndex];
  const messages = fields(single(transaction, 1), 1).map(any => ({
    type: Buffer.from(single(any, 1)).toString('utf8'), value: single(any, 2),
  }));
  assert(Number.isSafeInteger(messageIndex) && messageIndex >= 0 && messageIndex < messages.length,
    'Invalid acknowledgement event message index');
  assert.equal(messages[messageIndex].type, '/ibc.core.channel.v1.MsgAcknowledgement', 'Event identifies another message type');
  const message = MsgAcknowledgement.decode(messages[messageIndex].value), actual = message.packet;
  assert(actual, 'Acknowledgement packet is absent');
  for (const key of ['source_port', 'source_channel', 'destination_port', 'destination_channel'])
    assert.equal(actual[key], packet[key], `Acknowledgement ${key} mismatch`);
  assert.equal(actual.sequence.toString(), String(packet.sequence), 'Acknowledgement sequence mismatch');
  assert.equal(Buffer.from(actual.data).toString('hex'), packet.data.toLowerCase(), 'Acknowledgement payload mismatch');
  assert.equal(actual.timeout_timestamp.toString(), packet.timeoutNanoseconds, 'Acknowledgement timeout mismatch');
  for (const key of ['revision_number', 'revision_height'])
    assert.equal(actual.timeout_height[key].toString(), String(packet.timeout_height[key]), 'Acknowledgement timeout height mismatch');
  assert.equal(Buffer.from(message.acknowledgement).toString(), '{"result":"AQ=="}', 'Expected exact successful acknowledgement');
  assert(message.proof_acked.length > 0 && message.proof_height.revision_height > 0n, 'Missing acknowledgement proof');
  return { transactionHash: sha(transaction).toString('hex').toUpperCase(),
    messageIndex, proofHeight: message.proof_height.revision_height.toString(), packetMessageVerified: true };
}

module.exports = { verifyAcknowledgement, transactionRoot };
if (require.main === module) {
  try {
    const request = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    console.log(JSON.stringify(verifyAcknowledgement(request.block, request.txIndex, request.packet, request.messageIndex)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
