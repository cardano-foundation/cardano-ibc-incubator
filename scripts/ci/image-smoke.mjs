import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

// Usage: node scripts/ci/image-smoke.mjs gateway|hermes|swap-client LOCAL_IMAGE
// No chain services, registry credentials or application source are mounted.
const [component, image] = process.argv.slice(2);
assert.ok(['gateway', 'hermes', 'swap-client'].includes(component) && image,
  'Usage: image-smoke.mjs gateway|hermes|swap-client LOCAL_IMAGE');
const execute = promisify(execFile);
const docker = async (...args) => (await execute('docker', args, {
  encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024,
})).stdout.trim();
const imageId = await docker('image', 'inspect', '--format', '{{.Id}}', image);
assert.match(imageId, /^sha256:[0-9a-f]{64}$/);
const temporary = await mkdtemp(join(tmpdir(), 'ibc-image-smoke-'));
const name = 'ibc-smoke-' + temporary.split('ibc-image-smoke-').at(-1).toLowerCase();
const scripts = dirname(fileURLToPath(import.meta.url));
const containers = [];
let networkId;
let cleaning;
async function cleanup() {
  if (cleaning) return cleaning;
  cleaning = (async () => {
    for (const id of [...containers].reverse()) {
      await docker('rm', '--force', '--volumes', id).catch(error => console.error(error.message));
    }
    if (networkId) await docker('network', 'rm', networkId).catch(error => console.error(error.message));
    await rm(temporary, { recursive: true, force: true });
  })();
  return cleaning;
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await cleanup(); process.exit(1); });
}
async function create(label, args, targetImage = imageId, command = []) {
  const id = await docker('create', '--name', name + '-' + label, '--network', networkId,
    ...args, targetImage, ...command);
  assert.match(id, /^[0-9a-f]{64}$/);
  containers.push(id);
  return id;
}
async function waitFor(check, label) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await check(); return; } catch { await delay(500); }
  }
  throw new Error(label + ' did not become ready');
}
try {
  networkId = await docker('network', 'create', '--internal', name);
  assert.match(networkId, /^[0-9a-f]{64}$/);
  if (component === 'hermes') {
    const version = await create('version', [], imageId, ['--version']);
    assert.match(await docker('start', '--attach', version), /hermes/i);
    assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', version), '0');
    const config = join(temporary, 'hermes.toml');
    await writeFile(config, 'chains = []\n[global]\nlog_level = "info"\n');
    const validate = await create('config', [], imageId, ['--config', '/tmp/smoke.toml', 'config', 'validate']);
    await docker('cp', config, validate + ':/tmp/smoke.toml');
    await docker('start', '--attach', validate);
    assert.equal(await docker('inspect', '--format', '{{.State.ExitCode}}', validate), '0');
  } else {
    let app;
    if (component === 'gateway') {
      // Official postgres:15 multi-platform index, resolved 2026-09-08.
      const postgres = 'docker.io/library/postgres:15@sha256:9b1d34adbce1dd07ee6e94b4a2cf698884b89bd44a6c9c12f5da8f3acbfe4957';
      await docker('pull', postgres);
      const db = await create('db', ['--network-alias', 'db',
        '-e', 'POSTGRES_USER=smoke', '-e', 'POSTGRES_PASSWORD=smoke-only',
        '-e', 'POSTGRES_DB=gateway'], postgres);
      await docker('start', db);
      await waitFor(() => docker('exec', db, 'pg_isready', '-h', '127.0.0.1', '-U', 'smoke', '-d', 'gateway'), 'Postgres');
      await docker('exec', db, 'createdb', '-U', 'smoke', 'history');
      const fixture = await create('fixture', ['--network-alias', 'fixture',
        '--entrypoint', 'node'], imageId, ['/tmp/image-smoke-fixture.mjs']);
      await docker('cp', join(scripts, 'image-smoke-fixture.mjs'), fixture + ':/tmp/image-smoke-fixture.mjs');
      await docker('start', fixture);
      await waitFor(() => docker('exec', fixture, 'node', '-e',
        "fetch('http://127.0.0.1:8080/__smoke/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"), 'Gateway fixtures');
      const manifest = join(temporary, 'manifest.json');
      await docker('cp', fixture + ':/tmp/image-smoke-manifest.json', manifest);
      const env = {
        BRIDGE_MANIFEST_PATH: '/tmp/image-smoke-manifest.json',
        CARDANO_NETWORK_MAGIC: '1', IBC_TREE_CACHE_ENABLED: 'false', PORT: '8000',
        OGMIOS_ENDPOINT: 'http://fixture:8080', KUPO_ENDPOINT: 'http://fixture:8080',
        YACI_STORE_ENDPOINT: 'http://fixture:8080', MITHRIL_ENDPOINT: 'http://fixture:8080',
        GATEWAY_DB_HOST: 'db', GATEWAY_DB_PORT: '5432', GATEWAY_DB_USERNAME: 'smoke',
        GATEWAY_DB_PASSWORD: 'smoke-only', GATEWAY_DB_NAME: 'gateway',
        HISTORY_DB_HOST: 'db', HISTORY_DB_PORT: '5432', HISTORY_DB_USERNAME: 'smoke',
        HISTORY_DB_PASSWORD: 'smoke-only', HISTORY_DB_NAME: 'history',
      };
      app = await create('app', Object.entries(env).flatMap(([key, value]) => ['-e', key + '=' + value]));
      await docker('cp', manifest, app + ':/tmp/image-smoke-manifest.json');
    } else {
      const env = {
        NEXT_PUBLIC_IBC_SWAP_MODE: 'testnet', NEXT_PUBLIC_CARDANO_NETWORK: 'preview',
        NEXT_PUBLIC_CARDANO_CHAIN_ID: '2', NEXT_PUBLIC_CARDANO_IBC_CHAIN_ID: 'cardano-preview',
        NEXT_PUBLIC_CARDANO_BRIDGE_MANIFEST_URL: 'https://example.invalid/manifest.json',
        IBC_SWAP_KUPMIOS_INTERNAL_URL: 'https://kupo.example.invalid,https://ogmios.example.invalid',
      };
      app = await create('app', Object.entries(env).flatMap(([key, value]) => ['-e', key + '=' + value]));
    }
    // No entrypoint/CMD overrides for either application under test.
    await docker('cp', join(scripts, 'image-smoke-probe.mjs'), app + ':/tmp/image-smoke-probe.mjs');
    await docker('start', app);
    console.log(await docker('exec', app, 'node', '/tmp/image-smoke-probe.mjs', component));
    assert.equal(await docker('inspect', '--format', '{{.State.Running}}', app), 'true');
  }
  console.log('Smoke-tested immutable local image ' + imageId);
} catch (error) {
  for (const id of containers) {
    const logs = await execute('docker', ['logs', '--tail', '100', id], { encoding: 'utf8', timeout: 10000 })
      .then(({ stdout, stderr }) => stdout + stderr).catch(() => 'Logs unavailable');
    console.error('Container ' + id + '\n' + logs);
  }
  throw error;
} finally {
  await cleanup();
}
