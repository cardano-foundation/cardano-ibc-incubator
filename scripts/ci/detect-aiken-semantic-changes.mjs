#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const aikenInfrastructurePaths = new Set([
  'scripts/ci/aiken-fuzz-required-labels.json',
  'scripts/ci/check-aiken-fuzz-coverage.mjs',
  'scripts/ci/check-aiken-fuzz-imports.sh',
  'scripts/ci/check-aiken-wire-schema.mjs',
  'scripts/ci/check-aiken-wire-schema.test.mjs',
  'scripts/ci/check-generated-artifacts-clean.sh',
  'scripts/ci/detect-aiken-semantic-changes.mjs',
  'scripts/ci/detect-aiken-semantic-changes.test.mjs',
  'scripts/ci/merge-aiken-check-reports.mjs',
  'cardano/gateway/src/scripts/ci/check-tx-budgets.ts',
  'cardano/gateway/package-lock.json',
  'cardano/gateway/package.json',
  'cardano/gateway/src/shared/helpers/hex.ts',
  'cardano/gateway/tsconfig.json',
]);

function isAikenInfrastructurePath(path) {
  return (
    path.startsWith('.github/actions/') ||
    path.startsWith('.github/workflows/') ||
    path.startsWith('cardano/gateway/src/shared/types/') ||
    aikenInfrastructurePaths.has(path)
  );
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

  for (const path of files) {
    if (isAikenInfrastructurePath(path)) {
      reasons.push(`${path} affects Aiken CI`);
      continue;
    }
    if (!path.startsWith('cardano/onchain/')) {
      continue;
    }
    if (!path.endsWith('.ak')) {
      reasons.push(`${path} is a non-source Aiken project change`);
      continue;
    }

    aikenFilesChanged = true;
    const before = readTreeBlob(repoRoot, baseRef, path);
    const after = readTreeBlob(repoRoot, headRef, path);
    if (!before || !after || before.mode !== after.mode) {
      reasons.push(`${path} was added, deleted, renamed, or changed mode`);
      continue;
    }
    if (before.source === null || after.source === null) {
      reasons.push(`${path} is not a regular source file`);
      continue;
    }
    if (
      aikenSemanticSignature(before.source) !==
      aikenSemanticSignature(after.source)
    ) {
      reasons.push(`${path} changed outside ordinary comments and whitespace`);
    }
  }

  return {
    aikenFilesChanged,
    aikenRelevantChanged: reasons.length > 0,
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
