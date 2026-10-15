const { spawnSync } = require('node:child_process');
const { mkdirSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

if (process.env.CARDANO_CLIENT_PREPARER) {
  if (!existsSync(process.env.CARDANO_CLIENT_PREPARER)) throw new Error('Configured client preparer does not exist');
} else {
  const gateway = resolve(__dirname, '..');
  mkdirSync(resolve(gateway, 'bin'), { recursive: true });
  const result = spawnSync('go', ['build', '-trimpath', '-o', resolve(gateway, 'bin/prepare-client'), './cmd/prepare-client'], {
    cwd: resolve(gateway, '../../cosmos/cardano-probabilistic-light-client-v8'),
    env: { ...process.env, GOWORK: 'off', CGO_ENABLED: '0' }, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
