#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const aikenFuzzInfrastructurePaths = new Set([
  'scripts/ci/check-aiken-mutations.mjs',
  'scripts/ci/aiken-property-inventory.mjs',
  'scripts/ci/aiken-property-inventory.test.mjs',
  'scripts/ci/check-aiken-fuzz-coverage.test.mjs',
  'scripts/ci/aiken-fuzz-required-labels.json',
  'scripts/ci/check-aiken-fuzz-coverage.mjs',
  'scripts/ci/check-aiken-fuzz-imports.sh',
  'scripts/ci/check-aiken-layering.sh',
  'scripts/ci/detect-aiken-semantic-changes.mjs',
  'scripts/ci/detect-aiken-semantic-changes.test.mjs',
  'scripts/ci/merge-aiken-check-reports.mjs',
]);

const aikenInfrastructurePaths = new Set([
  ...aikenFuzzInfrastructurePaths,
  'chains/cardano/config/devnet/genesis-alonzo.json',
  'chains/cardano/config/devnet/genesis-shelley.json',
  'chains/cardano/config/devnet/genesis-conway.json',
  'scripts/ci/collect-cardano-tx-budget-units.sh',
  'scripts/ci/check-aiken-wire-schema.mjs',
  'scripts/ci/check-aiken-wire-schema.test.mjs',
  'scripts/ci/check-generated-artifacts-clean.sh',
  'cardano/gateway/src/scripts/ci/check-tx-budgets.ts',
  'cardano/gateway/src/scripts/ci/applied-deployment-plan.ts',
  'cardano/gateway/src/scripts/ci/tendermint-update-capacity.ts',
  'cardano/gateway/src/scripts/ci/tx-budget-limits.ts',
  'cardano/gateway/src/scripts/test/generate-injective-tendermint-capacity-fixture.ts',
  'cardano/gateway/src/scripts/test/generate-tendermint-update-capacity-aiken.ts',
  'cardano/gateway/package-lock.json',
  'cardano/gateway/package.json',
  'cardano/gateway/src/shared/helpers/hex.ts',
  'cardano/gateway/src/shared/modules/lucid/lucid.service.ts',
  'cardano/gateway/tsconfig.json',
]);

function isAikenInfrastructurePath(path) {
  return (
    path.startsWith('cardano/offchain/') ||
    path.startsWith('.github/actions/') ||
    path.startsWith('.github/workflows/') ||
    // Production parameter loading and transaction construction feed the size gate.
    path.startsWith('packages/cardano-ibc-tx-builder') ||
    path.startsWith('packages/cardano-ibc-trace-registry/') ||
    path.startsWith('cardano/gateway/src/shared/types/') ||
    path.startsWith(
      'cardano/gateway/src/scripts/test/fixtures/tendermint-update-capacity/',
    ) ||
    aikenInfrastructurePaths.has(path)
  );
}

// Only skip a workflow-triggered suite when the edit is confined to existing
// job blocks. Global settings, unknown layouts and shared YAML references are
// deliberately treated as affecting every suite.
export function classifyCiWorkflowChange(before, after) {
  const full = { relevant: true, fuzz: true };
  const split = (source) => {
    if (typeof source !== 'string' || /(?:^|:\s+|-\s+)[&*][\w-]|^---|^\.\.\.|\t/m.test(source)) return null;
    const boundary = source.indexOf('\njobs:\n');
    if (boundary < 0) return null;
    const body = source.slice(boundary + '\njobs:\n'.length);
    const jobs = new Map();
    let current;
    for (const line of body.split('\n')) {
      const match = /^  ([a-zA-Z][a-zA-Z0-9_-]*):\s*$/.exec(line);
      if (match) {
        current = match[1];
        if (jobs.has(current)) return null;
        jobs.set(current, line);
      } else if (line.trim() && (!current || !/^    |^\s*#/.test(line))) {
        return null;
      } else if (current) {
        jobs.set(current, `${jobs.get(current)}\n${line}`);
      }
    }
    return { prefix: source.slice(0, boundary), jobs };
  };
  const previous = split(before);
  const next = split(after);
  if (!previous || !next || previous.prefix !== next.prefix) return full;
  const names = new Set([...previous.jobs.keys(), ...next.jobs.keys()]);
  let relevant = false;
  for (const name of names) {
    if (!previous.jobs.has(name) || !next.jobs.has(name)) return full;
    const oldJob = previous.jobs.get(name);
    const newJob = next.jobs.get(name);
    if (oldJob === newJob) continue;
    if (name === 'aiken' || name.startsWith('aiken-')) return full;
    if (['tx-budgets', 'deno-offchain', 'generated-artifacts'].includes(name)) {
      relevant = true;
    } else if (/aiken|cardano\/onchain/i.test(`${oldJob}\n${newJob}`)) {
      return full;
    }
  }
  return { relevant, fuzz: false };
}

function runGit(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function changedPaths(repoRoot, baseRef, headRef) {
  const output = runGit(
    repoRoot,
    ['diff', '--name-only', '--no-renames', '-z', baseRef, headRef],
    'buffer',
  );
  return utf8Decoder.decode(output).split('\0').filter(Boolean);
}

function readTreeBlob(repoRoot, ref, path) {
  const entry = runGit(repoRoot, ['ls-tree', '-z', ref, '--', path], 'buffer');
  if (entry.length === 0) {
    return null;
  }

  const decodedEntry = utf8Decoder.decode(entry.subarray(0, entry.length - 1));
  const tabIndex = decodedEntry.indexOf('\t');
  if (tabIndex < 0) {
    throw new Error(`Could not parse git tree entry for ${path} at ${ref}`);
  }
  const [mode, type, object] = decodedEntry.slice(0, tabIndex).split(' ');
  if (mode !== '100644' || type !== 'blob' || !object) {
    return { mode, source: null };
  }

  const blob = runGit(repoRoot, ['cat-file', 'blob', object], 'buffer');
  return { mode, source: utf8Decoder.decode(blob) };
}

/**
 * Remove ordinary Aiken line comments while preserving strings and `///`
 * documentation comments, while retaining newline boundaries that affect
 * Aiken's line-leading operators and expect-comment traces.
 */
export function aikenSemanticSignature(input) {
  const source = input;
  let signature = '';
  let pendingSeparator = null;
  let pendingNewlineCount = 0;
  let previousTokenWasDoc = false;
  let inLiteral = false;
  let escaped = false;

  const appendSeparator = () => {
    if (signature.length > 0) {
      if (pendingSeparator === 'newline') {
        signature += previousTokenWasDoc && pendingNewlineCount > 1 ? '\n\n' : '\n';
      } else if (pendingSeparator === 'space') {
        signature += ' ';
      }
    }
    pendingSeparator = null;
    pendingNewlineCount = 0;
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inLiteral) {
      signature += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inLiteral = false;
      }
      continue;
    }

    if (char === ' ' || char === '\t') {
      pendingSeparator ??= 'space';
      continue;
    }
    if (char === '\n') {
      pendingSeparator = 'newline';
      pendingNewlineCount += 1;
      continue;
    }
    if (char === '\r') {
      if (source[index + 1] !== '\n') {
        throw new Error('Aiken source contains a bare carriage return');
      }
      pendingSeparator = 'newline';
      pendingNewlineCount += 1;
      index += 1;
      continue;
    }
    if (/\s/u.test(char)) {
      throw new Error('Aiken source contains unsupported whitespace');
    }

    if (char === '/' && source[index + 1] === '/') {
      let slashCount = 2;
      while (source[index + slashCount] === '/') {
        slashCount += 1;
      }
      const newline = source.indexOf('\n', index);
      const carriageReturn = source.indexOf('\r', index);
      const lineEnd = [newline, carriageReturn]
        .filter((position) => position >= 0)
        .reduce((first, position) => Math.min(first, position), source.length);
      const end = lineEnd;

      if (slashCount >= 3) {
        appendSeparator();
        signature += `\u0000doc:${source.slice(index, end)}\u0000`;
        previousTokenWasDoc = true;
      }
      index = end - 1;
      continue;
    }

    appendSeparator();
    signature += char;
    previousTokenWasDoc = false;
    if (char === '"') {
      inLiteral = true;
    }
  }

  if (inLiteral || escaped) {
    throw new Error('Aiken source contains an unterminated quoted literal');
  }

  return signature;
}

export function classifyAikenChanges(repoRoot, baseRef, headRef) {
  runGit(repoRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`]);
  runGit(repoRoot, ['rev-parse', '--verify', `${headRef}^{commit}`]);

  const files = changedPaths(repoRoot, baseRef, headRef);
  const reasons = [];
  let aikenFilesChanged = false;
  let aikenFuzzChanged = false;

  for (const path of files) {
    if (path === '.github/workflows/ci.yml') {
      const before = readTreeBlob(repoRoot, baseRef, path);
      const after = readTreeBlob(repoRoot, headRef, path);
      const scope = classifyCiWorkflowChange(before?.source, after?.source);
      if (scope.relevant) reasons.push(`${path} affects Aiken CI`);
      aikenFuzzChanged ||= scope.fuzz;
      continue;
    }
    if (isAikenInfrastructurePath(path)) {
      reasons.push(`${path} affects Aiken CI`);
      aikenFuzzChanged ||= aikenFuzzInfrastructurePaths.has(path) ||
        path.startsWith('.github/actions/') || path.startsWith('.github/workflows/');
      continue;
    }
    if (!path.startsWith('cardano/onchain/')) {
      continue;
    }
    if (!path.endsWith('.ak')) {
      reasons.push(`${path} is a non-source Aiken project change`);
      aikenFuzzChanged = true;
      continue;
    }

    aikenFilesChanged = true;
    const before = readTreeBlob(repoRoot, baseRef, path);
    const after = readTreeBlob(repoRoot, headRef, path);
    if (!before || !after || before.mode !== after.mode) {
      reasons.push(`${path} was added, deleted, renamed, or changed mode`);
      aikenFuzzChanged = true;
      continue;
    }
    if (before.source === null || after.source === null) {
      reasons.push(`${path} is not a regular source file`);
      aikenFuzzChanged = true;
      continue;
    }
    if (
      aikenSemanticSignature(before.source) !==
      aikenSemanticSignature(after.source)
    ) {
      reasons.push(`${path} changed outside ordinary comments and whitespace`);
      aikenFuzzChanged = true;
    }
  }

  return {
    aikenFilesChanged,
    aikenRelevantChanged: reasons.length > 0,
    aikenFuzzChanged,
    changedFiles: files,
    reasons,
  };
}

function main() {
  const [baseRef, headRef] = process.argv.slice(2);
  if (!baseRef || !headRef || process.argv.length !== 4) {
    throw new Error(
      'Usage: node scripts/ci/detect-aiken-semantic-changes.mjs <base-ref> <head-ref>',
    );
  }
  console.log(JSON.stringify(classifyAikenChanges(process.cwd(), baseRef, headRef)));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(`Aiken change detection failed: ${String(error)}`);
    process.exitCode = 1;
  }
}
