const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const endpoints = [['ogmios', '1337', '2637'], ['kupo', '1442', '2742'], ['cosmos', '26657', '28757'], ['cosmos', '1317', '1527']];

// Pure provenance checks are exercised with independently mutated fixtures.
function assertSdkRehearsalEvidence({ runtime, artifacts, result, artifactResult, genesis, actualGenesis, ports, population, baseline, manifest, snapshot }) {
  assert.match(result.project, /^cardano-deployment-test-[a-z0-9]+$/, 'Owned Docker project required');
  assert.equal(result.networkRuntime, runtime, 'Runtime provenance mismatch');
  assert.equal(artifactResult.networkRuntime, runtime, 'Artifact runtime mismatch');
  assert.equal(artifactResult.project, result.project, 'Artifact project mismatch');
  assert.equal(artifactResult.artifacts, artifacts, 'Artifact directory mismatch');
  assert.equal(actualGenesis, genesis, 'Actual provider genesis mismatch');
  assert.equal(JSON.parse(genesis).networkMagic, 42, 'Owned magic-42 fixture required');
  for (const [service, internal, external] of endpoints) {
    assert.equal(ports[`${service}:${internal}`], `127.0.0.1:${external}`, `Provider ${service} is not owned by selected runtime`);
  }
  const genesisSha256 = createHash('sha256').update(genesis).digest('hex');
  assert.equal(population.genesisSha256, genesisSha256, 'Wallet population genesis mismatch');
  assert.equal(snapshot.genesisSha256, genesisSha256, 'State population genesis mismatch');
  assert.equal(manifest.cardano.network_magic, 42);
  assert.equal(manifest.migration.generation, '3', 'Expected actual V3 manifest');
  assert.equal(snapshot.registry.current.generation, '3', 'Expected populated V3 state');
  assert.equal(snapshot.registry.phase, 'Ready', 'Expected activated V3');
  assert.equal(baseline.migration.generation, '1', 'Expected original baseline');
  const host = baseline.hostStateNFT;
  assert.equal(manifest.host_state_nft.policy_id, host.policyId, 'Deployment Host NFT mismatch');
  assert.equal(manifest.host_state_nft.token_name, host.name, 'Deployment Host NFT name mismatch');
  assert.equal(snapshot.registry.host_policy, host.policyId, 'Population deployment mismatch');
  assert.equal(manifest.deployment_id, `${manifest.cardano.chain_id}:${host.policyId}.${host.name}`, 'Deployment identity mismatch');
  assert.equal(manifest.migration.registryUnit, baseline.migration.registryUnit, 'Registry identity mismatch');
  assert.equal(manifest.migration.registryUnit, snapshot.registry.token.policy_id + snapshot.registry.token.name, 'Population registry mismatch');
  assert.equal(manifest.migration.compatibility, baseline.migration.compatibility, 'Compatibility mismatch');
  assert.equal(manifest.migration.compatibility, snapshot.registry.current.compatibility, 'Population compatibility mismatch');
  assert.deepEqual(manifest.migration.originalAddresses, baseline.migration.originalAddresses, 'Original implementation mismatch');
  return genesisSha256;
}

function validateSdkRehearsal(runtimeArg, artifactsArg) {
  const root = path.resolve(__dirname, '../..');
  const runtime = fs.realpathSync(runtimeArg), artifacts = fs.realpathSync(artifactsArg);
  for (const directory of [runtime, artifacts]) {
    assert.ok(directory.startsWith(path.join(root, '.deployment-smoke') + path.sep), 'Owned rehearsal paths required');
  }
  const read = (directory, file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
  const result = read(runtime, 'result.json');
  // Validate project and path before passing anything to Docker.
  assert.match(result.project, /^cardano-deployment-test-[a-z0-9]+$/);
  assert.equal(result.networkRuntime, runtime);
  const docker = args => execFileSync('docker', ['compose', '-p', result.project, '-f', path.join(runtime, 'compose.json'), ...args], { encoding: 'utf8', timeout: 30000 });
  const evidence = {
    runtime, artifacts, result, artifactResult: read(artifacts, 'result.json'),
    genesis: fs.readFileSync(path.join(runtime, 'runtime/genesis-shelley.json'), 'utf8'),
    actualGenesis: docker(['exec', '-T', 'node', 'cat', '/runtime/genesis-shelley.json']),
    ports: Object.fromEntries(endpoints.map(([service, port]) => [`${service}:${port}`, docker(['port', service, port]).trim()])),
    population: read(runtime, 'wallet-population.json'), baseline: read(artifacts, 'handler.json'),
    manifest: read(artifacts, 'bridge-manifest-3.json'), snapshot: read(artifacts, 'population-after-v3.json'),
  };
  return { ...evidence, genesisSha256: assertSdkRehearsalEvidence(evidence) };
}
module.exports = { assertSdkRehearsalEvidence, validateSdkRehearsal };
