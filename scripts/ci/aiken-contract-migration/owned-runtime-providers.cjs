const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

function loopbackAddress(config, service, target) {
  const bindings = config.services[service].ports.filter(port =>
    typeof port === 'object' && Number(port.target) === target);
  assert.equal(bindings.length, 1, `Expected one ${service}:${target} binding`);
  const binding = bindings[0];
  assert.equal(binding.host_ip, '127.0.0.1', 'Owned providers must bind on loopback');
  const published = Number(binding.published);
  assert.ok(Number.isInteger(published) && published > 0 && published <= 65535, 'Invalid provider port');
  return `127.0.0.1:${published}`;
}

function ownedRuntimeProviders(runtimeArg, counterparty = false) {
  const root = path.resolve(__dirname, '../../..');
  const runtime = fs.realpathSync(runtimeArg);
  assert.ok(runtime.startsWith(path.join(root, '.deployment-smoke') + path.sep), 'Owned runtime required');
  const result = JSON.parse(fs.readFileSync(path.join(runtime, 'result.json'), 'utf8'));
  assert.match(result.project, /^cardano-deployment-test-[a-z0-9]+$/);
  assert.equal(result.networkRuntime, runtime, 'Runtime provenance mismatch');
  const config = JSON.parse(fs.readFileSync(path.join(runtime, 'compose.json'), 'utf8'));
  const docker = args => execFileSync('docker', ['compose', '-p', result.project, '-f',
    path.join(runtime, 'compose.json'), ...args], { encoding: 'utf8', timeout: 30000 });
  /** @type {Record<string, string>} */
  const providers = {};
  for (const [name, service, target] of [['ogmios', 'devkit', 1337], ['kupo', 'devkit', 1442],
    ['node', 'devkit', 3001], ['history', 'history', 8080], ['historyDb', 'history-db', 5432]]) {
    const address = loopbackAddress(config, service, target);
    assert.equal(docker(['port', service, String(target)]).trim(), address, 'Actual provider binding differs from selected runtime');
    providers[name] = address;
  }
  if (counterparty) {
    for (const [target, port] of [[26657, 28757], [1317, 1527]]) {
      assert.equal(docker(['port', 'cosmos', String(target)]).trim(), `127.0.0.1:${port}`, 'Counterparty runtime mismatch');
    }
  }
  const genesis = fs.readFileSync(path.join(runtime, 'runtime/genesis-shelley.json'), 'utf8');
  assert.equal(docker(['exec', '-T', 'devkit', 'cat', '/clusters/nodes/default/node/genesis/shelley-genesis.json']), genesis,
    'Actual provider genesis mismatch');
  assert.equal(JSON.parse(genesis).networkMagic, 42, 'Owned magic-42 network required');
  return { kupo: providers.kupo, ogmios: providers.ogmios, node: providers.node,
    history: providers.history, historyDb: providers.historyDb,
    genesisSha256: createHash('sha256').update(genesis).digest('hex') };
}

module.exports = { loopbackAddress, ownedRuntimeProviders };
