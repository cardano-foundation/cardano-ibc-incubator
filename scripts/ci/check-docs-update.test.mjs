import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkDocsUpdate, onlyMarkdownChanged } from './check-docs-update.mjs';

function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'docs-update-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'ci@example.com');
  git('config', 'user.name', 'CI');
  const commit = () => {
    git('add', '.');
    git('commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  writeFileSync(join(repo, 'README.md'), 'before\n');
  writeFileSync(join(repo, 'code.js'), 'code\n');
  const before = commit();
  writeFileSync(join(repo, 'README.md'), 'after\n');
  const after = commit();
  const workflow = '.github/workflows/ci.yml';
  const event = { action: 'synchronize', number: 796, before, after, pull_request: { base: { sha: before }, head: { sha: after } } };
  const run = {
    id: 123, path: workflow, head_sha: before, event: 'pull_request',
    status: 'completed', conclusion: 'success', run_attempt: 2,
    pull_requests: [{ number: 796, base: { sha: before } }],
  };
  const job = {
    status: 'completed', conclusion: 'success', run_attempt: 2,
    steps: [{ name: `Attest workflow base ${before}`, status: 'completed', conclusion: 'success' }],
  };
  const options = {
    repo, workflow, eventName: 'pull_request', event,
    api: async (path) => path.endsWith('/runs') ? [{ workflow_runs: [run] }] : [{ jobs: [job] }],
  };
  return { repo, git, commit, before, after, run, job, options };
}

test('recognizes Markdown additions, edits and deletions, but not source renames', (t) => {
  const f = fixture(t);
  assert.equal(onlyMarkdownChanged(f.repo, f.before, f.after), true);
  rmSync(join(f.repo, 'README.md'));
  writeFileSync(join(f.repo, 'NOTES.md'), 'new\n');
  assert.equal(onlyMarkdownChanged(f.repo, f.after, f.commit()), true);
  f.git('mv', 'code.js', 'CODE.md');
  assert.equal(onlyMarkdownChanged(f.repo, f.after, f.commit()), false);
});

test('rejects executable Markdown, symlinks, mixed edits and empty updates', (t) => {
  const f = fixture(t);
  assert.equal(onlyMarkdownChanged(f.repo, f.after, f.after), false);
  chmodSync(join(f.repo, 'README.md'), 0o755);
  assert.equal(onlyMarkdownChanged(f.repo, f.after, f.commit()), false);
  rmSync(join(f.repo, 'README.md'));
  symlinkSync('code.js', join(f.repo, 'README.md'));
  assert.equal(onlyMarkdownChanged(f.repo, f.after, f.commit()), false);
  writeFileSync(join(f.repo, 'code.js'), 'changed\n');
  assert.equal(onlyMarkdownChanged(f.repo, f.after, f.commit()), false);
});

test('reuses only a successful matching workflow with recorded base and attempt', async (t) => {
  const f = fixture(t);
  assert.equal((await checkDocsUpdate(f.options)).runJobs, false);
  for (const change of [
    { status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' },
    { path: '.github/workflows/publish.yaml' }, { head_sha: f.after },
    { pull_requests: [] }, { run_attempt: 3 }, { run_attempt: undefined },
  ]) {
    const saved = { ...f.run };
    Object.assign(f.run, change);
    assert.equal((await checkDocsUpdate(f.options)).runJobs, true, JSON.stringify(change));
    Object.assign(f.run, saved);
  }
  f.job.steps[0].conclusion = 'failure';
  assert.equal((await checkDocsUpdate(f.options)).runJobs, true);
  f.job.steps = [];
  assert.equal((await checkDocsUpdate(f.options)).runJobs, true);
});

test('base changes cannot be hidden by mutable PR metadata on the previous run', async (t) => {
  const f = fixture(t);
  f.options.event.pull_request.base.sha = f.after;
  f.run.pull_requests[0].base.sha = f.after;
  assert.equal((await checkDocsUpdate(f.options)).runJobs, true);
});

test('reads every job page and rejects missing, duplicate or unreadable evidence', async (t) => {
  const f = fixture(t);
  f.options.api = async (path) => path.endsWith('/runs')
    ? [{ workflow_runs: [] }, { workflow_runs: [f.run] }]
    : [{ jobs: Array.from({ length: 100 }, () => ({ steps: [] })) }, { jobs: [f.job] }];
  assert.equal((await checkDocsUpdate(f.options)).runJobs, false);
  for (const runs of [[], [f.run, f.run]]) {
    f.options.api = async () => [{ workflow_runs: runs }];
    assert.equal((await checkDocsUpdate(f.options)).runJobs, true);
  }
  f.options.api = async () => { throw new Error('API unavailable'); };
  assert.equal((await checkDocsUpdate(f.options)).runJobs, true);
});

test('runs on code changes, force-pushes, new PRs, pushes and manual runs', async (t) => {
  const f = fixture(t);
  f.options.api = async () => assert.fail('GitHub evidence should not be requested');
  for (const eventName of ['push', 'workflow_dispatch']) {
    assert.equal((await checkDocsUpdate({ ...f.options, eventName })).runJobs, true);
  }
  assert.equal((await checkDocsUpdate({ ...f.options, event: { ...f.options.event, action: 'opened' } })).runJobs, true);
  f.options.event.before = f.after;
  f.options.event.after = f.before;
  f.options.event.pull_request.head.sha = f.before;
  assert.equal((await checkDocsUpdate(f.options)).runJobs, true);
  writeFileSync(join(f.repo, 'code.js'), 'changed\n');
  f.options.event.before = f.after;
  f.options.event.after = f.commit();
  f.options.event.pull_request.head.sha = f.options.event.after;
  assert.equal((await checkDocsUpdate(f.options)).runJobs, true);
});

test('all CI builds and PR packaging jobs depend on the documentation gate', () => {
  for (const [workflow, selected] of [
    ['ci.yml', null], ['publish.yaml', ['pull-request-build']],
    ['gateway-image.yml', ['pull-request-build']], ['npm-packages.yml', ['package']],
  ]) {
    const source = readFileSync(new URL(`../../.github/workflows/${workflow}`, import.meta.url), 'utf8');
    const jobs = source.slice(source.indexOf('\njobs:\n')).split(/(?=^  [\w-]+:\n)/m);
    for (const block of jobs) {
      const name = block.match(/^  ([\w-]+):/m)?.[1];
      if (!name || ['docs-update', 'docs-branch-guard', 'aiken'].includes(name) || selected && !selected.includes(name)) continue;
      assert.match(block, /needs:.*docs-update/, `${workflow}: ${name}`);
      assert.match(block, /if:.*needs\.docs-update\.outputs\.run_jobs == 'true'/, `${workflow}: ${name}`);
    }
  }
});
