import { BlockData } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';

export function normalizeBlockDataFromOuroboros(blockDataRes: any): BlockData {
  const blockdata: BlockData = {
    /** Block number */
    height: {
      revision_number: 0,
      /** the height within the given revision */
      revision_height: blockDataRes.block_no,
    },
    /** Slot number */
    slot: blockDataRes.slot,
    /** Block hash */
    hash: blockDataRes.hash,
    /** Hash of previous block */
    prev_hash: blockDataRes.prev_hash,
    /** Epoch number */
    epoch_no: blockDataRes.epoch_no,
    /** Hex string of block header to cbor */
    header_cbor: blockDataRes.header_cbor,
    /** Hex string of block txs to cbor */
    body_cbor: blockDataRes.body_cbor,
    /**
     * Hex string of current epoch's epoch nonce, calculated at the start of each epoch,
     * calculated by evolving nonce of block inside epoch and last block nonce of prev block
     * Used to construct vrf value, also to verify slot leader is valid
     */
    epoch_nonce: blockDataRes.epoch_nonce,
    /** Time stamp of current block */
    timestamp: blockDataRes.timestamp,
    /** Chain id */
    chain_id: blockDataRes.chain_id,
  } as unknown as BlockData;

  return blockdata;
}
