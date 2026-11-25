import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { checkBridgeManifests } from './check-repo-invariants.mjs';

const preview = 'manifests/preview/cardano-preview-bridge-manifest.json';

function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'repo-invariants-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: repo, stdio: 'pipe' });
  const write = (path, content, { track = true } = {}) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), typeof content === 'string' ? content : JSON.stringify(content));
    if (track) execFileSync('git', ['add', '--', path], { cwd: repo, stdio: 'pipe' });
  };
  const manifest = {
    schema_version: 6,
    deployment_id: 'cardano-preview:policy.token',
    cardano: { chain_id: 'cardano-preview', network_magic: 2, network: 'Preview' },
    validators: {},
    host_state_nft: { policy_id: 'policy', token_name: 'token' },
  };
  return { repo, write, manifest, check: () => checkBridgeManifests(repo) };
}

test('accepts a valid Preview manifest and ignores untracked deployment output', (t) => {
  const f = fixture(t);
  f.write(preview, f.manifest);
  f.write('cardano/gateway/fixtures/manifest.json', { chain_id: 'fixture', schema_version: 1 });
  f.write('cardano/offchain/deployments/bridge-manifest.json', '{', { track: false });
  assert.deepEqual(f.check(), []);
});

test('requires the Preview manifest', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.check(), [`${preview}: required bridge manifest is not committed`]);
});

test('fails on committed manifests that cannot be read or parsed', (t) => {
  const f = fixture(t);
  f.write(preview, '{"schema_version": 6,');
  f.write('chains/example/deployment.json', 'not json');
  f.write('cardano/missing/manifest.json', {});
  rmSync(join(f.repo, 'cardano/missing/manifest.json'));
  assert.deepEqual(f.check().map((failure) => failure.replace(/ \(.*\)$/, '')), [
    'cardano/missing/manifest.json: could not be read',
    'chains/example/deployment.json: invalid JSON',
    `${preview}: invalid JSON`,
  ]);
});

test('fails when identifying fields are missing', (t) => {
  for (const [field, message] of [
    ['chain_id', 'cardano.chain_id must be a non-empty string'],
    ['network_magic', 'cardano.network_magic must be a non-negative integer'],
  ]) {
    const f = fixture(t);
    delete f.manifest.cardano[field];
    f.write(preview, f.manifest);
    assert.deepEqual(f.check(), [`${preview}: ${message}`]);
  }
});

test('fails when the network magic does not match the manifest directory', (t) => {
  const f = fixture(t);
  f.manifest.cardano.network_magic = 1;
  f.write(preview, f.manifest);
  assert.deepEqual(f.check(), [`${preview}: preview manifests must use network_magic 2, found 1`]);
});

test('fails on misnamed bridge manifests under manifests/', (t) => {
  for (const path of ['manifests/preview/bridge-manifest.json', 'manifests/preprod/cardano-preview-bridge-manifest.json']) {
    const f = fixture(t);
    f.write(preview, f.manifest);
    f.write(path, f.manifest);
    assert.deepEqual(f.check(), [
      `${path}: bridge manifests must be named manifests/<network>/cardano-<network>-bridge-manifest.json`,
    ]);
  }
});
