import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { smokeManifest, protocolParameters, fixtureHandler } from './image-smoke-fixture.mjs';

test('fixture serves only expected startup reads and records unexpected requests', async () => {
  const manifest = smokeManifest();
  const parameters = protocolParameters({ PlutusV1: [1], PlutusV2: [2], PlutusV3: [3] });
  const server = createServer(fixtureHandler(manifest, 'd87980', parameters));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const get = async path => {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const rpc = await fetch(origin + '/', { method: 'POST', body: JSON.stringify({
      jsonrpc: '2.0', id: 'request-1', method: 'queryLedgerState/protocolParameters',
    }) });
    assert.deepEqual(await rpc.json(), { jsonrpc: '2.0', id: 'request-1', result: parameters });
    const nft = manifest.host_state_nft;
    const byUnit = await get('/matches/' + nft.policy_id + '.' + nft.token_name + '?unspent');
    const byAddress = await get('/matches/' + manifest.validators.host_state_stt.address + '?unspent');
    assert.deepEqual(byUnit, byAddress);
    assert.equal(byUnit[0].value.assets[nft.policy_id + '.' + nft.token_name], '1');
    assert.deepEqual(await get('/datums/' + byUnit[0].datum_hash + '?inline'), { datum: 'd87980' });
    for (const name of ['spend_client', 'spend_connection', 'spend_channel']) {
      assert.deepEqual(await get('/matches/' + manifest.validators[name].address + '?unspent'), []);
    }
    const references = await get('/matches/*@' + manifest.validators.host_state_stt.ref_utxo.tx_hash + '?unspent');
    assert.equal(references.length, 22);
    assert.equal(new Set(references.map(ref => ref.output_index)).size, 22);
    for (const [path, method, body] of [
      ['/matches/*@unknown?unspent', 'GET'],
      ['/matches/unknown?unspent', 'GET'],
      ['/matches/' + manifest.validators.host_state_stt.address, 'GET'],
      ['/', 'POST', '{"method":"submitTransaction"}'],
      ['/', 'POST', 'not-json'],
    ]) {
      assert.equal((await fetch(origin + path, { method, body })).status, 501);
    }
    const observed = await get('/__smoke/status');
    assert.deepEqual({ ...observed, unexpected: observed.unexpected.length },
      { protocol: 1, references: 1, host: 2, datum: 1, entities: 3, unexpected: 5 });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('synthetic deployment contains mandatory startup identities without changing public manifests', () => {
  const manifest = smokeManifest();
  assert.equal(manifest.schema_version, 4);
  assert.equal(manifest.cardano.network_magic, 1);
  assert.ok(manifest.validators.spend_channel.ref_validator.prune_packet_history);
  assert.match(manifest.host_state_nft.policy_id, /^[0-9a-f]{56}$/);
  assert.equal(new Set(['host_state_stt', 'spend_client', 'spend_connection', 'spend_channel']
    .map(name => manifest.validators[name].address)).size, 4);
});

// Docker is mocked here. The release workflow invokes the same CLI with real Docker.
for (const component of ['gateway', 'hermes', 'swap-client']) {
  for (const fail of [false, true]) {
    test(component + ' orchestrator pins image ID, isolates networking and cleans up' + (fail ? ' after probe failure' : ''), async () => {
      const dir = await mkdtemp(join(tmpdir(), 'image-smoke-test-'));
      const log = join(dir, 'docker.log');
      const mock = String.raw`
#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\n');
const all = fs.readFileSync(process.env.MOCK_LOG, 'utf8').trim().split('\n').map(JSON.parse);
if (args[0] === 'image') console.log('sha256:' + 'a'.repeat(64));
if (args[0] === 'network' && args[1] === 'create') console.log('b'.repeat(64));
if (args[0] === 'create') console.log(all.filter(a => a[0] === 'create').length.toString(16).padStart(64, '0'));
if (args[0] === 'start' && args[1] === '--attach') {
  if (process.env.MOCK_FAIL === '1') process.exit(1);
  console.log('hermes 1.13.2');
}
if (args[0] === 'inspect') console.log(args[2].includes('ExitCode') ? '0' : 'true');
if (args[0] === 'exec' && args.includes('/tmp/image-smoke-probe.mjs')) {
  if (process.env.MOCK_FAIL === '1') process.exit(1);
  console.log('probe passed');
}
`;
      await writeFile(join(dir, 'docker'), mock.trimStart(), { mode: 0o755 });
      try {
        const child = spawn(process.execPath, [new URL('./image-smoke.mjs', import.meta.url).pathname, component, 'local:release'], {
          env: { ...process.env, PATH: dir + ':' + process.env.PATH, MOCK_LOG: log, MOCK_FAIL: fail ? '1' : '0' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', chunk => { output += chunk; });
        child.stderr.on('data', chunk => { output += chunk; });
        const [code] = await once(child, 'exit');
        assert.equal(code === 0, !fail, output);
        const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
        assert.ok(calls.some(args => args[0] === 'network' && args.includes('--internal')));
        const creates = calls.filter(args => args[0] === 'create');
        assert.ok(creates.every(args => args.includes('b'.repeat(64))));
        assert.ok(creates.every(args => args.includes('sha256:' + 'a'.repeat(64)) ||
          args.some(arg => arg.startsWith('docker.io/library/postgres:15@sha256:'))));
        const app = creates.find(args => args.some(arg => arg.endsWith('-app')));
        if (app) {
          assert.ok(!app.includes('--entrypoint'));
          assert.equal(app.at(-1), 'sha256:' + 'a'.repeat(64));
        }
        assert.equal(calls.filter(args => args[0] === 'rm').length, creates.length);
        assert.ok(calls.some(args => args[0] === 'network' && args[1] === 'rm' && args[2] === 'b'.repeat(64)));
        assert.ok(!calls.some(args => ['login', 'push', 'build', 'tag'].includes(args[0])));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
}
