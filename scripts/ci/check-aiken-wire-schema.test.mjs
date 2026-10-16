import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  WIRE_SCHEMA_ROOTS,
  buildWireSchema,
  createWireSchemaLock,
  enforceWireSchemaVersion,
  fingerprintWireSchema,
  requireDestinationWireCompatibility,
  validateWireSchemaLock,
} from './check-aiken-wire-schema.mjs';

const fixtureRoots = ['example/Root', 'example/SecondRoot'];
const fixtureOptions = {
  roots: fixtureRoots,
  source: 'fixture/plutus.json',
};

const packetLaneRoot = 'ibc/core/ics_004/packet_lane_datum/PacketLaneDatum';
const upgradeRoot = 'ibc/core/ics_004/types/upgrade/Upgrade';
const errorReceiptRoot = 'ibc/core/ics_004/types/upgrade/ErrorReceipt';
const upgradeFields = 'ibc/core/ics_004/types/upgrade/UpgradeFields';
const upgradeTimeout = 'ibc/core/ics_004/types/upgrade/UpgradeTimeout';

function checkedInLock() {
  return JSON.parse(readFileSync(
    new URL('../../cardano/onchain/wire-schema.lock.json', import.meta.url),
    'utf8',
  ));
}

// Reconstruct a blueprint fixture from the reviewed records so CLI controls
// run without requiring an Aiken build in the fast JavaScript test job.
function blueprintFromLock(lock) {
  const type = (value) => {
    if (value.ref) return reference(value.ref);
    if (value.type === 'list') {
      return { dataType: 'list', items: type(value.items) };
    }
    if (value.type === 'map') {
      return { dataType: 'map', keys: type(value.keys), values: type(value.values) };
    }
    return { dataType: value.type };
  };
  const definitions = {};
  for (const [name, definition] of Object.entries(lock.definitions)) {
    definitions[name] = definition.type === 'sum'
      ? { anyOf: definition.constructors.map((constructor) => ({
        title: constructor.name,
        dataType: 'constructor',
        index: constructor.index,
        fields: constructor.fields.map((field) => ({ title: field.name, ...type(field.type) })),
      })) }
      : type(definition);
  }
  return { definitions };
}

function reference(definitionName) {
  const pointerName = definitionName
    .replaceAll('~', '~0')
    .replaceAll('/', '~1');
  return { $ref: `#/definitions/${pointerName}` };
}

function fixtureBlueprint() {
  return {
    definitions: {
      'example/Root': {
        title: 'Root',
        description: 'Ignored documentation.',
        anyOf: [
          {
            title: 'Root',
            dataType: 'constructor',
            index: 0,
            fields: [
              { title: 'payload', ...reference('example/Nested') },
              { title: 'items', ...reference('List<example/Nested>') },
              {
                title: 'lookup',
                ...reference('Pairs<ByteArray,example/Nested>'),
              },
            ],
          },
        ],
      },
      'example/SecondRoot': {
        dataType: 'list',
        items: reference('ByteArray'),
      },
      'example/Nested': {
        title: 'Nested',
        anyOf: [
          {
            title: 'WithValue',
            dataType: 'constructor',
            index: 1,
            fields: [{ title: 'amount', ...reference('Int') }],
          },
          {
            title: 'Empty',
            dataType: 'constructor',
            index: 0,
            fields: [],
          },
        ],
      },
      'List<example/Nested>': {
        dataType: 'list',
        items: reference('example/Nested'),
      },
      'Pairs<ByteArray,example/Nested>': {
        dataType: 'map',
        keys: reference('ByteArray'),
        values: reference('example/Nested'),
      },
      ByteArray: { dataType: 'bytes' },
      Int: { dataType: 'integer' },
      Unreachable: {
        unsupported: 'ignored because this definition is not on the wire graph',
      },
    },
  };
}

test('recursively records only reachable definitions in canonical order', () => {
  const schema = buildWireSchema(fixtureBlueprint(), fixtureRoots);

  assert.deepEqual(Object.keys(schema.definitions), [
    'ByteArray',
    'Int',
    'List<example/Nested>',
    'Pairs<ByteArray,example/Nested>',
    'example/Nested',
    'example/Root',
    'example/SecondRoot',
  ]);
  assert.deepEqual(schema.definitions['example/Nested'], {
    type: 'sum',
    constructors: [
      { name: 'Empty', index: 0, fields: [] },
      {
        name: 'WithValue',
        index: 1,
        fields: [{ name: 'amount', type: { ref: 'Int' } }],
      },
    ],
  });
  assert.deepEqual(schema.definitions['example/Root'].constructors[0].fields, [
    { name: 'payload', type: { ref: 'example/Nested' } },
    { name: 'items', type: { ref: 'List<example/Nested>' } },
    {
      name: 'lookup',
      type: { ref: 'Pairs<ByteArray,example/Nested>' },
    },
  ]);
  assert.deepEqual(schema.definitions['Pairs<ByteArray,example/Nested>'], {
    type: 'map',
    keys: { ref: 'ByteArray' },
    values: { ref: 'example/Nested' },
  });
});

test('ignores documentation while detecting wire-relevant changes', () => {
  const original = fixtureBlueprint();
  const documentationEdit = structuredClone(original);
  documentationEdit.definitions['example/Root'].description = 'New docs.';
  documentationEdit.definitions['example/Root'].anyOf[0].fields[0].description =
    'New field docs.';

  const originalSchema = buildWireSchema(original, fixtureRoots);
  assert.equal(
    fingerprintWireSchema(buildWireSchema(documentationEdit, fixtureRoots)),
    fingerprintWireSchema(originalSchema),
  );

  for (const mutate of [
    (blueprint) => {
      blueprint.definitions['example/Nested'].anyOf[0].index = 2;
    },
    (blueprint) => {
      blueprint.definitions['example/Root'].anyOf[0].fields.reverse();
    },
    (blueprint) => {
      blueprint.definitions['example/Nested'].anyOf[0].fields[0] = {
        title: 'amount',
        ...reference('ByteArray'),
      };
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.notEqual(
      fingerprintWireSchema(buildWireSchema(changed, fixtureRoots)),
      fingerprintWireSchema(originalSchema),
    );
  }
});

test('fails closed for missing references and unsupported schema shapes', () => {
  const missingReference = fixtureBlueprint();
  missingReference.definitions['example/Root'].anyOf[0].fields[0] = {
    title: 'payload',
    ...reference('example/Missing'),
  };
  assert.throws(
    () => buildWireSchema(missingReference, fixtureRoots),
    /referenced definition example\/Missing is missing/,
  );

  const unsupportedProperty = fixtureBlueprint();
  unsupportedProperty.definitions['example/Nested'].wireEncoding = 'new';
  assert.throws(
    () => buildWireSchema(unsupportedProperty, fixtureRoots),
    /unsupported properties: wireEncoding/,
  );

  const duplicateIndex = fixtureBlueprint();
  duplicateIndex.definitions['example/Nested'].anyOf[0].index = 0;
  assert.throws(
    () => buildWireSchema(duplicateIndex, fixtureRoots),
    /duplicate constructor index 0/,
  );
});

test('requires a higher version exactly when the normalized schema changes', () => {
  const original = fixtureBlueprint();
  const changed = structuredClone(original);
  changed.definitions['example/Root'].anyOf[0].fields.reverse();

  const base = createWireSchemaLock(original, 3, fixtureOptions);
  const unchanged = createWireSchemaLock(original, 3, fixtureOptions);
  assert.deepEqual(enforceWireSchemaVersion(base, unchanged, fixtureOptions), {
    schemaChanged: false,
    versionChanged: false,
  });

  const changedWithoutBump = createWireSchemaLock(changed, 3, fixtureOptions);
  assert.throws(
    () => enforceWireSchemaVersion(base, changedWithoutBump, fixtureOptions),
    /changed without a version bump/,
  );

  const changedWithBump = createWireSchemaLock(changed, 4, fixtureOptions);
  assert.deepEqual(
    enforceWireSchemaVersion(base, changedWithBump, fixtureOptions),
    { schemaChanged: true, versionChanged: true },
  );

  const unnecessaryBump = createWireSchemaLock(original, 4, fixtureOptions);
  assert.throws(
    () => enforceWireSchemaVersion(base, unnecessaryBump, fixtureOptions),
    /normalized schema did not change/,
  );
});

test('requires version 1 for the initial lock and validates fingerprints', () => {
  const versionOne = createWireSchemaLock(
    fixtureBlueprint(),
    1,
    fixtureOptions,
  );
  assert.deepEqual(enforceWireSchemaVersion(null, versionOne, fixtureOptions), {
    schemaChanged: true,
    versionChanged: true,
  });

  const versionTwo = createWireSchemaLock(
    fixtureBlueprint(),
    2,
    fixtureOptions,
  );
  assert.throws(
    () => enforceWireSchemaVersion(null, versionTwo, fixtureOptions),
    /initial wire schema lock must use version 1/,
  );

  const tampered = structuredClone(versionOne);
  tampered.definitions.ByteArray.type = 'integer';
  assert.throws(
    () => validateWireSchemaLock(tampered, fixtureOptions),
    /fingerprint must be sha256:/,
  );
});

test('adds protected roots without dropping earlier coverage', () => {
  const original = fixtureBlueprint();
  const base = createWireSchemaLock(original, 3, fixtureOptions);
  const expandedOptions = { ...fixtureOptions, roots: [...fixtureRoots, 'example/Nested'] };
  const expanded = createWireSchemaLock(original, 4, expandedOptions);
  assert.deepEqual(enforceWireSchemaVersion(base, expanded, expandedOptions), {
    schemaChanged: true,
    versionChanged: true,
  });
  const withoutBump = createWireSchemaLock(original, 3, expandedOptions);
  assert.throws(
    () => enforceWireSchemaVersion(base, withoutBump, expandedOptions),
    /changed without a version bump/,
  );
  const reducedOptions = { ...fixtureOptions, roots: ['example/Root'] };
  const reduced = createWireSchemaLock(original, 4, reducedOptions);
  assert.throws(
    () => enforceWireSchemaVersion(base, reduced, reducedOptions),
    /protected wire roots were removed: example\/SecondRoot/,
  );
});

test('protects packet lanes and channel upgrade records with their nested types', () => {
  const lock = checkedInLock();
  for (const root of [packetLaneRoot, upgradeRoot, errorReceiptRoot]) {
    assert.ok(WIRE_SCHEMA_ROOTS.includes(root), `${root} must be a protected root`);
  }
  assert.deepEqual(lock.definitions[packetLaneRoot].constructors[0].fields.map((field) => field.name), [
    'port_id', 'channel_id', 'lane', 'lane_count', 'version', 'root',
    'commitments', 'receipts', 'acknowledgements',
    'minimum_receive_proof_height', 'maximum_receive_proof_height', 'balances',
  ]);
  for (const name of [upgradeFields, upgradeTimeout]) {
    assert.ok(Object.hasOwn(lock.definitions, name), `${name} must be reached recursively`);
  }
  const blueprint = blueprintFromLock(lock);
  assert.deepEqual(buildWireSchema(blueprint), {
    roots: lock.roots,
    definitions: lock.definitions,
  });
  requireDestinationWireCompatibility(lock);
  blueprint.definitions['example/InternalOperationalState'] = { dataType: 'integer' };
  requireDestinationWireCompatibility(buildWireSchema(blueprint));
});

for (const name of [packetLaneRoot, upgradeRoot, errorReceiptRoot, upgradeFields, upgradeTimeout]) {
  for (const [change, mutate] of Object.entries({
    constructor: (record) => { record.index++; },
    order: (record) => { record.fields.reverse(); },
    type: (record) => {
      record.fields[0] = { title: record.fields[0].title, ...reference('Int') };
    },
    append: (record) => { record.fields.push({ title: 'operational', ...reference('Int') }); },
  })) {
    test(`rejects a consumed ${name} ${change} change even after a lock version bump`, () => {
      const lock = checkedInLock();
      const blueprint = blueprintFromLock(lock);
      if (change === 'type' && blueprint.definitions[name].anyOf[0].fields[0].$ref === reference('Int').$ref) {
        blueprint.definitions[name].anyOf[0].fields[0].$ref = reference('ByteArray').$ref;
      } else {
        mutate(blueprint.definitions[name].anyOf[0]);
      }
      const changed = createWireSchemaLock(blueprint, lock.wireSchemaVersion + 1);
      assert.deepEqual(enforceWireSchemaVersion(lock, changed), {
        schemaChanged: true,
        versionChanged: true,
      });
      assert.throws(
        () => requireDestinationWireCompatibility(changed),
        /schema-version bump does not establish compatibility with deployed readers/,
      );
    });
  }
}

test('regenerating a lock does not approve a changed packet-lane layout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cardano-wire-schema-'));
  try {
    const lock = checkedInLock();
    const blueprint = blueprintFromLock(lock);
    blueprint.definitions[packetLaneRoot].anyOf[0].fields.push({ title: 'operational', ...reference('Int') });
    const blueprintPath = join(directory, 'plutus.json');
    const lockPath = join(directory, 'wire-schema.lock.json');
    writeFileSync(blueprintPath, JSON.stringify(blueprint));
    writeFileSync(lockPath, JSON.stringify(lock));
    const script = fileURLToPath(new URL('./check-aiken-wire-schema.mjs', import.meta.url));
    const args = ['--blueprint', blueprintPath, '--lock', lockPath];
    const before = spawnSync(process.execPath, [script, 'check', ...args], { encoding: 'utf8' });
    assert.equal(before.status, 1);
    assert.match(before.stderr, /wire schema lock is stale/);
    const update = spawnSync(process.execPath, [script, 'update', ...args, '--version', String(lock.wireSchemaVersion + 1)], { encoding: 'utf8' });
    assert.equal(update.status, 0, update.stderr);
    const after = spawnSync(process.execPath, [script, 'check', ...args], { encoding: 'utf8' });
    assert.equal(after.status, 1);
    assert.match(after.stderr, /schema-version bump does not establish compatibility with deployed readers/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
