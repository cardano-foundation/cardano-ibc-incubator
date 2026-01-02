#!/usr/bin/env node

/**
 * DEPRECATED: This test helper is no longer used
 * 
 * Integration tests now use Hermes CLI directly for IBC operations.
 * See caribic/src/test.rs for the current implementation.
 * 
 * This script was previously used to test the Gateway's CreateClient endpoint,
 * but it did not handle transaction signing, so transactions were never submitted
 * to the blockchain.
 * 
 * Current testing architecture:
 * - Tests invoke Hermes CLI (e.g., `hermes create client`)
 * - Hermes calls Gateway to build unsigned transactions
 * - Hermes signs transactions with its keyring
 * - Hermes submits signed transactions to Cardano
 * 
 * This file is kept for reference only.
 * 
 * ===== ORIGINAL DOCUMENTATION (for reference) =====
 * 
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
const protobuf = require(path.join(protoTypesPath, 'node_modules/protobufjs'));

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

// Create minimal client state 
// protobufjs uses camelCase for field names
// Chain ID format: {identifier}-{revision_number}
const clientStateJson = {
  chainId: 'testchain-0',  // revision 0
  trustLevel: { numerator: '1', denominator: '3' },
  trustingPeriod: { seconds: '1209600', nanos: 0 }, // 14 days
  unbondingPeriod: { seconds: '1814400', nanos: 0 }, // 21 days  
  maxClockDrift: { seconds: '5', nanos: 0 },
  frozenHeight: { revisionNumber: '0', revisionHeight: '0' },
  latestHeight: { revisionNumber: '0', revisionHeight: '1' },  // Match chain ID revision
  proofSpecs: [],
  upgradePath: ['upgrade', 'upgradedIBCState'],
  allowUpdateAfterExpiry: false,
  allowUpdateAfterMisbehaviour: false,
};

const consensusStateJson = {
  timestamp: { seconds: currentSeconds.toString(), nanos: currentNanos },
  root: { hash: Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex') },
  nextValidatorsHash: Buffer.from('0000000000000000000000000000000000000000000000000000000000000000', 'hex'),
};

// Load proto types for encoding using protobufjs
// protobufjs provides the encode() methods we need
const root = new protobuf.Root();
root.resolvePath = (origin, target) => {
  return path.join(protoTypesPath, 'protos/ibc-go', target);
};

// Load all necessary proto files
root.loadSync('ibc/lightclients/tendermint/v1/tendermint.proto');
root.loadSync('google/protobuf/duration.proto');
root.loadSync('google/protobuf/timestamp.proto');
root.loadSync('ibc/core/client/v1/client.proto');
root.loadSync('ibc/core/commitment/v1/commitment.proto');

// Get the message types
const ClientStateType = root.lookupType('ibc.lightclients.tendermint.v1.ClientState');
const ConsensusStateType = root.lookupType('ibc.lightclients.tendermint.v1.ConsensusState');

// Encode to protobuf bytes
const clientStateEncoded = ClientStateType.encode(ClientStateType.create(clientStateJson)).finish();
const consensusStateEncoded = ConsensusStateType.encode(ConsensusStateType.create(consensusStateJson)).finish();

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

// Call CreateClient - Gateway returns unsigned transaction that we need to sign and submit
client.CreateClient(request, async (error, response) => {
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
  
  // Check if we got an unsigned transaction
  if (response.unsigned_tx && response.unsigned_tx.value) {
    console.log('Received unsigned transaction (' + response.unsigned_tx.value.length + ' bytes)');
    console.log('Note: Transaction signing and submission not yet implemented in test helper');
    console.log('To complete integration testing, use Hermes or implement local signing');
  } else {
    console.log('Note: No unsigned_tx in response - Gateway may have signed internally');
  }
  
  process.exit(0);
});

