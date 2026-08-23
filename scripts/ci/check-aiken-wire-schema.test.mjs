import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWireSchema,
  createWireSchemaLock,
  enforceWireSchemaVersion,
  fingerprintWireSchema,
  validateWireSchemaLock,
} from './check-aiken-wire-schema.mjs';

const fixtureRoots = ['example/Root', 'example/SecondRoot'];
const fixtureOptions = {
  roots: fixtureRoots,
  source: 'fixture/plutus.json',
};

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
