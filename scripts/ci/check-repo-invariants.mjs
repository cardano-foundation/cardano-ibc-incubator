#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

function checkRelayerSubmodule() {
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

  if (branch !== 'feat/cardano-integration') {
    fail(`relayer submodule branch must stay on feat/cardano-integration; found ${branch ?? 'missing'}`);
  }

  const treeEntry = execFileSync('git', ['ls-tree', 'HEAD', 'relayer'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();

  if (!/^160000 commit [0-9a-f]{40}\trelayer$/.test(treeEntry)) {
    fail(`relayer must be committed as a git submodule entry; found ${treeEntry || 'missing tree entry'}`);
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (
      entry === '.git' ||
      entry === 'node_modules' ||
      entry === 'target' ||
      entry === 'dist' ||
      entry === 'build'
    ) {
      continue;
    }

    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

function isManifestCandidate(path) {
  const name = basename(path).toLowerCase();
  return (
    name.includes('manifest') ||
    name === 'handler.json' ||
    name === 'deployment.json'
  );
}

function isBridgeManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
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

function checkBridgeManifest(path, manifest) {
  const relativePath = relative(repoRoot, path);
  const normalizedPath = relativePath.toLowerCase();
  const identity = manifest.cardano && typeof manifest.cardano === 'object'
    ? manifest.cardano
    : manifest;
  const chainId = String(identity.chain_id ?? identity.chainId ?? '');
  const network = String(identity.network ?? '').toLowerCase();
  const networkMagic = Number(identity.network_magic ?? identity.networkMagic);

  if (!Number.isInteger(networkMagic)) {
    fail(`${relativePath}: network_magic must be an integer`);
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
    fail(`${relativePath}: ${expectedByPath.marker} manifests must use network_magic ${expectedByPath.magic}, found ${networkMagic}`);
  }

  if (expectedByPath.marker !== 'devnet' && network !== expectedByPath.network) {
    fail(`${relativePath}: expected network ${expectedByPath.network}, found ${network || 'missing'}`);
  }

  if (expectedByPath.marker === 'preprod' && /devnet/i.test(chainId)) {
    fail(`${relativePath}: preprod manifest chain_id must not contain devnet (${chainId})`);
  }
}

function checkBridgeManifests() {
  for (const root of ['cardano', 'chains', 'manifests']) {
    const rootPath = join(repoRoot, root);
    try {
      for (const path of walk(rootPath)) {
        if (!path.endsWith('.json') || !isManifestCandidate(path)) {
          continue;
        }

        const text = readFileSync(path, 'utf8');
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          continue;
        }

        if (isBridgeManifest(parsed)) {
          checkBridgeManifest(path, parsed);
        }
      }
    } catch {
      continue;
    }
  }
}

checkRelayerSubmodule();
checkBridgeManifests();

if (failures.length > 0) {
  console.error('Repository invariant check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Repository invariants passed.');
