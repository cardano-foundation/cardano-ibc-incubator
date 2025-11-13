#!/usr/bin/env node

/**
 * Test helper: Create an IBC client via the Gateway for integration testing
 * 
 * STATUS: Work in Progress - Requires proper protobuf encoding
 * 
 * NOTE: This script uses the Gateway's internal wallet signing capability,
 * which exists ONLY for testing and will be DEPRECATED in production.
 * 
 * In production architecture:
 * - Gateway builds UNSIGNED transactions
 * - Hermes (relayer) signs transactions with its own wallet
 * - Hermes submits signed transactions to Cardano
 * 
 * For testing purposes:
 * - Gateway has wallet access and can sign transactions
 * - This allows automated integration tests without full Hermes setup
 * - This signing capability should be removed once Hermes integration is complete
 * 
 * TODO: Complete protobuf encoding
 * - @grpc/proto-loader doesn't provide encoding utilities
 * - Need to use protobufjs or the compiled proto-types TypeScript package
 * - ClientState and ConsensusState must be properly encoded to protobuf bytes
 * 
 * This script:
 * 1. Loads handler deployment info to get the signer address
 * 2. Creates a minimal Tendermint client state for testing
 * 3. Calls Gateway's CreateClient gRPC endpoint
 * 4. Gateway signs and submits the transaction internally
 * 5. Returns the client ID and transaction hash
 */

const path = require('path');
const fs = require('fs');

// Use proto-types package from project root
const protoTypesPath = path.join(__dirname, '../../../../proto-types');
const grpc = require(path.join(protoTypesPath, 'node_modules/@grpc/grpc-js'));
const protoLoader = require(path.join(protoTypesPath, 'node_modules/@grpc/proto-loader'));

// Load deployment info to get signer address
const HANDLER_DEPLOYMENT_PATH = path.join(__dirname, '../../../offchain/deployments/handler.json');

if (!fs.existsSync(HANDLER_DEPLOYMENT_PATH)) {
  console.error('ERROR: Handler deployment file not found at:', HANDLER_DEPLOYMENT_PATH);
  console.error('Please run "caribic start bridge" first to deploy contracts');
  process.exit(1);
}

const deployment = JSON.parse(fs.readFileSync(HANDLER_DEPLOYMENT_PATH, 'utf8'));
const signerAddress = deployment.modules?.handler?.address;

if (!signerAddress) {
  console.error('ERROR: Handler address not found in deployment file');
  console.error('Expected: deployment.modules.handler.address');
  process.exit(1);
}

console.log('Creating test client...');
console.log('Signer address:', signerAddress);

// Load proto definitions for CreateClient
const PROTO_PATH = path.join(protoTypesPath, 'protos/ibc-go/ibc/core/client/v1/tx.proto');
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
const client = new proto.ibc.core.client.v1.Msg(
  'localhost:5001',
  grpc.credentials.createInsecure()
);

// Current timestamp in nanoseconds
const currentTimeMs = Date.now();
const currentSeconds = Math.floor(currentTimeMs / 1000);
const currentNanos = (currentTimeMs % 1000) * 1000000;

// Create minimal client state (using proto-types' built-in encoding)
// We'll use the Gateway's protobuf encoding by letting it handle the Any type
const clientStateJson = {
  chain_id: 'test-chain-1',
  trust_level: { numerator: '1', denominator: '3' },
  trusting_period: { seconds: '1209600', nanos: 0 }, // 14 days
  unbonding_period: { seconds: '1814400', nanos: 0 }, // 21 days  
  max_clock_drift: { seconds: '5', nanos: 0 },
  frozen_height: { revision_number: '0', revision_height: '0' },
  latest_height: { revision_number: '1', revision_height: '1' },
  proof_specs: [],
  upgrade_path: ['upgrade', 'upgradedIBCState'],
  allow_update_after_expiry: false,
  allow_update_after_misbehaviour: false,
};

const consensusStateJson = {
  timestamp: { seconds: currentSeconds.toString(), nanos: currentNanos },
  root: { hash: Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex') },
  next_validators_hash: Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
};

// Load proto types for encoding
// We need to properly encode the client/consensus states as protobuf bytes
const TM_PROTO_PATH = path.join(protoTypesPath, 'protos/ibc-go/ibc/lightclients/tendermint/v1/tendermint.proto');
const tmPackageDef = protoLoader.loadSync(TM_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [path.join(protoTypesPath, 'protos/ibc-go/')]
});

const tmProto = grpc.loadPackageDefinition(tmPackageDef);

// Get the message types for encoding
const ClientStateType = tmProto.ibc.lightclients.tendermint.v1.ClientState;
const ConsensusStateType = tmProto.ibc.lightclients.tendermint.v1.ConsensusState;

// Encode to protobuf bytes
// proto-loader's generated types have encode() method that accepts plain objects
const clientStateEncoded = ClientStateType.encode(clientStateJson).finish();
const consensusStateEncoded = ConsensusStateType.encode(consensusStateJson).finish();

const request = {
  client_state: {
    type_url: '/ibc.lightclients.tendermint.v1.ClientState',
    value: clientStateEncoded
  },
  consensus_state: {
    type_url: '/ibc.lightclients.tendermint.v1.ConsensusState',
    value: consensusStateEncoded
  },
  signer: signerAddress,
};

console.log('Calling Gateway CreateClient endpoint...');
console.log('Client state encoded:', clientStateEncoded.length, 'bytes');
console.log('Consensus state encoded:', consensusStateEncoded.length, 'bytes');

// Call CreateClient - Gateway will sign and submit internally (test mode only!)
client.CreateClient(request, (error, response) => {
  if (error) {
    console.error('ERROR: Failed to create client');
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    console.error('Details:', error.details);
    console.error('');
    console.error('Debugging info:');
    console.error('- Gateway URL: localhost:5001');
    console.error('- Signer:', signerAddress);
    console.error('- Client state size:', clientStateEncoded.length);
    console.error('- Consensus state size:', consensusStateEncoded.length);
    process.exit(1);
  }

  console.log('✓ Client created successfully!');
  console.log('Client ID:', response.client_id);
  
  // Note: The Gateway signs and submits the transaction internally
  // In production with Hermes, this would not happen
  
  process.exit(0);
});

