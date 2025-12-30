#!/usr/bin/env node

/**
 * Test helper: Query all denom traces from Gateway gRPC endpoint
 * 
 * This script queries the Gateway's Query.DenomTraces gRPC endpoint to retrieve
 * all denom trace information stored in the database.
 * 
 * Usage:
 *   node query-all-denom-traces.js [limit] [offset]
 * 
 * Example:
 *   node query-all-denom-traces.js 10 0
 * 
 * Output: JSON array of denom traces with hash, path, and base_denom
 */

const path = require('path');

// Use proto-types package from project root
const protoTypesPath = path.join(__dirname, '../../../../proto-types');
const grpc = require(path.join(protoTypesPath, 'node_modules/@grpc/grpc-js'));
const protoLoader = require(path.join(protoTypesPath, 'node_modules/@grpc/proto-loader'));

// Get optional pagination parameters
const limit = process.argv[2] ? parseInt(process.argv[2], 10) : undefined;
const offset = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;

// Load proto definitions for QueryDenomTraces
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

// Call DenomTraces query
client.DenomTraces(request, (error, response) => {
  if (error) {
    console.error('ERROR: Failed to query denom traces');
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
    process.exit(1);
  }

  // Transform response to simpler format
  const traces = (response.denom_traces || []).map(trace => ({
    path: trace.path || null,
    base_denom: trace.base_denom || null,
  }));

  const result = {
    traces: traces,
    total: response.pagination?.total ? parseInt(response.pagination.total, 10) : traces.length,
    count: traces.length,
  };

  // Output JSON response
  console.log(JSON.stringify(result, null, 2));
  
  process.exit(0);
});

