const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseExactJson } = require('./rehearsal-json.cjs');

test('evidence distinguishes single-unit changes above JavaScript integer precision', () => {
  const first = parseExactJson('{"assets":{"native":1000000000000000111},"nft":1}');
  const second = parseExactJson('{"assets":{"native":1000000000000000112},"nft":1}');
  assert.equal(first.assets.native, 1000000000000000111n);
  assert.equal(second.assets.native - first.assets.native, 1n);
  assert.equal(first.nft, 1);
  assert.notDeepEqual(first, second);
});

test('evidence rejects non-finite and ambiguous large numbers', () => {
  assert.equal(parseExactJson('{"coefficient":0.05}').coefficient, 0.05);
  for (const value of ['1e400', '1e18', '9007199254740992.5']) {
    assert.throws(() => parseExactJson(`{"amount":${value}}`));
  }
});
