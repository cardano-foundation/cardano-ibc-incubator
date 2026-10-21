const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { laneRoot, packetCommitment, verifyLaneTransition } = require('./verify-migration-lanes.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const packet = { sequence: '1', source_port: 'transfer', source_channel: 'channel-0',
    destination_port: 'transfer', destination_channel: 'channel-7',
    data: Buffer.from(JSON.stringify({ denom: 'original-asset', amount: '10' })).toString('hex'),
    timeout_height: { revision_number: '0', revision_height: '0' }, timeoutNanoseconds: '1000000000' };
  const zero = () => ({ index: 0, fields: [0n, 0n] });
  const before = { index: 0, fields: ['7472616e73666572', '6368616e6e656c2d30', 0n, 16n, 3n, '',
    new Map([[2n, 'ab'.repeat(32)]]), [], new Map(), zero(), zero(), new Map()] };
  before.fields[5] = laneRoot(before);
  const after = structuredClone(before);
  after.fields[4] = 4n;
  after.fields[6].set(1n, packetCommitment(packet));
  after.fields[6] = new Map([...after.fields[6]].sort(([a], [b]) => a < b ? -1 : 1));
  after.fields[11].set(sha('original-asset'), 10n);
  after.fields[5] = laneRoot(after);
  return { packet, before, after };
}

test('canonical send preserves other obligations and adds its original backing balance', () => {
  const { before, after, packet } = fixture();
  verifyLaneTransition(before, after, packet, 'SendPacket');
  for (const mutate of [
    value => value.fields[6].delete(2n),
    value => value.fields[6].set(1n, 'cd'.repeat(32)),
    value => value.fields[11].set(sha('original-asset'), 11n),
    value => value.fields[4]++,
    value => value.fields[1] = Buffer.from('channel-1').toString('hex'),
  ]) {
    const changed = structuredClone(after);
    mutate(changed);
    changed.fields[5] = laneRoot(changed);
    assert.throws(() => verifyLaneTransition(before, changed, packet, 'SendPacket'));
  }
});

test('an acknowledgement clears its commitment and retains the backing for circulating vouchers', () => {
  const { packet, after: before } = fixture();
  const after = structuredClone(before);
  after.fields[4]++;
  after.fields[6].delete(1n);
  after.fields[5] = laneRoot(after);
  verifyLaneTransition(before, after, packet, 'AcknowledgePacket');
  after.fields[11].clear();
  assert.throws(() => verifyLaneTransition(before, after, packet, 'AcknowledgePacket'));
});
