// IBC State Root Computation - STT Architecture
// 
// This module is responsible for computing the ICS-23 Merkle root commitment over all IBC host state.
// The root covers: clients/, connections/, channels/, packets/, etc.
//
// STT Architecture:
// - The root is stored in the HostState UTXO datum (identified by unique NFT)
// - It's updated atomically with each IBC state change
// - The NFT ensures exactly one canonical state exists at any time
// - Mithril certifies it via snapshot inclusion
// - Enables VerifyMembership/VerifyNonMembership on Cosmos side

import { ICS23MerkleTree } from './ics23-merkle-tree';

/**
 * Current working tree - tracks the latest IBC host state
 * 
 * 
 * This tree is rebuilt from on-chain UTXOs on Gateway startup, then kept in sync
 * as transactions are submitted. It always represents the latest confirmed state.
 * 
 * The tree can ALWAYS be reconstructed by:
 * 1. Querying all IBC-related UTXOs from the chain (clients, connections, channels)
 * 2. Rebuilding the tree by inserting each state at its IBC path
 * 3. Verifying the computed root matches the Handler UTXO's ibc_state_root
 */

let currentTree: ICS23MerkleTree = new ICS23MerkleTree();

/**
 * Serialize a value to Buffer for tree storage
 * 
 * Uses JSON serialization (deterministic, human-readable, works correctly).
 * 
 * Protobuf encoding would be needed only if:
 * - We need byte-identical compatibility with other IBC implementations
 * - Multiple implementations are computing the same root independently
 * 
 * Since the Cardano Gateway is the sole authority for computing this root
 * (Mithril client only verifies it via proofs), JSON is sufficient.
 * 
 * @param value - The value to serialize
 * @returns Buffer representation
 */
function serializeValue(value: any): Buffer {
  const json = JSON.stringify(value);
  return Buffer.from(json, 'utf8');
}

/**
 * Get or reconstruct tree from root hash
 * 
 * Strategy:
 * 1. If root matches currentTree, use it (common case - tree is up-to-date)
 * 2. Otherwise, rebuild from on-chain UTXOs (after restart or if out of sync)
 * 
 * @param rootHash - Target root hash from Handler UTXO (64-character hex string)
 * @returns Merkle tree instance
 */
function getTreeFromRoot(rootHash: string): ICS23MerkleTree {
  // Empty root - return new empty tree
  if (rootHash === '0'.repeat(64)) {
    return new ICS23MerkleTree();
  }
  
  // Check if current tree matches the requested root (common case)
  const currentRoot = currentTree.getRoot();
  if (currentRoot === rootHash) {
    return currentTree;
  }
  
  // Root mismatch - tree is out of sync with on-chain state
  // This happens after Gateway restart or if another instance submitted a transaction
  console.warn(
    `Tree out of sync: on-chain root ${rootHash.substring(0, 16)}..., ` +
    `current tree root ${currentRoot.substring(0, 16)}...`
  );
  
  // TODO (Required for production): Rebuild from on-chain UTXOs
  // Query all client/connection/channel UTXOs and rebuild the tree:
  // const rebuiltTree = await rebuildTreeFromChainUTXOs();
  // if (rebuiltTree.getRoot() !== rootHash) {
  //   throw new Error(`Rebuilt tree root mismatch - chain may be corrupted`);
  // }
  // currentTree = rebuiltTree;
  // return currentTree;
  
  // Temporary: Use current tree and log warning
  console.error('UTXO reconstruction not yet implemented - using potentially stale tree');
  return currentTree;
}


/**
 * Computes the new IBC state root after adding/updating client state
 * 
 * @param oldRoot - Current IBC state root (64-character hex string)
 * @param clientId - Client identifier being created/updated
 * @param clientState - New client state value
 * @returns New IBC state root (64-character hex string)
 */
export function computeRootWithClientUpdate(
  oldRoot: string,
  clientId: string,
  clientState: any,
): string {
  // Get or reconstruct tree from old root
  const tree = getTreeFromRoot(oldRoot);
  
  // IBC path for client state: clients/{clientId}/clientState
  const path = `clients/${clientId}/clientState`;
  
  // Serialize and store the client state
  const value = serializeValue(clientState);
  tree.set(path, value);
  
  // Compute new root
  const newRoot = tree.getRoot();
  
  // Update current working tree to reflect new state
  currentTree = tree;
  
  return newRoot;
}

/**
 * Computes the new IBC state root after adding/updating connection state
 * 
 * @param oldRoot - Current IBC state root (64-character hex string)
 * @param connectionId - Connection identifier being created/updated
 * @param connectionState - New connection state value
 * @returns New IBC state root (64-character hex string)
 */
export function computeRootWithConnectionUpdate(
  oldRoot: string,
  connectionId: string,
  connectionState: any,
): string {
  // Get or reconstruct tree from old root
  const tree = getTreeFromRoot(oldRoot);
  
  // IBC path for connection state: connections/{connectionId}
  const path = `connections/${connectionId}`;
  
  // Serialize and store the connection state
  const value = serializeValue(connectionState);
  tree.set(path, value);
  
  // Compute new root
  const newRoot = tree.getRoot();
  
  // Update current working tree to reflect new state
  currentTree = tree;
  
  return newRoot;
}

/**
 * Computes the new IBC state root after adding/updating channel state
 * 
 * @param oldRoot - Current IBC state root (64-character hex string)
 * @param channelId - Channel identifier being created/updated
 * @param channelState - New channel state value (should include portId)
 * @returns New IBC state root (64-character hex string)
 */
export function computeRootWithChannelUpdate(
  oldRoot: string,
  channelId: string,
  channelState: any,
): string {
  // Get or reconstruct tree from old root
  const tree = getTreeFromRoot(oldRoot);
  
  // Extract portId from channel state (default to 'transfer' if not provided)
  const portId = channelState?.port_id || 'transfer';
  
  // IBC path for channel state: channelEnds/ports/{portId}/channels/{channelId}
  const path = `channelEnds/ports/${portId}/channels/${channelId}`;
  
  // Serialize and store the channel state
  const value = serializeValue(channelState);
  tree.set(path, value);
  
  // Compute new root
  const newRoot = tree.getRoot();
  
  // Update current working tree to reflect new state
  currentTree = tree;
  
  return newRoot;
}

/**
 * Computes the new IBC state root after binding a port
 * 
 * @param oldRoot - Current IBC state root (64-character hex string)
 * @param portNumber - Port number being bound
 * @returns New IBC state root (64-character hex string)
 */
export function computeRootWithPortBind(
  oldRoot: string,
  portNumber: number,
): string {
  // Get or reconstruct tree from old root
  const tree = getTreeFromRoot(oldRoot);
  
  // IBC path for port binding: ports/{portNumber}
  const path = `ports/${portNumber}`;
  
  // Store a marker value for port binding (just the port number)
  const value = Buffer.from(portNumber.toString(), 'utf8');
  tree.set(path, value);
  
  // Compute new root
  const newRoot = tree.getRoot();
  
  // Update current working tree to reflect new state
  currentTree = tree;
  
  return newRoot;
}

/**
 * Rebuild the IBC state tree from on-chain UTXOs (STT Architecture)
 * 
 * CRITICAL FOR PRODUCTION: This function makes the Gateway resilient to restarts
 * 
 * STT Architecture Benefits:
 * - Queries the unique HostState UTXO via NFT (no ambiguity)
 * - NFT provides complete state history for auditing
 * - Canonical state guarantee (exactly one valid state)
 * - Simpler indexing (follow the NFT)
 * 
 * Process:
 * - Queries HostState UTXO via IBC Host State NFT
 * - Queries all IBC object UTXOs (clients, connections, channels)
 * - Rebuilds the Merkle tree from scratch
 * - Verifies computed root matches the on-chain HostState root
 * - Updates currentTree to reflect on-chain state
 * 
 * When to call:
 * - On Gateway startup (before processing any transactions)
 * - After any period where Gateway was offline
 * 
 * Why this matters:
 * - currentTree is in-memory and lost on restart
 * - Without rebuild, Gateway would compute wrong roots
 * - Wrong roots break IBC proof verification
 * 
 * @param kupoService - Service for querying Kupo indexer
 * @param lucidService - Service for decoding datums
 * @returns The rebuilt tree and its root
 */
export async function rebuildTreeFromChain(
  kupoService: any,  // KupoService type
  lucidService: any, // LucidService type
): Promise<{ tree: ICS23MerkleTree; root: string }> {
  console.log('Rebuilding IBC state tree from on-chain UTXOs (STT architecture)...');
  
  // Query HostState UTXO via NFT (STT Architecture)
  // CRITICAL: No fallback - if STT is unavailable, the Gateway must not start
  // STT provides essential cryptographic guarantees:
  // - Canonical state (exactly one valid state via unique NFT)
  // - Version monotonicity (prevents rollback attacks)
  // - Complete audit trail (NFT traces full history)
  const hostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
  if (!hostStateUtxo.datum) {
    throw new Error('HostState UTXO has no datum - STT architecture integrity compromised');
  }
  
  const hostStateDatum = await lucidService.decodeDatum(hostStateUtxo.datum, 'host_state');
  const expectedRoot = hostStateDatum.state.ibc_state_root;
  const version = hostStateDatum.state.version;
  
  console.log(`STT Architecture initialized - HostState UTXO v${version}, root: ${expectedRoot.substring(0, 16)}...`);
  
  try {
    
    // 2. Create new tree
    const tree = new ICS23MerkleTree();
    
    // 3. Query and add all Client UTXOs
    const clientUtxos = await kupoService.queryAllClientUtxos();
    console.log(`Found ${clientUtxos.length} client UTXOs`);
    
    for (const clientUtxo of clientUtxos) {
      if (!clientUtxo.datum) continue;
      
      const clientDatum = await lucidService.decodeDatum(clientUtxo.datum, 'client');
      const clientSequence = clientDatum.state.client_sequence;
      const clientId = `07-tendermint-${clientSequence}`;
      
      // Serialize client state and add to tree
      const value = serializeValue(clientDatum.state);
      tree.set(`clients/${clientId}/clientState`, value);
      
      console.log(`  Added client: ${clientId}`);
    }
    
    // 4. Query and add all Connection UTXOs
    const connectionUtxos = await kupoService.queryAllConnectionUtxos();
    console.log(`Found ${connectionUtxos.length} connection UTXOs`);
    
    for (const connectionUtxo of connectionUtxos) {
      if (!connectionUtxo.datum) continue;
      
      const connectionDatum = await lucidService.decodeDatum(connectionUtxo.datum, 'connection');
      const connectionSequence = connectionDatum.state.connection_sequence;
      const connectionId = `connection-${connectionSequence}`;
      
      // Serialize connection state and add to tree
      const value = serializeValue(connectionDatum.state);
      tree.set(`connections/${connectionId}`, value);
      
      console.log(`  Added connection: ${connectionId}`);
    }
    
    // 5. Query and add all Channel UTXOs
    const channelUtxos = await kupoService.queryAllChannelUtxos();
    console.log(`Found ${channelUtxos.length} channel UTXOs`);
    
    for (const channelUtxo of channelUtxos) {
      if (!channelUtxo.datum) continue;
      
      const channelDatum = await lucidService.decodeDatum(channelUtxo.datum, 'channel');
      const channelSequence = channelDatum.state.channel_sequence;
      const channelId = `channel-${channelSequence}`;
      const portId = channelDatum.state.port_id || 'transfer';
      
      // Serialize channel state and add to tree
      const value = serializeValue(channelDatum.state);
      tree.set(`channelEnds/ports/${portId}/channels/${channelId}`, value);
      
      console.log(`  Added channel: ${portId}/${channelId}`);
    }
    
    // 6. Compute root and verify
    const computedRoot = tree.getRoot();
    console.log(`Computed root from UTXOs: ${computedRoot.substring(0, 16)}...`);
    
    if (computedRoot !== expectedRoot) {
      throw new Error(
        `Tree rebuild FAILED: Root mismatch!\n` +
        `  Expected: ${expectedRoot}\n` +
        `  Computed: ${computedRoot}\n` +
        `This indicates either:\n` +
        `  - Kupo has stale/inconsistent data\n` +
        `  - UTXO datum decoding is incorrect\n` +
        `  - Tree computation logic has changed\n` +
        `Please verify on-chain state and Kupo indexing.`
      );
    }
    
    // 7. Update global current tree
    currentTree = tree;
    
    console.log('✅ Tree rebuilt successfully and verified against on-chain root');
    console.log(`   Clients: ${clientUtxos.length}, Connections: ${connectionUtxos.length}, Channels: ${channelUtxos.length}`);
    
    return { tree, root: computedRoot };
    
  } catch (error) {
    console.error('❌ Failed to rebuild tree from chain:', error.message);
    throw new Error(`Tree rebuild failed: ${error.message}`);
  }
}

/**
 * Get the current working tree instance (for debugging/testing)
 * @returns The current Merkle tree
 */
export function getCurrentTree(): ICS23MerkleTree {
  return currentTree;
}

/**
 * Reset tree state (for testing)
 * Clears the current working tree.
 */
export function resetTreeState(): void {
  currentTree = new ICS23MerkleTree();
}


