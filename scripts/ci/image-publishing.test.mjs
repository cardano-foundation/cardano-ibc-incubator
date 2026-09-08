import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/publish.yaml', import.meta.url), 'utf8');
const build = readFileSync(new URL('../../.github/workflows/build-image.yaml', import.meta.url), 'utf8');
const registryStep = build.split('      - name: Select registry credentials before login\n')[1]
  .split('\n      - name:')[0].split('        run: |\n')[1]
  .split('\n').map((line) => line.replace(/^          /, '')).join('\n');

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

test('PR callers have no package writes or public registry credentials', () => {
  const pr = workflow.split('  pr-images:\n')[1].split('  release-images:\n')[0];
  assert.doesNotMatch(pr, /packages:|HUB_DOCKER_COM|secrets: inherit/);
  assert.match(pr, /permissions:\n      contents: read\n/);
  const guard = "github.event.pull_request.head.repo.full_name == github.repository && github.actor != 'dependabot[bot]'";
  assert.ok(pr.includes(`publish: \u0024{{ ${guard} }}`));
  for (const line of pr.split('\n').filter((line) => line.includes('secrets.'))) {
    assert.ok(line.includes(guard) && line.includes("|| ''"), line);
  }
  assert.doesNotMatch(build, /^\s+permissions:/m);
});

test('only tag callers receive release credentials and package writes', () => {
  const release = workflow.split('  release-images:\n')[1].split('  gateway-release:\n')[0];
  assert.match(release, /if: github.event_name == 'push' && github.ref_type == 'tag'/);
  assert.match(release, /packages: write/);
  assert.match(release, /HUB_DOCKER_COM_PASS: \$\{\{ secrets.HUB_DOCKER_COM_PASS \}\}/);
});

test('release CI runs before login, and smoke tests precede publication of the same image ID', () => {
  assert.ok(build.indexOf('run: node scripts/ci/release-ci.mjs') < build.indexOf('id: baseline'));
  assert.ok(build.indexOf('name: Smoke test release image') < build.indexOf('name: Publish tested image'));
  assert.match(build, /image_id=\$\(docker image inspect/);
  const smoke = build.split('      - name: Smoke test release image')[1].split('      - name:')[0];
  const publish = build.split('      - name: Publish tested image')[1].split('      - name:')[0];
  for (const step of [smoke, publish]) {
    assert.match(step, /IMAGE_ID: \$\{\{ steps.image.outputs.id \}\}/);
  }
  assert.match(smoke, /if: github.ref_type == 'tag'/);
  assert.match(publish, /docker tag "\$\{IMAGE_ID\}"/);
});
