const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(dir, ...args) {
  const result = spawnSync(npm, args, { cwd: dir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensureInstalled(dir, executable, toolchain, install = run) {
  const fingerprintFile = path.join(dir, 'node_modules/.dependency-fingerprint');
  const hash = createHash('sha256');
  hash.update(JSON.stringify(toolchain));
  for (const name of ['package.json', 'package-lock.json']) {
    hash.update('\0' + name + '\0');
    hash.update(readFileSync(path.join(dir, name)));
  }
  const fingerprint = hash.digest('hex');
  const installed = existsSync(fingerprintFile) ? readFileSync(fingerprintFile, 'utf8') : null;
  if (!existsSync(path.join(dir, 'node_modules/.bin', executable)) || installed !== fingerprint) {
    // A failed reinstall must not leave a stamp that could validate a partial install.
    rmSync(fingerprintFile, { force: true });
    install(dir, 'ci', '--include=dev');
    writeFileSync(fingerprintFile, fingerprint);
  }
}

function main() {
  const version = spawnSync(npm, ['--version'], { encoding: 'utf8' });
  if (version.error) throw version.error;
  if (version.status !== 0) process.exit(version.status ?? 1);
  const toolchain = { node: process.versions.node.split('.')[0], npm: version.stdout.trim(),
    platform: process.platform, arch: process.arch };

  for (const [relative, output] of [
    ['proto-types', 'build'],
    ['packages/cardano-ibc-planner', 'dist'],
    ['packages/cardano-ibc-trace-registry', 'dist'],
    ['packages/cardano-ibc-tx-builder', 'dist'],
    ['packages/cardano-ibc-tx-builder-runtime', 'dist'],
  ]) {
    const dir = path.join(root, relative);
    ensureInstalled(dir, 'tsc', toolchain);
    rmSync(path.join(dir, output), { recursive: true, force: true });
    run(dir, 'run', 'build');
  }

  ensureInstalled(path.join(root, 'cardano/gateway'), 'ts-node', toolchain);
}

if (require.main === module) main();
module.exports = { ensureInstalled };
