const { spawnSync } = require('node:child_process');
const { existsSync, rmSync, statSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(dir, ...args) {
  const result = spawnSync(npm, args, { cwd: dir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function ensureInstalled(dir, executable) {
  const installedLock = path.join(dir, 'node_modules/.package-lock.json');
  const inputs = ['package.json', 'package-lock.json'].map((name) => path.join(dir, name));
  if (!existsSync(path.join(dir, 'node_modules/.bin', executable)) ||
      !existsSync(installedLock) ||
      inputs.some((input) => statSync(input).mtimeMs > statSync(installedLock).mtimeMs)) {
    run(dir, 'ci', '--include=dev');
  }
}

for (const [relative, output] of [
  ['proto-types', 'build'],
  ['packages/cardano-ibc-planner', 'dist'],
  ['packages/cardano-ibc-trace-registry', 'dist'],
  ['packages/cardano-ibc-tx-builder', 'dist'],
  ['packages/cardano-ibc-tx-builder-runtime', 'dist'],
]) {
  const dir = path.join(root, relative);
  ensureInstalled(dir, 'tsc');
  rmSync(path.join(dir, output), { recursive: true, force: true });
  run(dir, 'run', 'build');
}

ensureInstalled(path.join(root, 'cardano/gateway'), 'ts-node');
