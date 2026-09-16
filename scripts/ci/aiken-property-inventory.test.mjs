import { test } from 'node:test';
import assert from 'node:assert/strict';
import { properties, inventory } from './aiken-property-inventory.mjs';

test('discovers properties regardless of naming and skips unit regressions', () => {
  assert.deepEqual(properties('test plain(x via fuzz.int()) { x == x }\ntest fixed() { True }').map(x => x.title), ['plain']);
});
test('ignores tests and parameter references in comments and strings', () => {
  assert.deepEqual(properties('// test fake(x via fuzz.int()) { x }\nconst s = "test fake(x via f()) { x }"'), []);
  assert.throws(() => properties('test p(seed via f()) { trace @"seed" // seed\n True }'), /unused/);
});
test('rejects discarded generated input', () => {
  assert.throws(() => properties('test p(_seed via fuzz.int()) { True }'), /must bind/);
});
test('supports nested generator arguments and multiline headers', () => {
  assert.equal(properties('test p(\n sample via fuzz.map(fuzz.int(), fn(n) { n + 1 }),\n) fail { sample == 0 }').length, 1);
});
test('source inventory includes the previously omitted host properties', () => {
  const titles = inventory('cardano/onchain').map(x => x.title);
  assert(titles.includes('sequence_transitions_preserve_protected_fields'));
  assert(titles.includes('shutdown_permits_root_updates_but_no_creation'));
});
