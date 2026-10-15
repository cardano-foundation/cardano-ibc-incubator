const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loopbackAddress } = require('./owned-runtime-providers.cjs');

test('provider selection binds the requested service to its owned loopback port', () => {
  const binding = { target: 1337, published: '49152', host_ip: '127.0.0.1' };
  const runtime = ports => ({ services: { devkit: { ports } } });
  assert.equal(loopbackAddress(runtime([binding]), 'devkit', 1337), '127.0.0.1:49152');
  for (const ports of [[], [binding, binding], [{ ...binding, host_ip: '0.0.0.0' }],
    [{ ...binding, target: 1442 }], [{ ...binding, published: 0 }],
    [{ ...binding, published: 65536 }], [{ ...binding, published: 'invalid' }]]) {
    assert.throws(() => loopbackAddress(runtime(ports), 'devkit', 1337));
  }
});
