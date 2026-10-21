const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loopbackAddress } = require('./owned-runtime-providers.cjs');

test('restored counterparty checks use the selected compose ports in either syntax', () => {
  for (const ports of [
    ['127.0.0.1:20609:1317', '127.0.0.1:20608:26657'],
    [{ host_ip: '127.0.0.1', published: '20609', target: 1317 },
      { host_ip: '127.0.0.1', published: '20608', target: 26657 }],
  ]) {
    const config = { services: { cosmos: { ports } } };
    assert.equal(loopbackAddress(config, 'cosmos', 1317), '127.0.0.1:20609');
    assert.equal(loopbackAddress(config, 'cosmos', 26657), '127.0.0.1:20608');
  }
});

test('missing, ambiguous and public bindings cannot select a different provider', () => {
  for (const ports of [[], ['1527:1317'], ['0.0.0.0:1527:1317'],
    ['127.0.0.1:1527:1317', '127.0.0.1:20609:1317']]) {
    assert.throws(() => loopbackAddress({ services: { cosmos: { ports } } }, 'cosmos', 1317));
  }
});
