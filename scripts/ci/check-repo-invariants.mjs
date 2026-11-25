#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// Committed bridge manifests are identified by location rather than content,
// so a document missing its identifying fields cannot escape validation.
const bridgeManifestPath = /^manifests\/(preprod|preview|mainnet|devnet)\/cardano-\1-bridge-manifest\.json$/;
const requiredBridgeManifests = ['manifests/preview/cardano-preview-bridge-manifest.json'];

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;

// Identity fields the runtime parser requires before a manifest is usable
// (packages/cardano-ibc-tx-builder-runtime/src/bridgeManifest.ts).
const bridgeManifestFields = [
  ['schema_version', isNonNegativeInteger, 'a non-negative integer'],
  ['deployment_id', isNonEmptyString, 'a non-empty string'],
  ['cardano', isObject, 'an object'],
  ['cardano.chain_id', isNonEmptyString, 'a non-empty string'],
  ['cardano.network_magic', isNonNegativeInteger, 'a non-negative integer'],
  ['cardano.network', isNonEmptyString, 'a non-empty string'],
  ['validators', isObject, 'an object'],
  ['host_state_nft', isObject, 'an object'],
];

function readText(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function checkRelayerSubmodule(fail) {
  const gitmodules = readText('.gitmodules');
  const relayerBlock = gitmodules.match(/\[submodule "relayer"\][\s\S]*?(?=\n\[|$)/);
  if (!relayerBlock) {
    fail('.gitmodules is missing the relayer submodule block');
    return;
  }

  const url = relayerBlock[0].match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
  const branch = relayerBlock[0].match(/^\s*branch\s*=\s*(.+)$/m)?.[1]?.trim();

  if (url !== 'https://github.com/cardano-foundation/hermes-relayer.git') {
    fail(`relayer submodule URL must stay on cardano-foundation/hermes-relayer.git; found ${url ?? 'missing'}`);
  }

  if (branch !== 'main') {
    fail(`relayer submodule branch must stay on main; found ${branch ?? 'missing'}`);
  }

  const treeEntry = execFileSync('git', ['ls-tree', 'HEAD', 'relayer'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();

  if (!/^160000 commit [0-9a-f]{40}\trelayer$/.test(treeEntry)) {
    fail(`relayer must be committed as a git submodule entry; found ${treeEntry || 'missing tree entry'}`);
  }
}

function isManifestCandidate(path) {
  const name = basename(path).toLowerCase();
  return (
    name.includes('manifest') ||
    name === 'deployment.json'
  );
}

function isBridgeManifest(value) {
  if (!isObject(value)) {
    return false;
  }

  const identity = value.cardano && typeof value.cardano === 'object'
    ? value.cardano
    : value;

  return (
    'validators' in value &&
    ('chain_id' in identity || 'chainId' in identity) &&
    ('network_magic' in identity || 'networkMagic' in identity)
  );
}

// Returns undefined after reporting why the file could not be read or parsed.
function readJson(root, path, fail) {
  let text;
  try {
    text = readFileSync(join(root, path), 'utf8');
  } catch (error) {
    fail(`${path}: could not be read (${error.message})`);
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${path}: invalid JSON (${error.message})`);
    return undefined;
  }
}

function checkBridgeManifestFields(path, manifest, fail) {
  let valid = true;
  for (const [field, isValid, expected] of bridgeManifestFields) {
    const value = field.split('.').reduce((parent, key) => (isObject(parent) ? parent[key] : undefined), manifest);
    if (!isValid(value)) {
      fail(`${path}: ${field} must be ${expected}`);
      valid = false;
    }
  }
  return valid;
}

function checkBridgeManifest(path, manifest, fail) {
  const normalizedPath = path.toLowerCase();
  const identity = manifest.cardano && typeof manifest.cardano === 'object'
    ? manifest.cardano
    : manifest;
  const chainId = String(identity.chain_id ?? identity.chainId ?? '');
  const network = String(identity.network ?? '').toLowerCase();
  const networkMagic = Number(identity.network_magic ?? identity.networkMagic);

  if (!Number.isInteger(networkMagic)) {
    fail(`${path}: network_magic must be an integer`);
    return;
  }

  const expectedByPath = [
    { marker: 'preprod', magic: 1, network: 'preprod' },
    { marker: 'preview', magic: 2, network: 'preview' },
    { marker: 'mainnet', magic: 764824073, network: 'mainnet' },
    { marker: 'devnet', magic: 42, network: 'devnet' },
  ].find(({ marker }) => normalizedPath.includes(marker));

  if (!expectedByPath) {
    return;
  }

  if (networkMagic !== expectedByPath.magic) {
    fail(`${path}: ${expectedByPath.marker} manifests must use network_magic ${expectedByPath.magic}, found ${networkMagic}`);
  }

  if (expectedByPath.marker !== 'devnet' && network !== expectedByPath.network) {
    fail(`${path}: expected network ${expectedByPath.network}, found ${network || 'missing'}`);
  }

  if (expectedByPath.marker === 'preprod' && /devnet/i.test(chainId)) {
    fail(`${path}: preprod manifest chain_id must not contain devnet (${chainId})`);
  }
}

// Only committed files are inspected, so local deployment output is ignored
// and a listed file that cannot be read fails the check.
export function checkBridgeManifests(root) {
  const failures = [];
  const fail = (message) => failures.push(message);
  const paths = execFileSync('git', ['ls-files', '-z', '--', 'cardano', 'chains', 'manifests'], {
    cwd: root,
    encoding: 'utf8',
  }).split('\0').filter(Boolean);

  for (const required of requiredBridgeManifests) {
    if (!paths.includes(required)) {
      fail(`${required}: required bridge manifest is not committed`);
    }
  }

  for (const path of paths) {
    if (bridgeManifestPath.test(path)) {
      const manifest = readJson(root, path, fail);
      if (manifest !== undefined && checkBridgeManifestFields(path, manifest, fail)) {
        checkBridgeManifest(path, manifest, fail);
      }
      continue;
    }

    if (path.startsWith('manifests/') && basename(path).toLowerCase().includes('bridge-manifest')) {
      fail(`${path}: bridge manifests must be named manifests/<network>/cardano-<network>-bridge-manifest.json`);
      continue;
    }

    if (!path.endsWith('.json') || !isManifestCandidate(path)) {
      continue;
    }

    const parsed = readJson(root, path, fail);
    if (parsed !== undefined && isBridgeManifest(parsed)) {
      checkBridgeManifest(path, parsed, fail);
    }
  }

  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = [];
  checkRelayerSubmodule((message) => failures.push(message));
  failures.push(...checkBridgeManifests(repoRoot));

  if (failures.length > 0) {
    console.error('Repository invariant check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Repository invariants passed.');
}
