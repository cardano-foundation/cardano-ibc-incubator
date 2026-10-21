const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertCutover, assertUnchangedPackets } = require('./capture-channel-migration.cjs');

function original() {
  return { genesisSha256: 'genesis', deploymentId: 'deployment',
    packetState: { lanes: [{ unit: 'lane', root: 'root', commitments: [[1, 'packet']], receipts: [2], balances: [['asset', 10]] }],
      sequencers: [{ next: 3 }], intents: [{ outref: 'funded', amount: 5 }], backing: [{ unit: 'original-backing', amount: 10 }] },
    channels: [{ id: 'channel-0', datum: { token: { policy: 'channel', name: '0' }, port: 'transfer',
      state: { channel: { state: 'Open', ordering: 'Unordered', counterparty: { port_id: 'transfer', channel_id: 'channel-7' },
        version: 'ics20-1', upgrade_sequence: '4', connection_hops: ['old'] }, upgrade: { pending: null } } } }] };
}
function switched(before) {
  const after = structuredClone(before), channel = after.channels[0];
  channel.datum.state.channel.upgrade_sequence = '5';
  channel.datum.state.channel.connection_hops = [Buffer.from('connection-1').toString('hex')];
  channel.connection = { state: 3, clientId: '07-tendermint-1', counterpartyConnection: 'connection-8', counterpartyClient: '08-cardano-probabilistic-2' };
  channel.counterparty = { channel: { state: 'STATE_OPEN', counterparty: { port_id: 'transfer', channel_id: 'channel-0' }, connection_hops: ['connection-8'] },
    connection: { state: 'STATE_OPEN', client_id: '08-cardano-probabilistic-2', counterparty: { client_id: '07-tendermint-1', connection_id: 'connection-1' } } };
  return after;
}
function check(before, after) { assertCutover(before, after, 'channel-0', 'connection-1', '07-tendermint-1'); }

test('cutover evidence binds both routes while preserving original backing and funded intents', () => {
  const before = original();
  check(before, switched(before));
  for (const mutate of [
    value => { value.channels[0].datum.token.name = 'another'; },
    value => { value.channels[0].datum.port = 'another'; },
    value => { value.channels[0].datum.state.channel.state = 'Close'; },
    value => { value.channels[0].datum.state.channel.ordering = 'Ordered'; },
    value => { value.channels[0].datum.state.channel.version = 'changed'; },
    value => { value.channels[0].datum.state.channel.counterparty.channel_id = 'channel-8'; },
    value => { value.channels[0].datum.state.channel.connection_hops = ['other']; },
    value => { value.channels[0].datum.state.channel.upgrade_sequence = '6'; },
    value => { value.channels[0].datum.state.upgrade.pending = {}; },
    value => { value.channels[0].connection.clientId = '07-tendermint-9'; },
    value => { value.channels[0].connection.state = 1; },
    value => { value.channels[0].counterparty.channel.state = 'STATE_FLUSHCOMPLETE'; },
    value => { value.channels[0].counterparty.channel.connection_hops = ['connection-0']; },
    value => { value.channels[0].counterparty.connection.client_id = 'old'; },
    value => { value.channels[0].counterparty.connection.state = 'STATE_INIT'; },
    value => { value.channels[0].counterparty.connection.counterparty.client_id = 'old'; },
    value => { value.channels[0].counterparty.connection.counterparty.connection_id = 'connection-0'; },
  ]) {
    const after = switched(before);
    mutate(after);
    assert.throws(() => check(before, after));
  }
});

test('administrative operations cannot reset packet completion or move backing', () => {
  const before = original();
  assertUnchangedPackets(before, structuredClone(before));
  for (const mutate of [
    value => { value.genesisSha256 = 'other'; },
    value => { value.deploymentId = 'other'; },
    value => { value.packetState.lanes[0].commitments = []; value.packetState.lanes[0].root = 'recomputed'; },
    value => { value.packetState.lanes[0].receipts = []; value.packetState.lanes[0].root = 'recomputed'; },
    value => { value.packetState.lanes[0].balances[0][1] = 0; },
    value => { value.packetState.sequencers[0].next = 1; },
    value => { value.packetState.intents = []; },
    value => { value.packetState.backing[0].unit = 'replacement-backing'; },
    value => { value.packetState.backing[0].amount = 9; },
  ]) {
    const after = structuredClone(before);
    mutate(after);
    assert.throws(() => assertUnchangedPackets(before, after));
  }
});
