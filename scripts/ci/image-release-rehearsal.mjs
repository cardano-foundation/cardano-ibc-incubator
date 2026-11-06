import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publishReleaseImage, releaseImageConfig } from './release-image.mjs';

// The Python harness supplies outputs from the pinned action under a tag push.
// Docker stays in memory, including manifest inspection and publication.
const { env, preflightEnv, version, commit, registries } = JSON.parse(readFileSync(0, 'utf8'));
const config = releaseImageConfig(env);
assert.equal(config.imageTag, `v${version}`);
assert.deepEqual(config.tags, [
  `v${version}`, `v${version}-${commit}`, `v${version}-${commit}-GHRUN${env.GITHUB_RUN_ID}`,
]);
assert.deepEqual(config.registries, registries);
const references = registries.flatMap(registry => config.tags.map(tag =>
  `${registry}/cardano-ibc-${env.COMPONENT}:${tag}`));
const preflightCalls = [];
assert.deepEqual(publishReleaseImage(preflightEnv, {
  preflightOnly: true,
  docker(args) {
    preflightCalls.push(args);
    return { status: 1, stderr: 'manifest unknown' };
  },
}), { published: 0, checked: references.length });
assert.deepEqual(preflightCalls, references.map(reference => ['manifest', 'inspect', reference]));
const calls = [];
const result = publishReleaseImage(env, {
  docker(args) {
    calls.push(args);
    if (args[0] === 'manifest') return { status: 1, stderr: 'manifest unknown' };
    return { status: 0, stdout: args[0] === 'image' ? env.IMAGE_ID : '' };
  },
});
assert.deepEqual(result, { published: references.length, checked: references.length });
assert.deepEqual(calls, [
  ...references.map(reference => ['manifest', 'inspect', reference]),
  ['image', 'inspect', env.IMAGE_ID, '--format', '{{.Id}}'],
  ...references.flatMap(reference => [['tag', env.IMAGE_ID, reference], ['push', reference]]),
]);
assert.throws(() => releaseImageConfig({
  ...env, GITHUB_REF_NAME: `${env.COMPONENT}/v0.0.0-mismatched`,
}), /matching component tag push/);
console.log(`${env.GITHUB_REF_NAME}: version, tags and ${references.length} simulated image pushes passed`);
