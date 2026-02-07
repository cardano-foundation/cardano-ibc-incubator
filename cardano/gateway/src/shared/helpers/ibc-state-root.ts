// IBC State Root Computation - STT Architecture
// 
// This module is responsible for computing the ICS-23 Merkle root commitment over all IBC host state.
// The root covers: clients/, connections/, channels/, packets/, etc.
//
// STT Architecture:
// - The root is stored in the HostState UTXO datum (identified by unique NFT)
// - It's updated atomically with each IBC state change
// - The NFT ensures exactly one canonical state exists at any time
// - Enables VerifyMembership/VerifyNonMembership on Cosmos side
//
// IMPORTANT: State-root computations are SIDE-EFFECT FREE until committed.
// All compute functions return a result object with `newRoot` and `commit()`.
// Call `commit()` only after the transaction is confirmed on-chain.
//
// ============================================================================
// CRASH RECOVERY / SELF-HEALING BEHAVIOR
// ============================================================================
//
// The in-memory Merkle tree is ephemeral - it's lost when the Gateway process stops.
// However, the Gateway is designed to be SELF-HEALING and requires NO MANUAL INTERVENTION
// after a restart. Here's how it works:
//
// 1. On Gateway restart, the in-memory tree starts empty.
//
// 2. When a query arrives that requires proof generation (e.g., queryClientState),
//    the query service calls `ensureTreeAligned()` BEFORE generating the proof.
//
// 3. `ensureTreeAligned()` compares the in-memory tree's root with the on-chain
//    `ibc_state_root` stored in the HostState UTXO.
//
// 4. If they don't match (which they won't after restart), `alignTreeWithChain()`
//    is called automatically. This queries all IBC UTXOs (clients, connections,
//    channels) and rebuilds the tree from scratch.
//
// 5. After rebuilding, the tree matches on-chain state and proofs can be generated.
//
// This "lazy rebuild on demand" approach means:
// - The first proof-generating query after restart will be slower (rebuild overhead)
// - Subsequent queries are fast (just a root comparison)
// - No manual intervention or startup scripts needed
// - The system is resilient to crashes at any point
//

import { ICS23MerkleTree } from './ics23-merkle-tree';
import { encodeClientStateValue, encodeConsensusStateValue } from '../types/client-datum';
import { encodeConnectionEndValue } from '../types/connection/connection-datum';
import { encodeChannelEndValue } from '../types/channel/channel-datum';
import type { ChannelDatum } from '../types/channel/channel-datum';

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
  if (Buffer.isBuffer(value)) return value;
  const json = JSON.stringify(value, (key, val) => 
    typeof val === 'bigint' ? val.toString() : val
  );
  return Buffer.from(json, 'utf8');
}

export interface CreateClientStateRootResult extends StateRootResult {
  clientStateSiblings: string[];
  consensusStateSiblings: string[];
}

export interface CreateConnectionStateRootResult extends StateRootResult {
  connectionSiblings: string[];
}

export interface CreateChannelStateRootResult extends StateRootResult {
  channelSiblings: string[];
  nextSequenceSendSiblings: string[];
  nextSequenceRecvSiblings: string[];
  nextSequenceAckSiblings: string[];
}

export interface BindPortStateRootResult extends StateRootResult {
  portSiblings: string[];
}

export interface UpdateChannelStateRootResult extends StateRootResult {
  channelSiblings: string[];
}

export interface UpdateClientStateRootResult extends StateRootResult {
  clientStateSiblings: string[];
  consensusStateSiblings: string[];
  removedConsensusStateSiblings: string[][];
}

export interface HandlePacketStateRootResult extends StateRootResult {
  channelSiblings: string[];
  nextSequenceSendSiblings: string[];
  nextSequenceRecvSiblings: string[];
  nextSequenceAckSiblings: string[];
  packetCommitmentSiblings: string[];
  packetReceiptSiblings: string[];
  packetAcknowledgementSiblings: string[];
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
 * Align the in-memory tree with on-chain state (This is an automatic self-healing mechanism)
 * 
 * This is the core of the Gateway's crash recovery. It rebuilds the entire
 * Merkle tree from on-chain UTXOs, ensuring the in-memory state matches
 * what's actually committed on Cardano.
 * 
 * WHEN THIS IS CALLED:
 * - Automatically by `ensureTreeAligned()` when a query detects stale state
 * - After Gateway restart (triggered by first proof-generating query)
 * - If a transaction fails and the speculative tree becomes invalid
 * 
 * WHAT IT DOES:
 * 1. Queries the HostState UTXO to get the expected root
 * 2. Queries ALL IBC entity UTXOs (clients, connections, channels)
 * 3. Rebuilds the Merkle tree from scratch with all entries
 * 4. Verifies the computed root matches the on-chain commitment
 * 5. Replaces the in-memory tree with the rebuilt one
 * 
 * PERFORMANCE NOTE:
 * This is expensive (queries many UTXOs), but only runs when needed.
 * In normal operation, `isTreeAligned()` returns true and this is skipped.
 * 
 * @returns Object containing the rebuilt tree's root hash
 * @throws Error if tree services not initialized via initTreeServices()
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
 * Use this to detect staleness before building transactions or generating proofs.
 * This is a cheap operation (just compares two hash strings).
 * 
 * @param onChainRoot - The ibc_state_root from the HostState UTXO (64-char hex)
 * @returns true if in-memory tree matches on-chain state, false if rebuild needed
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
 * @param consensusState - Optional consensus state to add (required for CreateClient)
 * @param consensusHeight - Height key for the consensus state (e.g., "123" or the revisionHeight)
 * @returns StateRootResult with newRoot and commit function
 */
export function computeRootWithClientUpdate(
  oldRoot: string,
  clientId: string,
  clientState: any,
  consensusState?: any,
  consensusHeight?: string | number | bigint,
): StateRootResult {
  // Get a CLONED tree (safe to mutate)
  const speculativeTree = getClonedTreeFromRoot(oldRoot);
  
  // IBC path for client state: clients/{clientId}/clientState
  // This stores the overall client configuration (chain ID, trust level, latest height, etc.)
  const clientPath = `clients/${clientId}/clientState`;
  const clientValue = serializeValue(clientState);
  speculativeTree.set(clientPath, clientValue);
  
  // If a consensus state is provided, also add it to the tree.
  // Consensus states are snapshots of the counterparty chain at specific heights.
  // They're used for proof verification - when verifying a packet commitment,
  // we need the consensus state at the height the commitment was made.
  //
  // IBC path: clients/{clientId}/consensusStates/{height}
  if (consensusState && consensusHeight !== undefined) {
    const heightStr = String(consensusHeight);
    const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;
    const consensusValue = serializeValue(consensusState);
    speculativeTree.set(consensusPath, consensusValue);
    console.log(`Added consensus state for ${clientId} at height ${heightStr}`);
  }
  
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
 * Compute the new root for CreateClient, and also return the per-key update witnesses.
 *
 * The on-chain `host_state_stt` validator requires these witnesses to enforce that the
 * new `ibc_state_root` is derived from the old root, not an arbitrary value.
 */
export function computeRootWithCreateClientUpdate(
  oldRoot: string,
  clientId: string,
  clientStateValue: Buffer,
  consensusStateValue: Buffer,
  consensusHeight: string | number | bigint,
): CreateClientStateRootResult {
  const speculativeTree = getClonedTreeFromRoot(oldRoot);

  const clientPath = `clients/${clientId}/clientState`;
  const clientStateSiblings = speculativeTree.getSiblings(clientPath).map((h) => h.toString('hex'));
  speculativeTree.set(clientPath, clientStateValue);

  const heightStr = String(consensusHeight);
  const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;
  const consensusStateSiblings = speculativeTree
    .getSiblings(consensusPath)
    .map((h) => h.toString('hex'));
  speculativeTree.set(consensusPath, consensusStateValue);

  const newRoot = speculativeTree.getRoot();

  return {
    newRoot,
    clientStateSiblings,
    consensusStateSiblings,
    commit: () => {
      currentTree = speculativeTree;
      console.log(`Committed CreateClient: ${clientId}, new root: ${newRoot.substring(0, 16)}...`);
    },
  };
}

/**
 * Compute the new root for UpdateClient, and also return the per-key update witnesses.
 *
 * Why this exists
 * The on-chain `host_state_stt` validator must be able to prove that the new
 * `ibc_state_root` is derived from the old one, not an arbitrary value chosen by
 * an operator/relayer. It does that by replaying the same key updates using the
 * sibling hashes we provide here.
 *
 * What this updates in the tree
 * - `clients/{clientId}/clientState` (always)
 * - A set of removed consensus states (0+ deletions)
 * - At most one newly inserted consensus state (0 or 1 insertion)
 *
 * IMPORTANT: Ordering matters.
 * The validator applies updates in a fixed order, and sibling hashes must be
 * computed against the tree *at the moment the update is applied*.
 */
export function computeRootWithUpdateClientUpdate(
  oldRoot: string,
  clientId: string,
  newClientStateValue: Buffer,
  removedConsensusHeights: Array<string | number | bigint>,
  addedConsensusState:
    | {
        height: string | number | bigint;
        value: Buffer;
      }
    | undefined,
): UpdateClientStateRootResult {
  const speculativeTree = getClonedTreeFromRoot(oldRoot);

  // 1) Client state update.
  const clientPath = `clients/${clientId}/clientState`;
  if (!speculativeTree.get(clientPath)) {
    throw new Error(
      `UpdateClient root update expects existing clientState at '${clientPath}', but it was not found in the tree`,
    );
  }
  const clientStateSiblings = speculativeTree.getSiblings(clientPath).map((h) => h.toString('hex'));
  speculativeTree.set(clientPath, newClientStateValue);

  // 2) Consensus state deletions (in the order provided by the caller).
  const removedConsensusStateSiblings: string[][] = [];
  for (const height of removedConsensusHeights) {
    const heightStr = String(height);
    const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;

    if (!speculativeTree.get(consensusPath)) {
      throw new Error(
        `UpdateClient root update expects existing consensusState at '${consensusPath}', but it was not found in the tree`,
      );
    }

    const siblings = speculativeTree.getSiblings(consensusPath).map((h) => h.toString('hex'));
    removedConsensusStateSiblings.push(siblings);

    // Deletion is modeled as "set to empty", which collapses back to the empty hash on-chain.
    speculativeTree.set(consensusPath, Buffer.alloc(0));
  }

  // 3) Optional consensus state insertion (exactly one for normal UpdateClient, none for misbehaviour).
  let consensusStateSiblings: string[] = [];
  if (addedConsensusState) {
    const heightStr = String(addedConsensusState.height);
    const consensusPath = `clients/${clientId}/consensusStates/${heightStr}`;

    // For an insertion, the old value must be absent at this point in the update sequence.
    if (speculativeTree.get(consensusPath)) {
      throw new Error(
        `UpdateClient root update expects no consensusState at '${consensusPath}' before insertion, but one already exists`,
      );
    }

    consensusStateSiblings = speculativeTree.getSiblings(consensusPath).map((h) => h.toString('hex'));
    speculativeTree.set(consensusPath, addedConsensusState.value);
  }

  const newRoot = speculativeTree.getRoot();

  return {
    newRoot,
    clientStateSiblings,
    consensusStateSiblings,
    removedConsensusStateSiblings,
    commit: () => {
      currentTree = speculativeTree;
      console.log(`Committed UpdateClient: ${clientId}, new root: ${newRoot.substring(0, 16)}...`);
    },
  };
}

/**
 * Compute the new root for CreateConnection, and also return the per-key update witness.
 *
 * The on-chain `host_state_stt` validator requires this witness to enforce that the
 * new `ibc_state_root` is derived from the old root, not an arbitrary value.
 */
export function computeRootWithCreateConnectionUpdate(
  oldRoot: string,
  connectionId: string,
  connectionValue: Buffer,
): CreateConnectionStateRootResult {
  const speculativeTree = getClonedTreeFromRoot(oldRoot);

  const path = `connections/${connectionId}`;
  const connectionSiblings = speculativeTree.getSiblings(path).map((h) => h.toString('hex'));
  speculativeTree.set(path, connectionValue);

  const newRoot = speculativeTree.getRoot();

  return {
    newRoot,
    connectionSiblings,
    commit: () => {
      currentTree = speculativeTree;
      console.log(`Committed CreateConnection: ${connectionId}, new root: ${newRoot.substring(0, 16)}...`);
    },
  };
}

/**
 * Compute the new root for CreateChannel, and also return the per-key update witnesses.
 *
 * The on-chain `host_state_stt` validator requires these witnesses to enforce that the
 * new `ibc_state_root` is derived from the old root, not an arbitrary value.
 */
export function computeRootWithCreateChannelUpdate(
  oldRoot: string,
  portId: string,
  channelId: string,
  channelValue: Buffer,
  nextSequenceSendValue: Buffer,
  nextSequenceRecvValue: Buffer,
  nextSequenceAckValue: Buffer,
): CreateChannelStateRootResult {
  const speculativeTree = getClonedTreeFromRoot(oldRoot);

  const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
  const channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
  speculativeTree.set(channelPath, channelValue);

  const nextSequenceSendPath = `nextSequenceSend/ports/${portId}/channels/${channelId}`;
  const nextSequenceSendSiblings = speculativeTree
    .getSiblings(nextSequenceSendPath)
    .map((h) => h.toString('hex'));
  speculativeTree.set(nextSequenceSendPath, nextSequenceSendValue);

  const nextSequenceRecvPath = `nextSequenceRecv/ports/${portId}/channels/${channelId}`;
  const nextSequenceRecvSiblings = speculativeTree
    .getSiblings(nextSequenceRecvPath)
    .map((h) => h.toString('hex'));
  speculativeTree.set(nextSequenceRecvPath, nextSequenceRecvValue);

  const nextSequenceAckPath = `nextSequenceAck/ports/${portId}/channels/${channelId}`;
  const nextSequenceAckSiblings = speculativeTree.getSiblings(nextSequenceAckPath).map((h) => h.toString('hex'));
  speculativeTree.set(nextSequenceAckPath, nextSequenceAckValue);

  const newRoot = speculativeTree.getRoot();

  return {
    newRoot,
    channelSiblings,
    nextSequenceSendSiblings,
    nextSequenceRecvSiblings,
    nextSequenceAckSiblings,
    commit: () => {
      currentTree = speculativeTree;
      console.log(
        `Committed CreateChannel: ${portId}/${channelId}, new root: ${newRoot.substring(0, 16)}...`,
      );
    },
  };
}

/**
 * Compute the new root for UpdateChannel (handshake continuation), and also return the per-key update witness.
 *
 * The on-chain `host_state_stt` validator requires this witness to enforce that the
 * new `ibc_state_root` is derived from the old root, not an arbitrary value.
 */
export function computeRootWithUpdateChannelUpdate(
  oldRoot: string,
  portId: string,
  channelId: string,
  channelValue: Buffer,
): UpdateChannelStateRootResult {
  const speculativeTree = getClonedTreeFromRoot(oldRoot);

  const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
  const channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
  speculativeTree.set(channelPath, channelValue);

  const newRoot = speculativeTree.getRoot();

  return {
    newRoot,
    channelSiblings,
    commit: () => {
      currentTree = speculativeTree;
      console.log(`Committed UpdateChannel: ${portId}/${channelId}, new root: ${newRoot.substring(0, 16)}...`);
    },
  };
}

/**
 * Compute the new root for HandlePacket (Send/Recv/Ack/Timeout), and return the per-key update witnesses.
 *
 * This mirrors `validate_handle_packet_root` in `cardano/onchain/validators/host_state_stt.ak`.
 *
 * The packet store lives inside the ChannelDatum:
 * - packet commitments (insert on SendPacket, delete on Ack/Timeout)
 * - packet receipts (insert on RecvPacket for unordered channels)
 * - packet acknowledgements (insert when the module writes an acknowledgement)
 *
 * We derive which keys changed by diffing the old vs new ChannelDatum, then we
 * apply those key updates in the exact same order the validator uses.
 */
export async function computeRootWithHandlePacketUpdate(
  oldRoot: string,
  portId: string,
  channelId: string,
  inputChannelDatum: ChannelDatum,
  outputChannelDatum: ChannelDatum,
  Lucid: typeof import('@lucid-evolution/lucid'),
): Promise<HandlePacketStateRootResult> {
  const speculativeTree = getClonedTreeFromRoot(oldRoot);
  const { Data } = Lucid;

  // Helper that encodes `cbor.serialise(ByteArray)` (Aiken) for packet store values.
  // In Lucid, `Data.to(bytes, Data.Bytes())` produces the same CBOR bytestring encoding.
  const encodePacketStoreValue = (bytesHex: string): Buffer =>
    Buffer.from(Data.to(bytesHex, Data.Bytes() as any) as any, 'hex');

  // 1) Channel end update (rare in packet handling, but possible for ordered timeouts/close logic).
  const channelPath = `channelEnds/ports/${portId}/channels/${channelId}`;
  let channelSiblings: string[] = [];
  if (inputChannelDatum.state.channel !== outputChannelDatum.state.channel) {
    const newChannelValue = Buffer.from(
      await encodeChannelEndValue(outputChannelDatum.state.channel, Lucid),
      'hex',
    );
    channelSiblings = speculativeTree.getSiblings(channelPath).map((h) => h.toString('hex'));
    speculativeTree.set(channelPath, newChannelValue);
  }

  // 2) nextSequenceSend update (SendPacket).
  const nextSequenceSendPath = `nextSequenceSend/ports/${portId}/channels/${channelId}`;
  let nextSequenceSendSiblings: string[] = [];
  if (inputChannelDatum.state.next_sequence_send !== outputChannelDatum.state.next_sequence_send) {
    const newValue = Buffer.from(
      Data.to(outputChannelDatum.state.next_sequence_send as any, Data.Integer() as any),
      'hex',
    );
    nextSequenceSendSiblings = speculativeTree.getSiblings(nextSequenceSendPath).map((h) => h.toString('hex'));
    speculativeTree.set(nextSequenceSendPath, newValue);
  }

  // 3) nextSequenceRecv update (RecvPacket on ordered channels).
  const nextSequenceRecvPath = `nextSequenceRecv/ports/${portId}/channels/${channelId}`;
  let nextSequenceRecvSiblings: string[] = [];
  if (inputChannelDatum.state.next_sequence_recv !== outputChannelDatum.state.next_sequence_recv) {
    const newValue = Buffer.from(
      Data.to(outputChannelDatum.state.next_sequence_recv as any, Data.Integer() as any),
      'hex',
    );
    nextSequenceRecvSiblings = speculativeTree.getSiblings(nextSequenceRecvPath).map((h) => h.toString('hex'));
    speculativeTree.set(nextSequenceRecvPath, newValue);
  }

  // 4) nextSequenceAck update (AcknowledgePacket on ordered channels).
  const nextSequenceAckPath = `nextSequenceAck/ports/${portId}/channels/${channelId}`;
  let nextSequenceAckSiblings: string[] = [];
  if (inputChannelDatum.state.next_sequence_ack !== outputChannelDatum.state.next_sequence_ack) {
    const newValue = Buffer.from(
      Data.to(outputChannelDatum.state.next_sequence_ack as any, Data.Integer() as any),
      'hex',
    );
    nextSequenceAckSiblings = speculativeTree.getSiblings(nextSequenceAckPath).map((h) => h.toString('hex'));
    speculativeTree.set(nextSequenceAckPath, newValue);
  }

  // 5) Packet commitment insertion/deletion.
  //
  // A single packet operation should only change ONE commitment:
  // - SendPacket inserts exactly one commitment
  // - AckPacket/TimeoutPacket delete exactly one commitment
  const inputCommitments = Array.from(inputChannelDatum.state.packet_commitment.entries());
  const outputCommitments = Array.from(outputChannelDatum.state.packet_commitment.entries());

  const insertedCommitments = outputCommitments.filter(([seq]) => !inputChannelDatum.state.packet_commitment.has(seq));
  const removedCommitments = inputCommitments.filter(([seq]) => !outputChannelDatum.state.packet_commitment.has(seq));

  let packetCommitmentSiblings: string[] = [];
  if (insertedCommitments.length > 0) {
    if (removedCommitments.length !== 0 || insertedCommitments.length !== 1) {
      throw new Error(
        `HandlePacket root update expects exactly one commitment insertion and no deletions; got ${insertedCommitments.length} insertions and ${removedCommitments.length} deletions`,
      );
    }
    const [sequence, commitmentBytes] = insertedCommitments[0];
    const key = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
    const newValue = encodePacketStoreValue(commitmentBytes);

    packetCommitmentSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
    speculativeTree.set(key, newValue);
  } else if (removedCommitments.length > 0) {
    if (removedCommitments.length !== 1) {
      throw new Error(
        `HandlePacket root update expects exactly one commitment deletion; got ${removedCommitments.length}`,
      );
    }
    const [sequence] = removedCommitments[0];
    const key = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;

    packetCommitmentSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
    speculativeTree.set(key, Buffer.alloc(0));
  }

  // 6) Packet receipt insertion (unordered RecvPacket).
  const inputReceipts = Array.from(inputChannelDatum.state.packet_receipt.entries());
  const outputReceipts = Array.from(outputChannelDatum.state.packet_receipt.entries());

  const insertedReceipts = outputReceipts.filter(([seq]) => !inputChannelDatum.state.packet_receipt.has(seq));
  const removedReceipts = inputReceipts.filter(([seq]) => !outputChannelDatum.state.packet_receipt.has(seq));

  let packetReceiptSiblings: string[] = [];
  if (insertedReceipts.length > 0) {
    if (removedReceipts.length !== 0 || insertedReceipts.length !== 1) {
      throw new Error(
        `HandlePacket root update expects receipts to only ever insert a single entry; got ${insertedReceipts.length} insertions and ${removedReceipts.length} deletions`,
      );
    }
    const [sequence, receiptBytes] = insertedReceipts[0];
    const key = `receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
    const newValue = encodePacketStoreValue(receiptBytes);

    packetReceiptSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
    speculativeTree.set(key, newValue);
  } else if (removedReceipts.length > 0) {
    throw new Error(`HandlePacket root update does not allow receipt deletions`);
  }

  // 7) Packet acknowledgement insertion.
  const inputAcks = Array.from(inputChannelDatum.state.packet_acknowledgement.entries());
  const outputAcks = Array.from(outputChannelDatum.state.packet_acknowledgement.entries());

  const insertedAcks = outputAcks.filter(([seq]) => !inputChannelDatum.state.packet_acknowledgement.has(seq));
  const removedAcks = inputAcks.filter(([seq]) => !outputChannelDatum.state.packet_acknowledgement.has(seq));

  let packetAcknowledgementSiblings: string[] = [];
  if (insertedAcks.length > 0) {
    if (removedAcks.length !== 0 || insertedAcks.length !== 1) {
      throw new Error(
        `HandlePacket root update expects acknowledgements to only ever insert a single entry; got ${insertedAcks.length} insertions and ${removedAcks.length} deletions`,
      );
    }
    const [sequence, ackBytes] = insertedAcks[0];
    const key = `acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
    const newValue = encodePacketStoreValue(ackBytes);

    packetAcknowledgementSiblings = speculativeTree.getSiblings(key).map((h) => h.toString('hex'));
    speculativeTree.set(key, newValue);
  } else if (removedAcks.length > 0) {
    throw new Error(`HandlePacket root update does not allow acknowledgement deletions`);
  }

  const newRoot = speculativeTree.getRoot();

  return {
    newRoot,
    channelSiblings,
    nextSequenceSendSiblings,
    nextSequenceRecvSiblings,
    nextSequenceAckSiblings,
    packetCommitmentSiblings,
    packetReceiptSiblings,
    packetAcknowledgementSiblings,
    commit: () => {
      currentTree = speculativeTree;
      console.log(
        `Committed HandlePacket: ${portId}/${channelId}, new root: ${newRoot.substring(0, 16)}...`,
      );
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
  portNumber: number | bigint,
  portValue: Buffer,
): BindPortStateRootResult {
  const speculativeTree = getClonedTreeFromRoot(oldRoot);

  // IBC host store key for port binding.
  //
  // Cosmos uses `ports/{portId}`. For Cardano we represent a port identifier as
  // `port-{n}` where `n` is the numeric port index.
  const portId = `port-${portNumber.toString()}`;
  const path = `ports/${portId}`;

  // The on-chain validator replays this update using the per-level sibling hashes.
  const portSiblings = speculativeTree.getSiblings(path).map((h) => h.toString('hex'));
  speculativeTree.set(path, portValue);

  const newRoot = speculativeTree.getRoot();

  return {
    newRoot,
    portSiblings,
    commit: () => {
      currentTree = speculativeTree;
      console.log(`Committed port bind: ${portId}, new root: ${newRoot.substring(0, 16)}...`);
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

    // Bound ports are part of the committed IBC store (`ports/{portId}`).
    //
    // The HostState datum stores ports as integers, but the committed key uses the
    // `port-{n}` identifier format. The value is simply the CBOR/PlutusData encoding
    // of the integer, which acts as a non-empty "is bound" marker.
    const boundPorts = hostStateDatum.state.bound_port ?? [];
    if (boundPorts.length > 0) {
      const { Data } = lucidService.LucidImporter;
      for (const portNumber of boundPorts) {
        const portId = `port-${portNumber.toString()}`;
        const portValue = Buffer.from(Data.to(portNumber as any, Data.Integer() as any), 'hex');
        tree.set(`ports/${portId}`, portValue);
      }
      console.log(`Added ${boundPorts.length} bound port(s)`);
    }
    
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
      
      const clientStateValue = Buffer.from(
        await encodeClientStateValue(clientDatum.state.clientState, lucidService.LucidImporter),
        'hex',
      );
      // Add client state to tree
      // ICS-24 path: clients/{clientId}/clientState
      tree.set(`clients/${clientId}/clientState`, clientStateValue);
      
      // Add all consensus states to tree
      // ICS-24 path: clients/{clientId}/consensusStates/{height}
      // The consensusStates map stores consensus state snapshots at various heights.
      // These are needed for proof generation when verifying packet commitments, etc.
      const consensusStates = clientDatum.state.consensusStates;
      if (consensusStates && (consensusStates instanceof Map || typeof consensusStates === 'object')) {
        // Handle both Map and plain object (depending on how it was decoded)
        const entries = consensusStates instanceof Map 
          ? Array.from(consensusStates.entries())
          : Object.entries(consensusStates);
        
        for (const [heightKey, consensusState] of entries) {
          // Height key format varies - could be object {revisionNumber, revisionHeight} or string
          let heightStr: string;
          if (typeof heightKey === 'object' && heightKey !== null) {
            // Height is an object like {revisionNumber: 0, revisionHeight: 123}
            const h = heightKey as { revisionNumber?: bigint | number; revisionHeight?: bigint | number };
            heightStr = `${h.revisionHeight || 0}`;
          } else {
            heightStr = String(heightKey);
          }
          const consensusValue = Buffer.from(
            await encodeConsensusStateValue(consensusState, lucidService.LucidImporter),
            'hex',
          );
          
          tree.set(`clients/${clientId}/consensusStates/${heightStr}`, consensusValue);
        }
        console.log(`  Added client: ${clientId} with ${entries.length} consensus state(s)`);
      } else {
        console.log(`  Added client: ${clientId} (no consensus states)`);
      }
    }
    
    // Query and add all Connection UTXOs
    const connectionUtxos = await kupoService.queryAllConnectionUtxos();
    console.log(`Found ${connectionUtxos.length} connection UTXOs`);
    
    for (const connectionUtxo of connectionUtxos) {
      if (!connectionUtxo.datum) continue;
      
      const connectionDatum = await lucidService.decodeDatum(connectionUtxo.datum, 'connection');
      const connectionUnit = Object.keys(connectionUtxo.assets || {}).find((unit) => unit !== 'lovelace');
      if (!connectionUnit || connectionUnit.length <= 56) continue;

      const tokenNameHex = connectionUnit.slice(56);
      if (tokenNameHex.length < 48 + 2) continue;

      // Token names follow the auth scheme:
      // - first 20 bytes: base token hash
      // - next 4 bytes: prefix hash
      // - remaining bytes: sequence (UTF-8 digits)
      const postfixHex = tokenNameHex.slice(48);
      const connectionSequenceStr = Buffer.from(postfixHex, 'hex').toString('utf8');
      if (!/^\d+$/.test(connectionSequenceStr)) continue;

      const connectionId = `connection-${connectionSequenceStr}`;

      const connectionValue = Buffer.from(
        await encodeConnectionEndValue(connectionDatum.state, lucidService.LucidImporter),
        'hex',
      );
      tree.set(`connections/${connectionId}`, connectionValue);
      
      console.log(`  Added connection: ${connectionId}`);
    }
    
    // Query and add all Channel UTXOs
    const channelUtxos = await kupoService.queryAllChannelUtxos();
    console.log(`Found ${channelUtxos.length} channel UTXOs`);
    
    for (const channelUtxo of channelUtxos) {
      if (!channelUtxo.datum) continue;
      
      const channelDatum = await lucidService.decodeDatum(channelUtxo.datum, 'channel');
      const channelUnit = Object.keys(channelUtxo.assets || {}).find((unit) => unit !== 'lovelace');
      if (!channelUnit || channelUnit.length <= 56) continue;

      const tokenNameHex = channelUnit.slice(56);
      if (tokenNameHex.length < 48 + 2) continue;

      // Token names follow the auth scheme:
      // - first 20 bytes: base token hash
      // - next 4 bytes: prefix hash
      // - remaining bytes: sequence (UTF-8 digits)
      const postfixHex = tokenNameHex.slice(48);
      const channelSequenceStr = Buffer.from(postfixHex, 'hex').toString('utf8');
      if (!/^\d+$/.test(channelSequenceStr)) continue;

      const channelId = `channel-${channelSequenceStr}`;

      const portHex = (channelDatum as any).port;
      const portId = portHex ? Buffer.from(portHex, 'hex').toString('utf8') : 'transfer';

      const channelValue = Buffer.from(
        await encodeChannelEndValue(channelDatum.state.channel, lucidService.LucidImporter),
        'hex',
      );
      tree.set(`channelEnds/ports/${portId}/channels/${channelId}`, channelValue);

      const { Data } = lucidService.LucidImporter;
      const nextSequenceSendValue = Buffer.from(
        Data.to(channelDatum.state.next_sequence_send as any, Data.Integer() as any),
        'hex',
      );
      const nextSequenceRecvValue = Buffer.from(
        Data.to(channelDatum.state.next_sequence_recv as any, Data.Integer() as any),
        'hex',
      );
      const nextSequenceAckValue = Buffer.from(
        Data.to(channelDatum.state.next_sequence_ack as any, Data.Integer() as any),
        'hex',
      );

      tree.set(`nextSequenceSend/ports/${portId}/channels/${channelId}`, nextSequenceSendValue);
      tree.set(`nextSequenceRecv/ports/${portId}/channels/${channelId}`, nextSequenceRecvValue);
      tree.set(`nextSequenceAck/ports/${portId}/channels/${channelId}`, nextSequenceAckValue);

      // Packet store (commitments / receipts / acknowledgements).
      //
      // Each entry is stored under its ICS-24 path, and the value is the CBOR encoding
      // of the raw bytes (equivalent to Aiken `cbor.serialise(ByteArray)`).
      //
      // This matters for receipts: the receipt bytes are often empty, but an *empty*
      // receipt still needs to be distinguishable from "no receipt exists".
      // CBOR encoding of empty bytes is `0x40`, which is non-empty and therefore
      // survives the commitment scheme.
      const packetCommitments = (channelDatum as any).state.packet_commitment as Map<bigint, string>;
      const packetReceipts = (channelDatum as any).state.packet_receipt as Map<bigint, string>;
      const packetAcks = (channelDatum as any).state.packet_acknowledgement as Map<bigint, string>;

      const BytesSchema = Data.Bytes() as any;

      for (const [sequence, bytesHex] of packetCommitments.entries()) {
        const key = `commitments/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
        const value = Buffer.from(Data.to(bytesHex, BytesSchema) as any, 'hex');
        tree.set(key, value);
      }
      for (const [sequence, bytesHex] of packetReceipts.entries()) {
        const key = `receipts/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
        const value = Buffer.from(Data.to(bytesHex, BytesSchema) as any, 'hex');
        tree.set(key, value);
      }
      for (const [sequence, bytesHex] of packetAcks.entries()) {
        const key = `acks/ports/${portId}/channels/${channelId}/sequences/${sequence.toString()}`;
        const value = Buffer.from(Data.to(bytesHex, BytesSchema) as any, 'hex');
        tree.set(key, value);
      }
      
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
 * Replace the canonical in-memory tree.
 *
 * This is used by startup logic that can hydrate the tree from a persisted cache
 * (then verify it against the on-chain HostState commitment root).
 */
export function setCurrentTree(tree: ICS23MerkleTree): void {
  currentTree = tree;
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
