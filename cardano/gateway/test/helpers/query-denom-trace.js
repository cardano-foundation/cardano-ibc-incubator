#!/usr/bin/env node

/**
 * Test helper: Query a denom by hash from Gateway gRPC endpoint
 * 
 * This script queries the Gateway's Query.Denom gRPC endpoint to retrieve
 * denomination information for a given hash (voucher token name).
 * 
 * Usage:
 *   node query-denom-trace.js <hash>
 * 
 * Example:
 *   node query-denom-trace.js abc123def456...
 * 
 * Output: JSON object with denom containing base and trace hops
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

// Load proto definitions for QueryDenom
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

// Call Denom query
client.Denom(request, (error, response) => {
  if (error) {
    console.error('ERROR: Failed to query denom');
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
    process.exit(1);
  }

  // Output JSON response
  console.log(JSON.stringify({
    hash: hash,
    denom: response.denom || null,
  }, null, 2));
  
  process.exit(0);
});
