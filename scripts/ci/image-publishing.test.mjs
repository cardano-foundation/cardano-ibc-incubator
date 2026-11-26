import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const workflow = readFileSync(new URL('../../.github/workflows/publish.yaml', import.meta.url), 'utf8');
const build = readFileSync(new URL('../../.github/workflows/build-image.yaml', import.meta.url), 'utf8');
const registryStep = build.split('      - name: Select registry credentials before login\n')[1]
  .split('\n      - name:')[0].split('        run: |\n')[1]
  .split('\n').map((line) => line.replace(/^          /, '')).join('\n');

function jobCondition(job) {
  return job.match(/^    if: (.+)$/m)[1]
    .replace(/^\$\{\{\s*|\s*\}\}$/g, '')
    .replace(/needs\.([a-z-]+)/g, "needs['$1']");
}

function selectRegistries(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'image-credentials-'));
  const output = join(directory, 'output');
  try {
    const result = spawnSync('bash', ['-euo', 'pipefail', '-c', registryStep], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_REF_TYPE: 'branch',
        PUBLISH: 'true',
        PRIVATE_REGISTRY: 'registry.example.test',
        REGISTRIES: 'ghcr.io/example docker.io/example registry.example.test/team registry.example.test.evil/team',
        ...overrides,
      },
    });
    return { ...result, output: result.status === 0 ? readFileSync(output, 'utf8').trim() : '' };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('PRs select only the configured private host before baseline login', () => {
  const result = selectRegistries();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'registries= registry.example.test/team');
  assert.ok(build.indexOf('id: registries') < build.indexOf('id: baseline'));
  assert.match(build, /DOCKER_REGISTRIES: \$\{\{ steps\.registries\.outputs\.registries \}\}/);
});

test('fork and Dependabot build-only mode supplies no login destinations', () => {
  const result = selectRegistries({ PUBLISH: 'false' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'registries=');
  assert.match(build, /earthly "\+\$\{COMPONENT\}" --PUSH=false/);
  assert.match(build, /name: Publish tested image\n        if: inputs.publish/);
});

test('releases retain every configured registry', () => {
  const result = selectRegistries({ GITHUB_REF_TYPE: 'tag', REGISTRIES: 'ghcr.io/example docker.io/example registry.example.test/team' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'registries=ghcr.io/example docker.io/example registry.example.test/team');
});

for (const host of ['', 'ghcr.io', 'docker.io', 'hub.docker.com']) {
  test(`PR publishing rejects invalid private host ${JSON.stringify(host)}`, () => {
    assert.notEqual(selectRegistries({ PRIVATE_REGISTRY: host }).status, 0);
  });
}

test('publishing fails when no matching destination is configured', () => {
  assert.notEqual(selectRegistries({ REGISTRIES: 'ghcr.io/example' }).status, 0);
  assert.notEqual(selectRegistries({ GITHUB_REF_TYPE: 'tag', REGISTRIES: '' }).status, 0);
});

test('branch callers have no package writes or public registry credentials', () => {
  const branch = workflow.split('  pr-images:\n')[1].split('  release-images:\n')[0];
  assert.doesNotMatch(branch, /packages:|HUB_DOCKER_COM|secrets: inherit/);
  assert.match(branch, /permissions:\n      contents: read\n/);
  assert.doesNotMatch(build, /^\s+permissions:/m);
  const condition = jobCondition(branch);
  const publish = branch.match(/^      publish: \$\{\{ (.+) \}\}$/m)[1];
  const secrets = Object.fromEntries([...branch.matchAll(/^      (\w+): \$\{\{ (.+secrets\..+) \}\}$/gm)]
    .map((match) => [match[1], match[2]]));
  assert.deepEqual(Object.keys(secrets).sort(), ['DOCKER_REGISTRIES', 'PRIVATE_DOCKER_REGISTRY_PASS', 'PRIVATE_DOCKER_REGISTRY_URL']);
  const privateSecrets = {
    DOCKER_REGISTRIES: 'registry.example.test/team',
    GITLAB_DOCKER_REGISTRY_URL: 'registry.example.test',
    GITLAB_PKG_REGISTRY_TOKEN: 'fixture-private-token',
  };
  const cases = [
    ['merged main', 'push', 'refs/heads/main', '', 'maintainer', true, true],
    ['same-repository PR', 'pull_request', 'refs/pull/1/merge', 'example/repo', 'maintainer', true, true],
    ['fork PR', 'pull_request', 'refs/pull/1/merge', 'outsider/repo', 'maintainer', true, false],
    ['Dependabot PR', 'pull_request', 'refs/pull/1/merge', 'example/repo', 'dependabot[bot]', true, false],
    ['other branch', 'push', 'refs/heads/topic', '', 'maintainer', false, false],
    ['release tag', 'push', 'refs/tags/gateway/v2.0.2', '', 'maintainer', false, false],
  ];
  for (const [name, event, ref, sourceRepo, actor, builds, publishes] of cases) {
    const context = {
      github: { event_name: event, ref, actor, repository: 'example/repo',
        event: { pull_request: { head: { repo: { full_name: sourceRepo } } } } },
      secrets: privateSecrets,
      cancelled: () => false,
      needs: { 'select-components': { result: 'success' } },
    };
    // These workflow guards use the same boolean and string operators as JavaScript.
    assert.equal(runInNewContext(condition, context), builds, name);
    assert.equal(runInNewContext(publish, context), publishes, name);
    for (const [key, expression] of Object.entries(secrets)) {
      const expected = publishes ? privateSecrets[expression.match(/secrets\.(\w+)/)[1]] : '';
      assert.equal(runInNewContext(expression, context), expected, `${name}: ${key}`);
    }
  }
});

test('publishing conditions allow skipped docs but block unsuccessful inputs and cancellation', () => {
  for (const [name, dependency, ref, refType] of [
    ['pr-images', 'select-components', 'refs/heads/main', 'branch'],
    ['release-images', 'select-components', 'refs/tags/gateway/v2.0.2', 'tag'],
    ['gateway-release', 'release-images', 'refs/tags/gateway/v2.0.2', 'tag'],
  ]) {
    const job = workflow.split(`  ${name}:\n`)[1].split(/\n  [a-z-]+:\n/)[0];
    const condition = jobCondition(job);
    // Without a status function GitHub inserts success(), which rejects skipped ancestors.
    assert.match(condition, /!cancelled\(\)/);
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const isCancelled of [false, true]) {
        const context = {
          github: { event_name: 'push', ref, ref_type: refType, ref_name: 'gateway/v2.0.2' },
          needs: { 'docs-update': { result: 'skipped' }, [dependency]: { result } },
          cancelled: () => isCancelled,
          startsWith: (value, prefix) => value.startsWith(prefix),
        };
        assert.equal(runInNewContext(condition, context), result === 'success' && !isCancelled,
          `${name}: ${result}, cancelled=${isCancelled}`);
      }
    }
  }
});

const componentStep = workflow.split('        id: select\n')[1].split('        run: |\n')[1]
  .split('\n  pr-images:')[0].split('\n').map(line => line.replace(/^          /, '')).join('\n');

for (const event of ['push', 'pull_request']) {
  for (const change of ['gateway', 'relayer', 'workflow']) {
    test(`${event} selects Hermes only when its pin or build inputs change: ${change}`, () => {
      const directory = mkdtempSync(join(tmpdir(), 'image-components-'));
      try {
        const git = (...args) => {
          const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
          assert.equal(result.status, 0, result.stderr);
          return result.stdout.trim();
        };
        const commit = () => git('-c', 'user.name=Image test', '-c', 'user.email=image@example.invalid',
          'commit', '--allow-empty', '-qm', 'fixture');
        git('init', '-q');
        commit();
        const originalPin = git('rev-parse', 'HEAD');
        git('update-index', '--add', '--cacheinfo', `160000,${originalPin},relayer`);
        commit();
        const base = git('rev-parse', 'HEAD');
        if (change === 'relayer') {
          git('update-index', '--cacheinfo', `160000,${base},relayer`);
        } else {
          const path = change === 'gateway' ? 'cardano/gateway/src/test.ts' : '.github/workflows/publish.yaml';
          mkdirSync(dirname(join(directory, path)), { recursive: true });
          writeFileSync(join(directory, path), 'changed');
          git('add', '--', path);
        }
        commit();
        const output = join(directory, 'output');
        const result = spawnSync('bash', ['-euo', 'pipefail', '-c', componentStep], {
          cwd: directory, encoding: 'utf8',
          env: { PATH: process.env.PATH, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: event,
            REF_TYPE: 'branch', REF_NAME: 'main', DIFF_BASE_SHA: base, DIFF_HEAD_SHA: git('rev-parse', 'HEAD') },
        });
        assert.equal(result.status, 0, result.stderr);
        const images = JSON.parse(readFileSync(output, 'utf8').trim().slice('images='.length));
        assert.deepEqual(images.map(image => image.component), change === 'gateway'
          ? ['gateway', 'swap-client'] : ['gateway', 'hermes', 'swap-client']);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
}

test('main pushes enable image selection even when the PR documentation job is skipped', () => {
  assert.match(workflow, /push:\n    branches: \[main\]/);
  const selection = workflow.split('  select-components:\n')[1].split('    needs:')[0];
  const condition = selection.match(/if: \$\{\{ (.+) \}\}/)[1];
  const context = {
    cancelled: () => false, startsWith: (value, prefix) => value.startsWith(prefix),
    github: { event_name: 'push', ref_type: 'branch', ref: 'refs/heads/main' },
    needs: { 'image-metadata': { result: 'success' }, 'docs-update': { result: 'skipped', outputs: {} } },
  };
  // GitHub permits hyphens in property names. Use bracket access for this evaluation.
  const expression = condition.replaceAll('needs.image-metadata', "needs['image-metadata']")
    .replaceAll('needs.docs-update', "needs['docs-update']");
  assert.equal(runInNewContext(expression, context), true);
  context.needs['image-metadata'].result = 'failure';
  assert.equal(runInNewContext(expression, context), false);
});

test('only tag callers receive release credentials and package writes', () => {
  const release = workflow.split('  release-images:\n')[1].split('  gateway-release:\n')[0];
  assert.match(release, /github.event_name == 'push' && github.ref_type == 'tag'/);
  assert.match(release, /packages: write/);
  assert.match(release, /HUB_DOCKER_COM_PASS: \$\{\{ secrets.HUB_DOCKER_COM_PASS \}\}/);
});

test('release CI runs before login, and smoke tests precede publication of the same image ID', () => {
  assert.ok(build.indexOf('run: node scripts/ci/release-ci.mjs') < build.indexOf('id: baseline'));
  assert.ok(build.indexOf('name: Smoke test image') < build.indexOf('name: Publish tested image'));
  assert.match(build, /image_id=\$\(docker image inspect/);
  const smoke = build.split('      - name: Smoke test image')[1].split('      - name:')[0];
  const publish = build.split('      - name: Publish tested image')[1].split('      - name:')[0];
  for (const step of [smoke, publish]) {
    assert.match(step, /IMAGE_ID: \$\{\{ steps.image.outputs.id \}\}/);
  }
  assert.doesNotMatch(smoke, /^\s+if:/m, 'Every built image must be smoke-tested, including build-only PRs');
  assert.match(publish, /docker tag "\$\{IMAGE_ID\}"/);
});

test('release publishing checks unused tags before building and never uses the mutable PR push loop', () => {
  assert.ok(build.indexOf('run: node scripts/ci/release-image.mjs --preflight-only') <
    build.indexOf('name: Build image without publishing'));
  const publish = build.split('      - name: Publish tested image')[1].split('      - name:')[0];
  assert.match(publish, /if \[\[ "\$\{GITHUB_REF_TYPE\}" == "tag" \]\]; then\n            node scripts\/ci\/release-image.mjs\n            exit 0\n          fi/);
  assert.match(workflow, /cancel-in-progress: \$\{\{ github.event_name == 'pull_request' \}\}/);
});

test('gateway release pull commands use immutable digests', () => {
  assert.ok(build.includes('docker pull %s@%s'));
  assert.ok(!build.includes('docker pull %s:%s'));
});
