const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { assertSdkRehearsalEvidence } = require('./owned-sdk-rehearsal.cjs');

function fixture() {
  const genesis = '{"networkMagic":42,"systemStart":"2025-01-01T00:00:00Z"}';
  const genesisSha256 = createHash('sha256').update(genesis).digest('hex');
  const migration = { generation: '1', registryUnit: 'ab'.repeat(28) + '01', compatibility: 'cd'.repeat(32), originalAddresses: ['baseline'] };
  return {
    runtime: '/owned/runtime', artifacts: '/owned/artifacts',
    result: { project: 'cardano-deployment-test-abc123', networkRuntime: '/owned/runtime' },
    artifactResult: { project: 'cardano-deployment-test-abc123', networkRuntime: '/owned/runtime', artifacts: '/owned/artifacts' },
    genesis, actualGenesis: genesis,
    ports: { 'ogmios:1337': '127.0.0.1:2637', 'kupo:1442': '127.0.0.1:2742', 'cosmos:26657': '127.0.0.1:28757', 'cosmos:1317': '127.0.0.1:1527' },
    population: { genesisSha256 }, baseline: { migration, hostStateNFT: { policyId: 'ef'.repeat(28), name: '02' } },
    manifest: { cardano: { network_magic: 42, chain_id: 'cardano-devnet' }, migration: { ...migration, generation: '3' }, host_state_nft: { policy_id: 'ef'.repeat(28), token_name: '02' }, deployment_id: `cardano-devnet:${'ef'.repeat(28)}.02` },
    snapshot: { genesisSha256, registry: { current: { generation: '3', compatibility: migration.compatibility }, phase: 'Ready', host_policy: 'ef'.repeat(28), token: { policy_id: 'ab'.repeat(28), name: '01' } } },
  };
}

test('exact owned runtime and populated V3 provenance pass', () => {
  const evidence = fixture();
  assert.equal(assertSdkRehearsalEvidence(evidence), evidence.population.genesisSha256);
});
for (const [label, mutate, error] of [
  ['other runtime', f => f.result.networkRuntime = '/other', /Runtime provenance/],
  ['other artifacts', f => f.artifactResult.project += '00', /Artifact project/],
  ['redirected provider', f => f.ports['ogmios:1337'] = '127.0.0.1:9999', /Provider ogmios/],
  ['other node genesis', f => f.actualGenesis += ' ', /provider genesis/],
  ['other wallet fixture', f => f.population.genesisSha256 = '00', /Wallet population genesis/],
  ['other state fixture', f => f.snapshot.genesisSha256 = '00', /State population genesis/],
  ['renamed V2 manifest', f => f.manifest.migration.generation = '2', /actual V3/],
  ['renamed V2 state', f => f.snapshot.registry.current.generation = '2', /populated V3/],
  ['unactivated state', f => f.snapshot.registry.phase = 'Moving', /activated V3/],
  ['different bridge', f => f.manifest.host_state_nft.policy_id = '00', /Host NFT mismatch/],
  ['different registry', f => f.manifest.migration.registryUnit = '00', /Registry identity/],
  ['different compatibility', f => f.manifest.migration.compatibility = '00', /Compatibility mismatch/],
]) {
  test(`reject ${label} before any SDK evaluation`, () => {
    const evidence = fixture();
    assert.doesNotThrow(() => assertSdkRehearsalEvidence(evidence));
    mutate(evidence);
    assert.throws(() => assertSdkRehearsalEvidence(evidence), error);
  });
}
