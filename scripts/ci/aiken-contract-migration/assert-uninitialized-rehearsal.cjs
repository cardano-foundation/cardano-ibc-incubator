const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { ownedRuntimeProviders } = require('./owned-runtime-providers.cjs');

function assertNoIbcState(host, clients, connections, channels) {
  assert.equal(host.index, 0, 'Invalid HostState datum');
  assert.equal(host.fields.length, 4, 'Unsupported HostState datum');
  const state = host.fields[0];
  assert.equal(state.index, 0);
  assert.equal(state.fields.length, 7);
  assert.deepEqual(state.fields.slice(2, 5), [0n, 0n, 0n], 'Pool aging must precede all Cardano IBC clients, connections and channels');
  assert.ok(Array.isArray(clients.client_states), 'Unavailable counterparty client inventory');
  assert.ok(clients.client_states.length <= 1 && clients.client_states.every(client =>
    client.client_id === '09-localhost' && client.client_state?.['@type'] === '/ibc.lightclients.localhost.v2.ClientState'),
    'Pool aging must precede all foreign counterparty IBC clients');
  assert.ok(!clients.pagination?.next_key, 'Counterparty client inventory is incomplete');
  const localhost = { id: 'connection-localhost', client_id: '09-localhost',
    versions: [{ identifier: '1', features: ['ORDER_ORDERED', 'ORDER_UNORDERED'] }], state: 'STATE_OPEN',
    counterparty: { client_id: '09-localhost', connection_id: 'connection-localhost', prefix: { key_prefix: 'aWJj' } },
    delay_period: '0' };
  assert.ok(Array.isArray(connections?.connections) && connections.connections.length <= 1 && !connections.pagination?.next_key,
    'Counterparty connection inventory is unavailable or contains foreign connections');
  for (const connection of connections.connections) assert.deepEqual(connection, localhost, 'Pool aging must precede foreign counterparty connections');
  assert.ok(Array.isArray(channels?.channels) && channels.channels.length === 0 && !channels.pagination?.next_key,
    'Pool aging must precede all counterparty channels');
}

async function main() {
  const runtime = fs.realpathSync(process.argv[2]);
  const providers = ownedRuntimeProviders(runtime, true);
  const result = JSON.parse(fs.readFileSync(path.join(runtime, 'result.json'), 'utf8'));
  assert.equal(result.artifacts, runtime, 'Pool aging requires the original owned baseline');
  const handler = JSON.parse(fs.readFileSync(path.join(runtime, 'handler.json'), 'utf8'));
  const host = handler.hostStateNFT, unit = host.policyId + '.' + host.name;
  async function json(url) {
    const deadline = Date.now() + 60000;
    for (;;) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        assert.ok(response.ok, `Owned fixture query failed: ${response.status}`);
        return await response.json();
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  const outputs = await json(`http://${providers.kupo}/matches/${unit}?unspent`);
  assert.equal(outputs.length, 1, 'Unique owned HostState NFT is required');
  assert.equal(outputs[0].value.assets[unit], 1, 'Owned HostState NFT quantity differs');
  assert.equal(outputs[0].address, handler.validators.hostStateStt.address, 'Owned HostState implementation differs');
  const datum = await json(`http://${providers.kupo}/datums/${outputs[0].datum_hash}`);
  const root = path.resolve(__dirname, '../../..');
  const req = createRequire(path.join(root, 'cardano/gateway/package.json'));
  const { Data } = req('@lucid-evolution/lucid');
  const [clients, connections, channels] = await Promise.all([
    json(`http://${providers.cosmosRest}/ibc/core/client/v1/client_states`),
    json(`http://${providers.cosmosRest}/ibc/core/connection/v1/connections`),
    json(`http://${providers.cosmosRest}/ibc/core/channel/v1/channels`),
  ]);
  assertNoIbcState(Data.from(datum.datum), clients, connections, channels);
  console.log(JSON.stringify({ poolAgingPermitted: true, genesisSha256: providers.genesisSha256 }));
}

module.exports = { assertNoIbcState };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
