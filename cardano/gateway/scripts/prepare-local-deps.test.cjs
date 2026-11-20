const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync, utimesSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { ensureInstalled } = require('./prepare-local-deps.cjs');

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gateway-deps-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['package.json', 'package-lock.json']) writeFileSync(path.join(dir, name), '{}');
  let installs = 0;
  const toolchain = { node: '22', npm: '10.9.0', platform: 'linux', arch: 'x64' };
  const install = (cwd, ...args) => {
    assert.equal(cwd, dir);
    assert.deepEqual(args, ['ci', '--include=dev']);
    installs++;
    mkdirSync(path.join(dir, 'node_modules/.bin'), { recursive: true });
    writeFileSync(path.join(dir, 'node_modules/.bin/tsc'), 'compiler');
  };
  return { dir, toolchain, install, stamp: path.join(dir, 'node_modules/.dependency-fingerprint'),
    ensure: (versions = toolchain, installer = install) => ensureInstalled(dir, 'tsc', versions, installer),
    count: () => installs };
}

test('installs once and reuses unchanged dependencies despite timestamp changes', (t) => {
  const f = fixture(t);
  f.ensure();
  const future = new Date(Date.now() + 60000);
  utimesSync(path.join(f.dir, 'package.json'), future, future);
  f.ensure();
  assert.equal(f.count(), 1);
});

for (const file of ['package.json', 'package-lock.json']) {
  test(`reinstalls when ${file} changes with its timestamp preserved`, (t) => {
    const f = fixture(t);
    f.ensure();
    const input = path.join(f.dir, file);
    const before = statSync(input);
    const stamp = readFileSync(f.stamp, 'utf8');
    writeFileSync(input, '{"dependencies":{"example":"2.0.0"}}');
    utimesSync(input, before.atime, before.mtime);
    f.ensure();
    assert.equal(f.count(), 2);
    assert.notEqual(readFileSync(f.stamp, 'utf8'), stamp);
    f.ensure();
    assert.equal(f.count(), 2);
  });
}

for (const [key, value] of Object.entries({ node: '24', npm: '11.0.0', platform: 'darwin', arch: 'arm64' })) {
  test(`reinstalls when the ${key} toolchain identity changes`, (t) => {
    const f = fixture(t);
    f.ensure();
    f.ensure({ ...f.toolchain, [key]: value });
    assert.equal(f.count(), 2);
  });
}

test('reinstalls an existing installation without a fingerprint', (t) => {
  const f = fixture(t);
  f.install(f.dir, 'ci', '--include=dev');
  f.ensure();
  assert.equal(f.count(), 2);
  assert.ok(existsSync(f.stamp));
});

test('reinstalls if the required executable disappears', (t) => {
  const f = fixture(t);
  f.ensure();
  rmSync(path.join(f.dir, 'node_modules/.bin/tsc'));
  f.ensure();
  assert.equal(f.count(), 2);
});

test('a failed reinstall invalidates the old stamp and is retried', (t) => {
  const f = fixture(t);
  f.ensure();
  const input = path.join(f.dir, 'package.json');
  writeFileSync(input, '{"version":"2"}');
  assert.throws(() => f.ensure(f.toolchain, () => { throw new Error('install failed'); }), /install failed/);
  assert.equal(existsSync(f.stamp), false);
  // Even switching back to the previous manifest must retry the partial installation.
  writeFileSync(input, '{}');
  f.ensure();
  assert.equal(f.count(), 2);
});
