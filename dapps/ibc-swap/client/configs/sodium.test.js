const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const test = require('node:test');

test('MeshSDK shares the Node libsodium wrapper instead of initializing duplicate copies', async () => {
  const wrapperPath = require.resolve('libsodium-wrappers-sumo');
  const providerRequire = createRequire(require.resolve('@meshsdk/provider'));
  const meshEntrypoints = [
    require.resolve('@meshsdk/core-cst'),
    require.resolve('@meshsdk/transaction'),
    require.resolve('@meshsdk/provider'),
    providerRequire.resolve('@meshsdk/core-cst'),
  ];

  for (const entrypoint of meshEntrypoints) {
    assert.equal(
      createRequire(entrypoint).resolve('libsodium-wrappers-sumo'),
      wrapperPath,
      `${entrypoint} must share the root wrapper`,
    );
  }

  // The newer Cardano SDK carries a separate 0.8.x sodium runtime; both must
  // also be able to initialize in the same server process.
  const cardanoSdkRequire = createRequire(require.resolve('@cardano-sdk/crypto'));
  await Promise.all([
    require(wrapperPath).ready,
    cardanoSdkRequire('libsodium-wrappers-sumo').ready,
  ]);
});
