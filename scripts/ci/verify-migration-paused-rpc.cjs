#!/usr/bin/env node
// Read-only negative controls against the actual historical Gateway process.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const gatewayRequire = createRequire(path.join(root, 'cardano/gateway/package.json'));
const grpc = gatewayRequire('@grpc/grpc-js');
const loader = gatewayRequire('@grpc/proto-loader');

async function main() {
  const [outputArg] = process.argv.slice(2);
  assert(outputArg, 'Usage: verify-migration-paused-rpc.cjs NEW_REPORT');
  const output = path.resolve(outputArg);
  assert(output.startsWith(path.join(root, '.deployment-smoke') + path.sep));
  const protoRoot = path.join(root, 'proto-types/protos/ibc-go');
  const definition = loader.loadSync([
    path.join(protoRoot, 'ibc/core/channel/v1/query.proto'),
    path.join(protoRoot, 'ibc/cardano/v1/tx.proto'),
  ], { keepCase: true, longs: String, enums: String, includeDirs: [protoRoot] });
  const ibc = grpc.loadPackageDefinition(definition).ibc;
  const query = new ibc.core.channel.v1.Query('127.0.0.1:5501', grpc.credentials.createInsecure());
  const tx = new ibc.cardano.v1.CardanoMsg('127.0.0.1:5501', grpc.credentials.createInsecure());
  async function rejected(client, method, request, message) {
    const error = await new Promise((resolve, reject) => client[method](request, {
      deadline: Date.now() + 60_000,
    }, (error, response) => error ? resolve(error) : reject(new Error(`${method} unexpectedly succeeded: ${JSON.stringify(response)}`))));
    assert.equal(error.code, grpc.status.FAILED_PRECONDITION, `${method}: ${error.message}`);
    assert.match(error.details, message);
    return { method, code: error.code, details: error.details };
  }
  try {
    const results = [];
    results.push(await rejected(query, 'PacketCommitments', { port_id: 'transfer', channel_id: 'channel-0' }, /migration is in progress/i));
    results.push(await rejected(tx, 'BuildHostStateHeartbeat', { signer: '8f310f79f977bdf0befedfae3374a625e64c9a69a40c3c8fca607dac' }, /historical.*read.only/i));
    fs.writeFileSync(output, JSON.stringify({ format: 'migration-paused-rpc-v1', results }, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ output, results }));
  } finally { query.close(); tx.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
