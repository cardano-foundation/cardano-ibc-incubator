#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const imageIdPattern = /^sha256:[0-9a-f]{64}$/;
const versionPattern = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
const words = (value = '') => value.trim().split(/\s+/u).filter(Boolean);

export function releaseImageConfig(env, preflightOnly = false) {
  const { COMPONENT: component, IMAGE_TAG: imageTag, IMAGE_ID: imageId } = env;
  if (!['gateway', 'hermes', 'swap-client'].includes(component)) {
    throw new Error('COMPONENT must be gateway, hermes or swap-client');
  }
  if (!imageTag || imageTag.length > 128 || !versionPattern.test(imageTag)) {
    throw new Error('IMAGE_TAG must be a version tag such as v1.2.3');
  }
  if (!preflightOnly && !imageIdPattern.test(imageId ?? '')) {
    throw new Error('IMAGE_ID must be the exact sha256 image ID that passed smoke tests');
  }
  if (
    (env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== 'push') ||
    (env.GITHUB_REF_TYPE && env.GITHUB_REF_TYPE !== 'tag') ||
    (env.GITHUB_REF_NAME && env.GITHUB_REF_NAME !== `${component}/${imageTag}`)
  ) {
    throw new Error('Release image publishing requires the matching component tag push');
  }

  const registries = [...new Set(words(env.REGISTRIES))];
  if (!registries.length || registries.some((registry) =>
    !/^[a-z0-9][a-z0-9.:-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u.test(registry)
  )) {
    throw new Error('REGISTRIES must contain registry paths without credentials or URL schemes');
  }
  const tags = [...new Set([imageTag, ...words(env.EXTRA_TAGS)])];
  if (tags.some((tag) => tag.length > 128 || (tag !== imageTag && (
    !tag.startsWith(`${imageTag}-`) ||
    !/^[0-9a-f]{7,40}(?:-GHRUN[0-9]+)?$/u.test(tag.slice(imageTag.length + 1))
  )))) {
    throw new Error('EXTRA_TAGS may only contain the version tag or version-prefixed commit/run tags');
  }
  return { component, imageTag, imageId, registries, tags };
}

// Generic 404/not-found responses can hide authentication failures. Only accept
// an explicit missing-manifest response, without a competing failure signal.
export function isMissingManifest(result) {
  if (result.error || result.signal || !Number.isInteger(result.status) || result.status <= 0) {
    return false;
  }
  const message = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return !/unauthori[sz]ed|authentication|authorization|oauth|denied|forbidden|\b40[13]\b|timeout|timed out|TLS|certificate|connection|no such host|\bEOF\b|too many requests|\b429\b|\b50[0-9]\b/iu.test(message) &&
    /(?:^|\n|:\s)\s*(?:MANIFEST_UNKNOWN\b|manifest unknown\b|no such manifest:)/iu.test(message);
}

const runDocker = (args) => spawnSync('docker', args, {
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
});

export function publishReleaseImage(env, { docker = runDocker, preflightOnly = false } = {}) {
  const config = releaseImageConfig(env, preflightOnly);
  const destinations = config.registries.flatMap((registry, index) =>
    config.tags.map((tag) => ({
      reference: `${registry}/cardano-ibc-${config.component}:${tag}`,
      index: index + 1,
    }))
  );

  // Check every destination before the first write. Registry-side immutability
  // is still required to prevent another writer racing this check.
  for (const { reference, index } of destinations) {
    const result = docker(['manifest', 'inspect', reference]);
    if (result.status === 0 && !result.error && !result.signal) {
      throw new Error(
        `Release image tag already exists in destination ${index}. ` +
        'Reruns do not republish existing tags. Use a new version or recover the published image by digest.',
      );
    }
    if (!isMissingManifest(result)) {
      throw new Error(`Could not establish that the release tag is absent in destination ${index}, refusing to publish`);
    }
  }
  if (preflightOnly) return { published: 0, checked: destinations.length };

  const inspected = docker(['image', 'inspect', config.imageId, '--format', '{{.Id}}']);
  if (inspected.status !== 0 || inspected.error || inspected.signal || inspected.stdout?.trim() !== config.imageId) {
    throw new Error('The exact smoke-tested IMAGE_ID is unavailable, refusing to publish');
  }
  for (const { reference, index } of destinations) {
    for (const args of [['tag', config.imageId, reference], ['push', reference]]) {
      const result = docker(args);
      if (result.status !== 0 || result.error || result.signal) {
        // Do not print Docker stderr, which can contain private registry URLs.
        throw new Error(`Docker ${args[0]} failed for destination ${index}. Publication may be partial, do not overwrite existing tags.`);
      }
    }
  }
  return { published: destinations.length, checked: destinations.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--preflight-only')) {
      throw new Error('Usage: node scripts/ci/release-image.mjs [--preflight-only]');
    }
    const result = publishReleaseImage(process.env, { preflightOnly: args[0] === '--preflight-only' });
    console.log(`Release image checks passed for ${result.checked} tags, published ${result.published}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
