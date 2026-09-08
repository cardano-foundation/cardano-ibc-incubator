import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isMissingManifest, publishReleaseImage, releaseImageConfig } from './release-image.mjs';

const imageId = `sha256:${'ab'.repeat(32)}`;
const environment = {
  COMPONENT: 'gateway',
  IMAGE_TAG: 'v1.2.3',
  IMAGE_ID: imageId,
  REGISTRIES: 'ghcr.io/example registry.example/private',
  EXTRA_TAGS: 'v1.2.3-abcdef0 v1.2.3-abcdef0-GHRUN123 v1.2.3',
};
const success = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const failure = (stderr) => ({ status: 1, stdout: '', stderr });
const missing = () => failure('manifest unknown: manifest unknown');

function fakeDocker(override = () => undefined) {
  const calls = [];
  const docker = (args) => {
    calls.push(args);
    return override(args) ?? (args[0] === 'manifest' ? missing()
      : args[0] === 'image' ? success(`${imageId}\n`) : success());
  };
  return { calls, docker };
}

test('preflights every tag and registry before publishing the exact smoke-tested image', () => {
  const fake = fakeDocker();
  assert.deepEqual(publishReleaseImage(environment, fake), { checked: 6, published: 6 });
  assert.equal(fake.calls.length, 19);
  assert.ok(fake.calls.slice(0, 6).every(([command]) => command === 'manifest'));
  assert.deepEqual(fake.calls[6], ['image', 'inspect', imageId, '--format', '{{.Id}}']);
  const references = fake.calls.slice(0, 6).map((args) => args[2]);
  assert.deepEqual(fake.calls.slice(7), references.flatMap((reference) => [
    ['tag', imageId, reference], ['push', reference],
  ]));
  assert.equal(new Set(references).size, 6);
});

test('preflight-only needs no local image and performs no writes', () => {
  const fake = fakeDocker();
  assert.deepEqual(publishReleaseImage({ ...environment, IMAGE_ID: undefined }, {
    ...fake, preflightOnly: true,
  }), { checked: 6, published: 0 });
  assert.ok(fake.calls.every(([command]) => command === 'manifest'));
});

test('an existing version in either registry rejects reruns before any writes', () => {
  for (const registry of environment.REGISTRIES.split(' ')) {
    const fake = fakeDocker((args) => args[2] === `${registry}/cardano-ibc-gateway:v1.2.3`
      ? success('{}') : undefined);
    assert.throws(() => publishReleaseImage(environment, fake), /already exists.*Reruns do not republish/);
    assert.ok(fake.calls.every(([command]) => command === 'manifest'));
  }
});

test('an existing auxiliary version tag also prevents an overwrite', () => {
  const fake = fakeDocker((args) => args[2]?.endsWith(':v1.2.3-abcdef0-GHRUN123')
    ? success('{}') : undefined);
  assert.throws(() => publishReleaseImage(environment, fake), /already exists/);
  assert.ok(fake.calls.every(([command]) => command === 'manifest'));
});

test('only explicit missing-manifest errors establish absence', () => {
  for (const message of [
    'manifest unknown', 'MANIFEST_UNKNOWN: missing', 'no such manifest: example:v1',
    'Error response from daemon: manifest for example:v1 not found: manifest unknown: manifest unknown',
  ]) {
    assert.equal(isMissingManifest(failure(message)), true, message);
  }
  for (const message of [
    'not found', '404 Not Found', 'repository does not exist', 'unauthorized',
    'denied: requested access', 'authentication required', 'TLS handshake timeout',
    'connection reset by peer', '500 Internal Server Error',
    'manifest unknown\nunauthorized', 'MANIFEST_UNKNOWN: 403 Forbidden',
    'no such manifest: example:v1\n429 Too Many Requests',
    'registry.example/manifest_unknown/image:v1: not found',
    'manifest unknown\nfailed to fetch oauth token',
    'manifest unknown\nlookup registry.example: no such host',
  ]) {
    const fake = fakeDocker(() => failure(message));
    assert.throws(() => publishReleaseImage(environment, fake), /Could not establish/);
    assert.equal(fake.calls.length, 1);
  }
  assert.equal(isMissingManifest({ ...missing(), error: new Error('spawn failure') }), false);
  assert.equal(isMissingManifest({ ...missing(), signal: 'SIGTERM' }), false);
  assert.equal(isMissingManifest({ ...missing(), status: null }), false);
});

test('mismatched or unavailable local image IDs cannot publish', () => {
  for (const result of [success(`sha256:${'cd'.repeat(32)}`), failure('No such image')]) {
    const fake = fakeDocker((args) => args[0] === 'image' ? result : undefined);
    assert.throws(() => publishReleaseImage(environment, fake), /IMAGE_ID is unavailable/);
    assert.ok(fake.calls.every(([command]) => ['manifest', 'image'].includes(command)));
  }
});

test('a push failure stops publication without leaking private registry details', () => {
  const fake = fakeDocker((args) => args[0] === 'push'
    ? failure('credentials rejected by registry.example/private') : undefined);
  assert.throws(() => publishReleaseImage(environment, fake), (error) => {
    assert.match(error.message, /Publication may be partial/);
    assert.doesNotMatch(error.message, /registry\.example|credentials/);
    return true;
  });
  assert.equal(fake.calls.filter(([command]) => command === 'push').length, 1);
});

test('rejects mutable aliases, malformed inputs and mismatched GitHub context', () => {
  for (const change of [
    { COMPONENT: 'unknown' }, { IMAGE_ID: 'cardano-ibc-gateway:latest' },
    { IMAGE_TAG: 'latest' }, { REGISTRIES: '' },
    { REGISTRIES: 'https://registry.example/private' },
    { REGISTRIES: 'user:password@registry.example/private' },
    { EXTRA_TAGS: 'latest' }, { EXTRA_TAGS: 'abcdef0' },
    { EXTRA_TAGS: 'v1.2.3-other' }, { EXTRA_TAGS: 'v1.2.4-abcdef0' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF_TYPE: 'branch' },
    { GITHUB_REF_NAME: 'gateway/v1.2.4' },
  ]) {
    const fake = fakeDocker();
    assert.throws(() => publishReleaseImage({ ...environment, ...change }, fake));
    assert.equal(fake.calls.length, 0);
  }
  assert.equal(releaseImageConfig({
    ...environment, GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag',
    GITHUB_REF_NAME: 'gateway/v1.2.3',
  }).imageId, imageId);
  assert.deepEqual(releaseImageConfig({ ...environment, EXTRA_TAGS: undefined }).tags, ['v1.2.3']);
});

test('release tag rules forbid updates and deletion without blocking creation', () => {
  const ruleset = JSON.parse(readFileSync(new URL('../../.github/release-tag-ruleset.json', import.meta.url), 'utf8'));
  assert.equal(ruleset.target, 'tag');
  assert.equal(ruleset.enforcement, 'active');
  assert.deepEqual(ruleset.bypass_actors, []);
  assert.deepEqual(ruleset.conditions.ref_name, {
    include: ['refs/tags/gateway/v*', 'refs/tags/hermes/v*', 'refs/tags/swap-client/v*'],
    exclude: [],
  });
  assert.deepEqual(ruleset.rules, [{ type: 'update' }, { type: 'deletion' }]);
});
