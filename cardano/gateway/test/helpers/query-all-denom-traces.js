#!/usr/bin/env node

/**
 * Test helper: Query all denoms from Gateway gRPC endpoint
 * 
 * This script queries the Gateway's Query.Denoms gRPC endpoint to retrieve
 * all denom information stored in the database.
 * 
 * Usage:
 *   node query-all-denom-traces.js [limit] [offset]
 * 
 * Example:
 *   node query-all-denom-traces.js 10 0
 * 
 * Output: JSON array of denoms with base and trace hops
 */

const path = require('path');

// Use proto-types package from project root
const protoTypesPath = path.join(__dirname, '../../../../proto-types');
const grpc = require(path.join(protoTypesPath, 'node_modules/@grpc/grpc-js'));
const protoLoader = require(path.join(protoTypesPath, 'node_modules/@grpc/proto-loader'));

// Get optional pagination parameters
const limit = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
const offset = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;

// Load proto definitions for QueryDenoms
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
  pagination: (limit !== undefined || offset !== undefined) ? {
    limit: limit,
    offset: offset,
  } : undefined,
};

// Call Denoms query
client.Denoms(request, (error, response) => {
  if (error) {
    console.error('ERROR: Failed to query denoms');
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
    process.exit(1);
  }

  // Transform response to simpler format
  const denoms = response.denoms || [];

  const result = {
    denoms,
    total: response.pagination?.total ? parseInt(response.pagination.total, 10) : denoms.length,
    count: denoms.length,
  };

  // Output JSON response
  console.log(JSON.stringify(result, null, 2));
  
  process.exit(0);
});
