#!/usr/bin/env node

/**
 * Test helper: Query a denom trace by hash from Gateway gRPC endpoint
 * 
 * This script queries the Gateway's Query.DenomTrace gRPC endpoint to retrieve
 * denom trace information for a given hash (voucher token name).
 * 
 * Usage:
 *   node query-denom-trace.js <hash>
 * 
 * Example:
 *   node query-denom-trace.js abc123def456...
 * 
 * Output: JSON object with denom_trace containing path and base_denom
 */

const path = require('path');

// Use proto-types package from project root
const protoTypesPath = path.join(__dirname, '../../../../proto-types');
const grpc = require(path.join(protoTypesPath, 'node_modules/@grpc/grpc-js'));
const protoLoader = require(path.join(protoTypesPath, 'node_modules/@grpc/proto-loader'));

// Get hash from command line arguments
const hash = process.argv[2];

if (!hash) {
  console.error('ERROR: Hash argument is required');
  console.error('Usage: node query-denom-trace.js <hash>');
  process.exit(1);
}

// Load proto definitions for QueryDenomTrace
const PROTO_PATH = path.join(protoTypesPath, 'protos/ibc-go/ibc/applications/transfer/v1/query.proto');
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.join(protoTypesPath, 'protos/ibc-go/')]
});

const proto = grpc.loadPackageDefinition(packageDefinition);

// Create gRPC client
const client = new proto.ibc.applications.transfer.v1.Query(
  'localhost:5001',
  grpc.credentials.createInsecure()
);

const request = {
  hash: hash,
};

// Call DenomTrace query
client.DenomTrace(request, (error, response) => {
  if (error) {
    console.error('ERROR: Failed to query denom trace');
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
    process.exit(1);
  }

  // Output JSON response
  console.log(JSON.stringify({
    hash: hash,
    path: response.denom_trace?.path || null,
    base_denom: response.denom_trace?.base_denom || null,
  }, null, 2));
  
  process.exit(0);
});

