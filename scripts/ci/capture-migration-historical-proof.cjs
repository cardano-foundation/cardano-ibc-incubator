#!/usr/bin/env node
// Query a cold Gateway at an exact, already accepted Cardano root. Read-only.
// This captures the actual protobuf wire payload; counterparty transaction
// acceptance must be established separately, not inferred from this report.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const gatewayRequire = createRequire(path.join(root, 'cardano/gateway/package.json'));
const grpc = gatewayRequire('@grpc/grpc-js');
const loader = gatewayRequire('@grpc/proto-loader');

async function main() {
  const [runtimeArg, handlerArg, clientId, height, channelId, sequence, outputArg] = process.argv.slice(2);
  if (!outputArg) throw new Error('Usage: capture-migration-historical-proof.cjs OWNED_RUNTIME HANDLER COSMOS_CLIENT CARDANO_HEIGHT CARDANO_CHANNEL SEQUENCE NEW_REPORT');
  const runtime = fs.realpathSync(runtimeArg), handlerPath = fs.realpathSync(handlerArg), output = path.resolve(outputArg);
  for (const p of [runtime, handlerPath, output]) {
    assert(p.startsWith(path.join(root, '.deployment-smoke') + path.sep), 'Explicit owned rehearsal paths required');
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, 'runtime/genesis-shelley.json'))).networkMagic, 42);
  assert.match(clientId, /^08-cardano-probabilistic-\d+$/);
  assert.match(channelId, /^channel-\d+$/);
  for (const n of [height, sequence]) assert.match(n, /^[1-9]\d*$/);
  const handler = JSON.parse(fs.readFileSync(handlerPath));
  assert.equal(handler.migration.profile, 'cardano-ibc-compatible-v2');
  const rest = async (route) => {
    const response = await fetch('http://127.0.0.1:1527' + route, { signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `Counterparty query failed: ${response.status} ${route}`);
    return response.json();
  };
  const { client_state: client } = await rest(`/ibc/core/client/v1/client_states/${clientId}`);
  assert.equal(client['@type'], '/ibc.lightclients.probabilistic.v1.ClientState');
  assert.equal(Buffer.from(client.host_state_nft_policy_id, 'base64').toString('hex'), handler.hostStateNFT.policyId);
  assert.equal(Buffer.from(client.host_state_nft_token_name, 'base64').toString('hex'), handler.hostStateNFT.name);
  const { consensus_state: consensus } = await rest(`/ibc/core/client/v1/consensus_states/${clientId}/revision/0/height/${height}`);
  assert.equal(consensus['@type'], '/ibc.lightclients.probabilistic.v1.ConsensusState');
  assert.equal(Buffer.from(consensus.ibc_state_root, 'base64').length, 32);
  const protoRoot = path.join(root, 'proto-types/protos/ibc-go');
  const definition = loader.loadSync(path.join(protoRoot, 'ibc/core/channel/v1/query.proto'), {
    keepCase: true, longs: String, enums: String, includeDirs: [protoRoot],
  });
  const Query = grpc.loadPackageDefinition(definition).ibc.core.channel.v1.Query;
  const query = new Query('127.0.0.1:5501', grpc.credentials.createInsecure());
  const metadata = new grpc.Metadata();
  metadata.set('x-cosmos-block-height', height);
  function call(method, request) {
    return new Promise((resolve, reject) => query[method](request, metadata, {
      deadline: Date.now() + 120_000,
    }, (error, response) => error ? reject(error) : resolve(response)));
  }
  try {
    const channel = await call('Channel', { port_id: 'transfer', channel_id: channelId });
    const ack = await call('PacketAcknowledgement', { port_id: 'transfer', channel_id: channelId, sequence });
    for (const proof of [channel, ack]) {
      assert.equal(proof.proof_height.revision_height, height);
      assert(proof.proof.length > 0, 'Historical proof must be present');
    }
    assert.equal(channel.channel.state, 'STATE_OPEN');
    // No hex/base64 repair: malformed application bytes on the real gRPC wire
    // must fail here, before they can be submitted to the counterparty.
    const acknowledgement = JSON.parse(ack.acknowledgement.toString('utf8'));
    assert(Object.hasOwn(acknowledgement, 'result') || Object.hasOwn(acknowledgement, 'error'));
    const readiness = await fetch('http://127.0.0.1:8800/health/ready', { signal: AbortSignal.timeout(30_000) });
    const evidence = {
      format: 'cardano-ibc-historical-proof-v1', clientId, height, channelId, sequence,
      hostStateNFT: handler.hostStateNFT, consensus,
      channel: channel.channel, proofHeight: ack.proof_height,
      acknowledgementBase64: ack.acknowledgement.toString('base64'),
      acknowledgementProofBase64: ack.proof.toString('base64'),
      channelProofBase64: channel.proof.toString('base64'),
      readinessStatus: readiness.status,
      scope: 'Actual Gateway gRPC response and existing counterparty consensus state; no transaction acceptance claim',
    };
    fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, clientId, height, channelId, sequence, readinessStatus: readiness.status, acknowledgement }));
  } finally { query.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
