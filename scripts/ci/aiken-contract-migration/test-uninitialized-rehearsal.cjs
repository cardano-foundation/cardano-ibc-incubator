const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertNoIbcState } = require('./assert-uninitialized-rehearsal.cjs');

test('large pool-aging clock steps reject any initialized IBC attempt on either chain', () => {
  const host = { index: 0, fields: [{ index: 0, fields: [2n, 'root', 0n, 0n, 0n, [], 0n] }, 'policy', 'authority', {}] };
  const clients = { client_states: [], pagination: {} };
  const connections = { connections: [] }, channels = { channels: [] };
  const check = (h, c) => assertNoIbcState(h, c, connections, channels);
  check(host, clients);
  check(host, { client_states: [{ client_id: '09-localhost', client_state: { '@type': '/ibc.lightclients.localhost.v2.ClientState' } }] });
  for (const index of [2, 3, 4]) {
    const changed = structuredClone(host);
    changed.fields[0].fields[index] = 1n;
    assert.throws(() => check(changed, clients));
  }
  assert.throws(() => check(host, { client_states: [{}] }));
  assert.throws(() => check(host, { client_states: [], pagination: { next_key: 'more' } }));
  assert.throws(() => check(host, {}));
  assert.throws(() => assertNoIbcState(host, clients, { connections: [{}] }, channels));
  assert.throws(() => assertNoIbcState(host, clients, connections, { channels: [{}] }));
  const local = { id: 'connection-localhost', client_id: '09-localhost',
    versions: [{ identifier: '1', features: ['ORDER_ORDERED', 'ORDER_UNORDERED'] }], state: 'STATE_OPEN',
    counterparty: { client_id: '09-localhost', connection_id: 'connection-localhost', prefix: { key_prefix: 'aWJj' } }, delay_period: '0' };
  assertNoIbcState(host, clients, { connections: [local] }, channels);
  for (const field of ['id', 'client_id', 'versions', 'state', 'counterparty', 'delay_period']) {
    assert.throws(() => assertNoIbcState(host, clients, { connections: [{ ...local, [field]: 'changed' }] }, channels));
  }
});
