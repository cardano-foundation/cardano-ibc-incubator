#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WIRE_SCHEMA_ROOTS = Object.freeze([
  'ibc/core/ics_025_handler_interface/host_state/HostStateDatum',
  'ibc/client/ics_007_tendermint_client/client_state/ClientState',
  'ibc/client/ics_007_tendermint_client/consensus_state/ConsensusState',
  'ibc/core/ics_003_connection_semantics/types/connection_end/ConnectionEnd',
  'ibc/core/ics_004/types/channel/Channel',
]);

export const LOCK_FORMAT_VERSION = 1;
export const DEFAULT_BLUEPRINT_PATH = 'cardano/onchain/plutus.json';
export const DEFAULT_LOCK_PATH = 'cardano/onchain/wire-schema.lock.json';

const definitionReferencePrefix = '#/definitions/';
const lockProperties = [
  'formatVersion',
  'wireSchemaVersion',
  'source',
  'schemaFingerprint',
  'roots',
  'definitions',
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertObject(value, context) {
  if (!isObject(value)) {
    throw new Error(`${context} must be an object`);
  }
}

function assertOnlyProperties(value, allowed, context) {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    throw new Error(
      `${context} has unsupported properties: ${unexpected.sort().join(', ')}`,
    );
  }
}

function assertNonEmptyString(value, context) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
}

function definitionNameFromReference(reference, context) {
  if (
    typeof reference !== 'string' ||
    !reference.startsWith(definitionReferencePrefix)
  ) {
    throw new Error(
      `${context} must reference ${definitionReferencePrefix}<definition>`,
    );
  }

  const encodedName = reference.slice(definitionReferencePrefix.length);
  if (
    encodedName.length === 0 ||
    encodedName.includes('/') ||
    /~(?:[^01]|$)/u.test(encodedName)
  ) {
    throw new Error(`${context} contains an invalid JSON Pointer reference`);
  }

  return encodedName.replaceAll('~1', '/').replaceAll('~0', '~');
}

function normalizeReference(value, context, visitDefinition) {
  assertOnlyProperties(value, ['$ref', 'title', 'description'], context);
  const definitionName = definitionNameFromReference(value.$ref, context);
  visitDefinition(definitionName);
  return { ref: definitionName };
}

function normalizeType(value, context, visitDefinition) {
  assertObject(value, context);

  if (Object.hasOwn(value, '$ref')) {
    return normalizeReference(value, context, visitDefinition);
  }

  assertNonEmptyString(value.dataType, `${context}.dataType`);
  if (value.dataType === 'bytes' || value.dataType === 'integer') {
    assertOnlyProperties(value, ['dataType', 'title', 'description'], context);
    return { type: value.dataType };
  }

  if (value.dataType === 'list') {
    assertOnlyProperties(
      value,
      ['dataType', 'items', 'title', 'description'],
      context,
    );
    return {
      type: 'list',
      items: normalizeType(value.items, `${context}.items`, visitDefinition),
    };
  }

  if (value.dataType === 'map') {
    assertOnlyProperties(
      value,
      ['dataType', 'keys', 'values', 'title', 'description'],
      context,
    );
    return {
      type: 'map',
      keys: normalizeType(value.keys, `${context}.keys`, visitDefinition),
      values: normalizeType(value.values, `${context}.values`, visitDefinition),
    };
  }

  throw new Error(`${context} has unsupported dataType ${value.dataType}`);
}

function normalizeConstructor(value, context, visitDefinition) {
  assertObject(value, context);
  assertOnlyProperties(
    value,
    ['title', 'description', 'dataType', 'index', 'fields'],
    context,
  );
  assertNonEmptyString(value.title, `${context}.title`);
  if (value.dataType !== 'constructor') {
    throw new Error(`${context}.dataType must be constructor`);
  }
  if (!Number.isSafeInteger(value.index) || value.index < 0) {
    throw new Error(`${context}.index must be a non-negative safe integer`);
  }
  if (!Array.isArray(value.fields)) {
    throw new Error(`${context}.fields must be an array`);
  }

  const fieldNames = new Set();
  const fields = value.fields.map((field, fieldIndex) => {
    const fieldContext = `${context}.fields[${fieldIndex}]`;
    assertObject(field, fieldContext);
    assertNonEmptyString(field.title, `${fieldContext}.title`);
    if (fieldNames.has(field.title)) {
      throw new Error(`${context} has duplicate field name ${field.title}`);
    }
    fieldNames.add(field.title);

    return {
      name: field.title,
      type: normalizeType(field, fieldContext, visitDefinition),
    };
  });

  return {
    name: value.title,
    index: value.index,
    fields,
  };
}

function normalizeDefinition(value, definitionName, visitDefinition) {
  const context = `definition ${definitionName}`;
  assertObject(value, context);

  if (Object.hasOwn(value, 'anyOf')) {
    assertOnlyProperties(value, ['title', 'description', 'anyOf'], context);
    if (!Array.isArray(value.anyOf) || value.anyOf.length === 0) {
      throw new Error(`${context}.anyOf must be a non-empty array`);
    }

    const constructors = value.anyOf.map((constructor, index) =>
      normalizeConstructor(
        constructor,
        `${context}.anyOf[${index}]`,
        visitDefinition,
      ),
    );
    constructors.sort((left, right) => left.index - right.index);

    for (let index = 1; index < constructors.length; index += 1) {
      if (constructors[index - 1].index === constructors[index].index) {
        throw new Error(
          `${context} has duplicate constructor index ${constructors[index].index}`,
        );
      }
    }

    return { type: 'sum', constructors };
  }

  return normalizeType(value, context, visitDefinition);
}

function wireSchemaPayload(lockOrSchema) {
  return {
    roots: lockOrSchema.roots,
    definitions: lockOrSchema.definitions,
  };
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

export function fingerprintWireSchema(schema) {
  const hash = createHash('sha256')
    .update(canonicalJson(wireSchemaPayload(schema)))
    .digest('hex');
  return `sha256:${hash}`;
}

export function buildWireSchema(blueprint, roots = WIRE_SCHEMA_ROOTS) {
  assertObject(blueprint, 'blueprint');
  assertObject(blueprint.definitions, 'blueprint.definitions');
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error('wire schema roots must be a non-empty array');
  }

  const uniqueRoots = new Set();
  for (const [index, root] of roots.entries()) {
    assertNonEmptyString(root, `wire schema roots[${index}]`);
    if (uniqueRoots.has(root)) {
      throw new Error(`wire schema roots contains duplicate ${root}`);
    }
    uniqueRoots.add(root);
  }

  const normalizedDefinitions = new Map();
  const definitionsBeingVisited = new Set();

  const visitDefinition = (definitionName) => {
    if (
      normalizedDefinitions.has(definitionName) ||
      definitionsBeingVisited.has(definitionName)
    ) {
      return;
    }
    if (!Object.hasOwn(blueprint.definitions, definitionName)) {
      throw new Error(`referenced definition ${definitionName} is missing`);
    }

    definitionsBeingVisited.add(definitionName);
    const normalized = normalizeDefinition(
      blueprint.definitions[definitionName],
      definitionName,
      visitDefinition,
    );
    definitionsBeingVisited.delete(definitionName);
    normalizedDefinitions.set(definitionName, normalized);
  };

  for (const root of roots) {
    visitDefinition(root);
  }

  const definitions = {};
  for (const definitionName of [...normalizedDefinitions.keys()].sort()) {
    definitions[definitionName] = normalizedDefinitions.get(definitionName);
  }

  return { roots: [...roots], definitions };
}

export function createWireSchemaLock(
  blueprint,
  wireSchemaVersion,
  { roots = WIRE_SCHEMA_ROOTS, source = DEFAULT_BLUEPRINT_PATH } = {},
) {
  if (!Number.isSafeInteger(wireSchemaVersion) || wireSchemaVersion < 1) {
    throw new Error('wire schema version must be a positive safe integer');
  }
  assertNonEmptyString(source, 'wire schema source');

  const schema = buildWireSchema(blueprint, roots);
  return {
    formatVersion: LOCK_FORMAT_VERSION,
    wireSchemaVersion,
    source,
    schemaFingerprint: fingerprintWireSchema(schema),
    ...schema,
  };
}

export function validateWireSchemaLock(
  lock,
  { roots = WIRE_SCHEMA_ROOTS, source = DEFAULT_BLUEPRINT_PATH } = {},
) {
  assertObject(lock, 'wire schema lock');
  assertOnlyProperties(lock, lockProperties, 'wire schema lock');
  if (lock.formatVersion !== LOCK_FORMAT_VERSION) {
    throw new Error(
      `wire schema lock formatVersion must be ${LOCK_FORMAT_VERSION}`,
    );
  }
  if (
    !Number.isSafeInteger(lock.wireSchemaVersion) ||
    lock.wireSchemaVersion < 1
  ) {
    throw new Error('wire schema lock version must be a positive safe integer');
  }
  if (lock.source !== source) {
    throw new Error(`wire schema lock source must be ${source}`);
  }
  if (canonicalJson(lock.roots) !== canonicalJson(roots)) {
    throw new Error('wire schema lock roots do not match the protected roots');
  }
  assertObject(lock.definitions, 'wire schema lock definitions');

  const expectedFingerprint = fingerprintWireSchema(lock);
  if (lock.schemaFingerprint !== expectedFingerprint) {
    throw new Error(
      `wire schema lock fingerprint must be ${expectedFingerprint}`,
    );
  }

  return lock;
}

export function enforceWireSchemaVersion(
  baseLock,
  currentLock,
  validationOptions = {},
) {
  validateWireSchemaLock(currentLock, validationOptions);
  if (baseLock === null) {
    if (currentLock.wireSchemaVersion !== 1) {
      throw new Error(
        `the initial wire schema lock must use version 1, not ${currentLock.wireSchemaVersion}`,
      );
    }
    return { schemaChanged: true, versionChanged: true };
  }

  validateWireSchemaLock(baseLock, validationOptions);

  const schemaChanged =
    canonicalJson(wireSchemaPayload(baseLock)) !==
    canonicalJson(wireSchemaPayload(currentLock));
  const versionChanged =
    baseLock.wireSchemaVersion !== currentLock.wireSchemaVersion;

  if (
    schemaChanged &&
    currentLock.wireSchemaVersion <= baseLock.wireSchemaVersion
  ) {
    throw new Error(
      `wire schema changed without a version bump (base: ${baseLock.wireSchemaVersion}, current: ${currentLock.wireSchemaVersion})`,
    );
  }
  if (!schemaChanged && versionChanged) {
    throw new Error(
      `wire schema version changed from ${baseLock.wireSchemaVersion} to ${currentLock.wireSchemaVersion}, but the normalized schema did not change`,
    );
  }

  return { schemaChanged, versionChanged };
}

function readJson(path, description) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `could not read ${description} at ${path}: ${error.message}`,
    );
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `${description} at ${path} is not valid JSON: ${error.message}`,
    );
  }
}

function repositoryRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('could not locate the git repository root');
  }
}

function gitPath(repoRoot, path) {
  const relativePath = relative(repoRoot, resolve(path));
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error('wire schema lock must be inside the git repository');
  }
  return relativePath.split(sep).join('/');
}

function readLockAtRef(repoRoot, ref, lockPath) {
  execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: repoRoot,
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  const path = gitPath(repoRoot, lockPath);
  const entry = execFileSync('git', ['ls-tree', '-z', ref, '--', path], {
    cwd: repoRoot,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (entry.length === 0) {
    return null;
  }

  const decodedEntry = entry.subarray(0, entry.length - 1).toString('utf8');
  const tabIndex = decodedEntry.indexOf('\t');
  const [mode, type, object] = decodedEntry.slice(0, tabIndex).split(' ');
  if (tabIndex < 0 || mode !== '100644' || type !== 'blob' || !object) {
    throw new Error(`wire schema lock at ${ref}:${path} is not a regular file`);
  }

  const source = execFileSync('git', ['cat-file', 'blob', object], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `wire schema lock at ${ref}:${path} is not valid JSON: ${error.message}`,
    );
  }
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command !== 'check' && command !== 'update') {
    throw new Error(
      'usage: check-aiken-wire-schema.mjs <check|update> [--blueprint PATH] [--lock PATH] [--base-ref REF] [--version N]',
    );
  }

  const options = {
    command,
    blueprint: DEFAULT_BLUEPRINT_PATH,
    lock: DEFAULT_LOCK_PATH,
    baseRef: '',
    version: null,
  };
  const optionNames = new Map([
    ['--blueprint', 'blueprint'],
    ['--lock', 'lock'],
    ['--base-ref', 'baseRef'],
    ['--version', 'version'],
  ]);

  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index];
    const value = rest[index + 1];
    if (!optionNames.has(option) || value === undefined) {
      throw new Error(`invalid or incomplete option ${option ?? ''}`.trim());
    }
    const property = optionNames.get(option);
    if (property === 'version') {
      if (!/^\d+$/u.test(value)) {
        throw new Error('--version must be a positive integer');
      }
      options.version = Number(value);
    } else {
      options[property] = value;
    }
  }

  if (command === 'check' && options.version !== null) {
    throw new Error('--version is only valid with update');
  }
  if (command === 'update' && options.version === null) {
    throw new Error('update requires an explicit --version');
  }
  if (command === 'update' && options.baseRef !== '') {
    throw new Error('--base-ref is only valid with check');
  }

  return options;
}

function check(options) {
  const blueprint = readJson(options.blueprint, 'Aiken blueprint');
  const lock = validateWireSchemaLock(
    readJson(options.lock, 'wire schema lock'),
  );
  const expectedLock = createWireSchemaLock(blueprint, lock.wireSchemaVersion);

  if (canonicalJson(lock) !== canonicalJson(expectedLock)) {
    throw new Error(
      `wire schema lock is stale; regenerate it with an explicit version bump: node scripts/ci/check-aiken-wire-schema.mjs update --version ${lock.wireSchemaVersion + 1}`,
    );
  }

  const baseRef = options.baseRef.trim();
  if (baseRef !== '' && !/^0+$/u.test(baseRef)) {
    const repoRoot = repositoryRoot();
    const baseLock = readLockAtRef(repoRoot, baseRef, options.lock);
    enforceWireSchemaVersion(baseLock, lock);
  }

  console.log(
    `Aiken wire schema lock is current (version ${lock.wireSchemaVersion}, ${Object.keys(lock.definitions).length} definitions).`,
  );
}

function update(options) {
  const blueprint = readJson(options.blueprint, 'Aiken blueprint');
  const nextLock = createWireSchemaLock(blueprint, options.version);

  if (existsSync(options.lock)) {
    const currentLock = validateWireSchemaLock(
      readJson(options.lock, 'wire schema lock'),
    );
    const schemaChanged =
      canonicalJson(wireSchemaPayload(currentLock)) !==
      canonicalJson(wireSchemaPayload(nextLock));
    if (!schemaChanged) {
      throw new Error(
        'normalized wire schema has not changed; refusing an unnecessary version bump',
      );
    }
    if (options.version <= currentLock.wireSchemaVersion) {
      throw new Error(
        `wire schema version must be greater than ${currentLock.wireSchemaVersion}`,
      );
    }
  } else if (options.version !== 1) {
    throw new Error('the initial wire schema lock must use version 1');
  }

  writeFileSync(options.lock, `${JSON.stringify(nextLock, null, 2)}\n`);
  console.log(
    `Wrote Aiken wire schema version ${options.version} to ${options.lock}.`,
  );
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.command === 'check') {
    check(options);
  } else {
    update(options);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(`Aiken wire schema check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
