import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const script = path.join(root, 'scripts/ci/check-light-client-parity.mjs');
function check(mutate) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'light-client-boundaries-'));
  try {
    for (const suffix of ['core', 'v8', 'v10']) {
      const relative = `cosmos/cardano-probabilistic-light-client-${suffix}`;
      fs.cpSync(path.join(root, relative), path.join(fixture, relative), { recursive: true });
    }
    mutate?.(fixture);
    return spawnSync(process.execPath, [script], { cwd: fixture, encoding: 'utf8' });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}
test('current adapters satisfy the boundary guard', () => {
  const result = check();
  assert.equal(result.status, 0, result.stderr);
});
test('copying state logic into both adapters still fails parity CI', () => {
  const result = check(dir => {
    for (const version of ['v8', 'v10']) {
      fs.appendFileSync(path.join(dir, `cosmos/cardano-probabilistic-light-client-${version}/state_machine.go`), '\nfunc verifyBridgeContinuity() {}\n');
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /shared state-machine logic|thin adapter budget/);
});
test('new handwritten adapter files require boundary review', () => {
  const result = check(dir => {
    for (const version of ['v8', 'v10']) {
      fs.writeFileSync(path.join(dir, `cosmos/cardano-probabilistic-light-client-${version}/new_logic.go`), 'package probabilistic\n');
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /file inventory/);
});
test('core cannot acquire a version-specific SDK dependency', () => {
  const result = check(dir => {
    fs.writeFileSync(path.join(dir, 'cosmos/cardano-probabilistic-light-client-core/state/sdk.go'), 'package state\nimport _ "github.com/cosmos/cosmos-sdk/types"\n');
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /depend on an IBC or SDK version/);
});
test('adapter growth requires an explicit budget review', () => {
  const result = check(dir => {
    for (const version of ['v8', 'v10']) {
      fs.appendFileSync(path.join(dir, `cosmos/cardano-probabilistic-light-client-${version}/state_machine.go`), '\n// new adapter code'.repeat(100));
    }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /thin adapter budget/);
});
