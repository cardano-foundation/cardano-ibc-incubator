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
//
// IMPORTANT: State-root computations are SIDE-EFFECT FREE until committed.
// All compute functions return a result object with `newRoot` and `commit()`.
// Call `commit()` only after the transaction is confirmed on-chain.

import { ICS23MerkleTree } from './ics23-merkle-tree';

/**
 * Result of a state root computation
 * 
 * The computation is speculative until `commit()` is called.
 * This prevents the in-memory tree from becoming out-of-sync with on-chain state
 * when transactions fail or are retried.
 */
export interface StateRootResult {
  /** The computed new root hash (64-character hex string) */
  newRoot: string;
  /** Call this ONLY after the transaction is confirmed on-chain */
  commit: () => void;
}

/**
 * Current working tree - tracks the latest CONFIRMED IBC host state
 * 
 * This tree represents the actual on-chain state. It is only updated via:
 * 1. `commit()` after a transaction is confirmed
 * 2. `alignTreeWithChain()` to rebuild from on-chain UTXOs
 * 
 * NEVER mutate this tree directly during speculative computation.
 */
let currentTree: ICS23MerkleTree = new ICS23MerkleTree();

/**
 * Cached services for on-demand tree rebuild
 * Set via `initTreeServices()` on Gateway startup
 */
let cachedKupoService: any = null;
let cachedLucidService: any = null;

/**
 * Initialize services for tree rebuild functionality
 * Must be called on Gateway startup before any IBC operations
 */
export function initTreeServices(kupoService: any, lucidService: any): void {
  cachedKupoService = kupoService;
  cachedLucidService = lucidService;
}

/**
 * Serialize a value to Buffer for tree storage
 */
function serializeValue(value: any): Buffer {
  const json = JSON.stringify(value, (key, val) => 
    typeof val === 'bigint' ? val.toString() : val
  );
  return Buffer.from(json, 'utf8');
}

/**
 * Get or reconstruct tree from root hash (returns a CLONE for speculative use)
 * 
 * Strategy:
 * 1. If root matches currentTree, clone and return (common case)
 * 2. If root is empty (zeros), return a new empty tree
 * 3. Otherwise, throw an error - tree is out of sync and must be rebuilt
 * 
 * @param rootHash - Target root hash from HostState UTXO (64-character hex string)
 * @returns A CLONED Merkle tree instance (safe to mutate)
 */
function getClonedTreeFromRoot(rootHash: string): ICS23MerkleTree {
  // Empty root - return new empty tree
  if (rootHash === '0'.repeat(64)) {
    return new ICS23MerkleTree();
  }
  
  // Check if current tree matches the requested root
  const currentRoot = currentTree.getRoot();
  if (currentRoot === rootHash) {
    // CRITICAL: Return a CLONE so speculative mutations don't affect the canonical tree
    return currentTree.clone();
  }
  
  // Root mismatch - tree is out of sync with on-chain state
  // This indicates a previous tx failed but we speculatively mutated the tree (bug),
  // or the Gateway restarted and lost in-memory state
  console.error(
    `STATE ROOT MISMATCH:\n` +
    `  On-chain root: ${rootHash.substring(0, 16)}...\n` +
    `  In-memory root: ${currentRoot.substring(0, 16)}...\n` +
    `  The in-memory tree is stale. Call alignTreeWithChain() before retrying.`
  );
  
  throw new Error(
    `Tree out of sync with on-chain state. ` +
    `Expected root ${rootHash.substring(0, 16)}..., ` +
    `but in-memory root is ${currentRoot.substring(0, 16)}...`
  );
}

/**
 * Align the in-memory tree with on-chain state
 * 
 * Call this:
 * - On Gateway startup
 * - Before building a transaction if the previous one failed
 * - Any time you suspect the tree may be stale
 * 
 * This queries the HostState UTXO and all IBC entity UTXOs,
 * rebuilds the Merkle tree from scratch, and verifies the computed
 * root matches the on-chain root.
 */
export async function alignTreeWithChain(): Promise<{ root: string }> {
  if (!cachedKupoService || !cachedLucidService) {
    throw new Error('Tree services not initialized. Call initTreeServices() on Gateway startup.');
  }
  
  console.log('Aligning in-memory tree with on-chain state...');
  
  const result = await rebuildTreeFromChain(cachedKupoService, cachedLucidService);
  return { root: result.root };
}

/**
 * Check if the in-memory tree matches the given on-chain root
 * 
 * Use this to detect staleness before building transactions.
 */
export function isTreeAligned(onChainRoot: string): boolean {
  if (onChainRoot === '0'.repeat(64)) {
    return currentTree.getRoot() === onChainRoot;
  }
  return currentTree.getRoot() === onChainRoot;
}

/**
 * Computes the new IBC state root after adding/updating client state
 * 
 * SIDE-EFFECT FREE: Does not mutate the canonical tree.
 * Call result.commit() only after the transaction is confirmed.
 * 
 * @param oldRoot - Current IBC state root (64-character hex string)
 * @param clientId - Client identifier being created/updated
 * @param clientState - New client state value
 * @returns StateRootResult with newRoot and commit function
 */
export function computeRootWithClientUpdate(
  oldRoot: string,
  clientId: string,
  clientState: any,
): StateRootResult {
  // Get a CLONED tree (safe to mutate)
  const speculativeTree = getClonedTreeFromRoot(oldRoot);
  
  // IBC path for client state: clients/{clientId}/clientState
  const path = `clients/${clientId}/clientState`;
  
  // Serialize and store the client state in the SPECULATIVE tree
  const value = serializeValue(clientState);
  speculativeTree.set(path, value);
  
  // Compute new root
  const newRoot = speculativeTree.getRoot();
  
  return {
    newRoot,
    commit: () => {
      // Only called after tx confirmation - update canonical tree
      currentTree = speculativeTree;
      console.log(`Committed client update: ${clientId}, new root: ${newRoot.substring(0, 16)}...`);
    },
  };
}

/**
 * Computes the new IBC state root after adding/updating connection state
 * 
 * SIDE-EFFECT FREE: Does not mutate the canonical tree.
 * Call result.commit() only after the transaction is confirmed.
 */
export function computeRootWithConnectionUpdate(
  oldRoot: string,
  connectionId: string,
  connectionState: any,
): StateRootResult {
  // Get a CLONED tree (safe to mutate)
  const speculativeTree = getClonedTreeFromRoot(oldRoot);
  
  // IBC path for connection state: connections/{connectionId}
  const path = `connections/${connectionId}`;
  
  // Serialize and store the connection state in the SPECULATIVE tree
  const value = serializeValue(connectionState);
  speculativeTree.set(path, value);
  
  // Compute new root
  const newRoot = speculativeTree.getRoot();
  
  return {
    newRoot,
    commit: () => {
      currentTree = speculativeTree;
      console.log(`Committed connection update: ${connectionId}, new root: ${newRoot.substring(0, 16)}...`);
    },
  };
}

/**
 * Computes the new IBC state root after adding/updating channel state
 * 
 * SIDE-EFFECT FREE: Does not mutate the canonical tree.
 * Call result.commit() only after the transaction is confirmed.
 */
export function computeRootWithChannelUpdate(
  oldRoot: string,
  channelId: string,
  channelState: any,
): StateRootResult {
  // Get a CLONED tree (safe to mutate)
  const speculativeTree = getClonedTreeFromRoot(oldRoot);
  
  // Extract portId from channel state (default to 'transfer' if not provided)
  const portId = channelState?.port_id || 'transfer';
  
  // IBC path for channel state: channelEnds/ports/{portId}/channels/{channelId}
  const path = `channelEnds/ports/${portId}/channels/${channelId}`;
  
  // Serialize and store the channel state in the SPECULATIVE tree
  const value = serializeValue(channelState);
  speculativeTree.set(path, value);
  
  // Compute new root
  const newRoot = speculativeTree.getRoot();
  
  return {
    newRoot,
    commit: () => {
      currentTree = speculativeTree;
      console.log(`Committed channel update: ${portId}/${channelId}, new root: ${newRoot.substring(0, 16)}...`);
    },
  };
}

/**
 * Computes the new IBC state root after binding a port
 * 
 * SIDE-EFFECT FREE: Does not mutate the canonical tree.
 * Call result.commit() only after the transaction is confirmed.
 */
export function computeRootWithPortBind(
  oldRoot: string,
  portNumber: number,
): StateRootResult {
  // Get a CLONED tree (safe to mutate)
  const speculativeTree = getClonedTreeFromRoot(oldRoot);
  
  // IBC path for port binding: ports/{portNumber}
  const path = `ports/${portNumber}`;
  
  // Store a marker value for port binding (just the port number)
  const value = Buffer.from(portNumber.toString(), 'utf8');
  speculativeTree.set(path, value);
  
  // Compute new root
  const newRoot = speculativeTree.getRoot();
  
  return {
    newRoot,
    commit: () => {
      currentTree = speculativeTree;
      console.log(`Committed port bind: ${portNumber}, new root: ${newRoot.substring(0, 16)}...`);
    },
  };
}

/**
 * Rebuild the IBC state tree from on-chain UTXOs (STT Architecture)
 * 
 * CRITICAL FOR PRODUCTION: This function makes the Gateway resilient to:
 * - Restarts (in-memory tree is lost)
 * - Failed transactions (speculative state becomes stale)
 * - Multiple Gateway instances (another instance may have updated state)
 */
export async function rebuildTreeFromChain(
  kupoService: any,
  lucidService: any,
): Promise<{ tree: ICS23MerkleTree; root: string }> {
  console.log('Rebuilding IBC state tree from on-chain UTXOs (STT architecture)...');
  
  // Query HostState UTXO via NFT
  const hostStateUtxo = await lucidService.findUtxoAtHostStateNFT();
  if (!hostStateUtxo?.datum) {
    throw new Error('HostState UTXO has no datum - STT architecture integrity compromised');
  }
  
  const hostStateDatum = await lucidService.decodeDatum(hostStateUtxo.datum, 'host_state');
  const expectedRoot = hostStateDatum.state.ibc_state_root;
  const version = hostStateDatum.state.version;
  
  console.log(`STT Architecture - HostState UTXO v${version}, expected root: ${expectedRoot.substring(0, 16)}...`);
  
  try {
    // Create new tree
    const tree = new ICS23MerkleTree();
    
    // Query and add all Client UTXOs
    const clientUtxos = await kupoService.queryAllClientUtxos();
    console.log(`Found ${clientUtxos.length} client UTXOs`);
    
    for (const clientUtxo of clientUtxos) {
      if (!clientUtxo.datum) continue;
      
      const clientDatum = await lucidService.decodeDatum(clientUtxo.datum, 'client');
      const clientUnit = Object.keys(clientUtxo.assets || {}).find((unit) => unit !== 'lovelace');
      if (!clientUnit || clientUnit.length < 56 + 48 + 2) continue;

      const tokenName = clientUnit.slice(56);
      const postfixHex = tokenName.slice(48);
      const clientSequence = BigInt(Buffer.from(postfixHex, 'hex').toString('utf8'));
      const clientId = `07-tendermint-${clientSequence.toString()}`;
      
      const value = serializeValue(clientDatum.state.clientState);
      tree.set(`clients/${clientId}/clientState`, value);
      
      console.log(`  Added client: ${clientId}`);
    }
    
    // Query and add all Connection UTXOs
    const connectionUtxos = await kupoService.queryAllConnectionUtxos();
    console.log(`Found ${connectionUtxos.length} connection UTXOs`);
    
    for (const connectionUtxo of connectionUtxos) {
      if (!connectionUtxo.datum) continue;
      
      const connectionDatum = await lucidService.decodeDatum(connectionUtxo.datum, 'connection');
      const connectionSequence = connectionDatum.state.connection_sequence;
      const connectionId = `connection-${connectionSequence}`;
      
      const value = serializeValue(connectionDatum.state);
      tree.set(`connections/${connectionId}`, value);
      
      console.log(`  Added connection: ${connectionId}`);
    }
    
    // Query and add all Channel UTXOs
    const channelUtxos = await kupoService.queryAllChannelUtxos();
    console.log(`Found ${channelUtxos.length} channel UTXOs`);
    
    for (const channelUtxo of channelUtxos) {
      if (!channelUtxo.datum) continue;
      
      const channelDatum = await lucidService.decodeDatum(channelUtxo.datum, 'channel');
      const channelSequence = channelDatum.state.channel_sequence;
      const channelId = `channel-${channelSequence}`;
      const portId = channelDatum.state.port_id || 'transfer';
      
      const value = serializeValue(channelDatum.state);
      tree.set(`channelEnds/ports/${portId}/channels/${channelId}`, value);
      
      console.log(`  Added channel: ${portId}/${channelId}`);
    }
    
    // Compute root and verify
    const computedRoot = tree.getRoot();
    console.log(`Computed root from UTXOs: ${computedRoot.substring(0, 16)}...`);
    
    if (computedRoot !== expectedRoot) {
      throw new Error(
        `Tree rebuild FAILED: Root mismatch!\n` +
        `  Expected: ${expectedRoot}\n` +
        `  Computed: ${computedRoot}\n` +
        `This indicates stale Kupo data or datum decoding error.`
      );
    }
    
    // Update global current tree
    currentTree = tree;
    
    console.log('Tree rebuilt successfully and verified against on-chain root');
    console.log(`   Clients: ${clientUtxos.length}, Connections: ${connectionUtxos.length}, Channels: ${channelUtxos.length}`);
    
    return { tree, root: computedRoot };
    
  } catch (error) {
    console.error('Failed to rebuild tree from chain:', error.message);
    throw new Error(`Tree rebuild failed: ${error.message}`);
  }
}

/**
 * Get the current working tree instance (for debugging/testing)
 */
export function getCurrentTree(): ICS23MerkleTree {
  return currentTree;
}

/**
 * Get the current root without any computation
 */
export function getCurrentRoot(): string {
  return currentTree.getRoot();
}

/**
 * Reset tree state (for testing)
 */
export function resetTreeState(): void {
  currentTree = new ICS23MerkleTree();
}
