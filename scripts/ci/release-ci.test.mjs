import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { requireSuccessfulMainCI } from './release-ci.mjs';

const sha = 'a'.repeat(40);
const successful = {
  id: 10, head_sha: sha, head_branch: 'main', event: 'push',
  path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success',
  html_url: 'https://github.com/example/repo/actions/runs/10',
};
const check = (...runs) => requireSuccessfulMainCI([{ workflow_runs: runs }], sha);

test('accepts successful main CI for the exact release commit', () => {
  assert.equal(check(successful), successful);
});

for (const override of [
  { head_sha: 'b'.repeat(40) }, { head_branch: 'feature' }, { event: 'pull_request' },
  { event: 'workflow_dispatch' }, { path: '.github/workflows/other.yml' },
  { status: 'in_progress', conclusion: null }, { status: 'queued', conclusion: null },
  ...['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required'].map((conclusion) => ({ conclusion })),
]) {
  test(`blocks CI with ${JSON.stringify(override)}`, () => {
    assert.throws(() => check({ ...successful, ...override }), /must complete successfully/);
  });
}

test('blocks absent or malformed CI results', () => {
  assert.throws(() => check(), /No matching run found/);
  assert.throws(() => requireSuccessfulMainCI({}, sha), /Invalid CI run response/);
  assert.throws(() => requireSuccessfulMainCI([{}], sha), /Invalid CI run response/);
});

test('a newer failed or pending run cannot reuse an older success', () => {
  for (const override of [{ conclusion: 'failure' }, { status: 'in_progress', conclusion: null }]) {
    assert.throws(() => check(successful, { ...successful, id: 11, ...override }), /must complete successfully/);
  }
});

test('uses the newest matching run across all API pages', () => {
  assert.equal(requireSuccessfulMainCI([
    { workflow_runs: [{ ...successful, id: 9, conclusion: 'failure' }] },
    { workflow_runs: [successful] },
  ], sha), successful);
});

for (const failure of ['ancestry', 'api', 'none']) {
  test(`CLI ${failure === 'none' ? 'accepts verified CI' : `fails closed on ${failure} errors`}`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'release-ci-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const log = join(directory, 'commands.jsonl');
    const mock = `#!/usr/bin/env node
const fs = require('node:fs');
const command = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify([command, ...args]) + '\\n');
if (command === 'git' && args[0] === 'rev-parse') {
  console.log(process.env.MOCK_SHA);
} else if (command === 'git' && args[0] === 'merge-base') {
  if (process.env.MOCK_FAILURE === 'ancestry') {
    console.error('mock ancestry failure');
    process.exit(1);
  }
} else if (command === 'gh' && args[0] === 'api') {
  if (process.env.MOCK_FAILURE === 'api') {
    console.error('mock API unavailable');
    process.exit(1);
  }
  console.log(process.env.MOCK_RUNS);
} else { process.exit(99); }
`;
    for (const command of ['git', 'gh']) {
      writeFileSync(join(directory, command), mock, { mode: 0o755 });
    }
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./release-ci.mjs', import.meta.url))], {
      encoding: 'utf8',
      env: {
        PATH: [directory, dirname(process.execPath)].join(delimiter),
        GITHUB_REPOSITORY: 'example/repo', MOCK_LOG: log, MOCK_SHA: sha,
        MOCK_FAILURE: failure, MOCK_RUNS: JSON.stringify([{ workflow_runs: [successful] }]),
      },
    });
    assert.equal(result.status, failure === 'none' ? 0 : 1, result.stderr);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.slice(0, 2), [
      ['git', 'rev-parse', 'HEAD'],
      ['git', 'merge-base', '--is-ancestor', sha, 'refs/remotes/origin/main'],
    ]);
    assert.equal(calls.length, failure === 'ancestry' ? 2 : 3);
    if (failure === 'none') assert.match(result.stdout, /Release commit passed main CI/);
    else assert.doesNotMatch(result.stdout, /Release commit passed main CI/);
    if (failure !== 'ancestry') {
      assert.deepEqual(calls[2], ['gh', 'api', '--method', 'GET', '--paginate', '--slurp',
        'repos/example/repo/actions/workflows/ci.yml/runs', '-f', `head_sha=${sha}`,
        '-f', 'branch=main', '-f', 'event=push', '-f', 'per_page=100']);
    }
  });
}
