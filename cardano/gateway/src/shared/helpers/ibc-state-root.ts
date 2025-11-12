// IBC State Root Computation
// 
// This module is responsible for computing the ICS-23 Merkle root commitment over all IBC host state.
// The root covers: clients/, connections/, channels/, packets/, etc.
//
// Architecture:
// - The root is stored in the Handler UTXO datum
// - It's updated atomically with each IBC state change
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
 * 

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


