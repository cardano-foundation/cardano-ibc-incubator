import { BlockData } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';
import { BlockDto } from '../../query/dtos/block.dto';
import { BlockHeaderDto } from '../modules/mini-protocals/dtos/block-header.dto';

// Legacy helper for the old Ouroboros/Cardano light client approach.
// Not part of the current production relaying flow (which uses Mithril headers + ICS-23 proofs).
export function normalizeBlockDataFromOuroboros(
  blockDataRes: BlockDto,
  blockHeaderDto?: BlockHeaderDto | null,
): BlockData {
  const blockdata: BlockData = {
    /**
     * IBC height semantics:
     * - `revision_height` is a Cardano block height (db-sync `block_no`) surfaced as an IBC Height.
     * - Cardano `slot` is tracked separately; it is not used as the IBC height, but it matters for
     *   Cardano-specific time/validity and horizon rules (slot-based).
     */
    height: {
      revision_number: 0,
      /** the height within the given revision */
      revision_height: blockDataRes.height,
    },
    /** Slot number */
    slot: blockDataRes.slot,
    /** Block hash */
    hash: blockDataRes.hash,
    /** Hash of previous block */
    prev_hash: blockHeaderDto?.prevHash ?? '',
    /** Epoch number */
    epoch_no: blockDataRes.epoch,
    /** Hex string of block header to cbor */
    header_cbor: blockHeaderDto?.headerCbor ?? '',
    /** Hex string of block txs to cbor */
    body_cbor: blockHeaderDto?.bodyCbor ?? '',
    /**
     * Hex string of current epoch's epoch nonce, calculated at the start of each epoch,
     * calculated by evolving nonce of block inside epoch and last block nonce of prev block
     * Used to construct vrf value, also to verify slot leader is valid
     */
    epoch_nonce: '',
    /** Time stamp of current block */
    timestamp: blockDataRes.timestamp,
    /** Chain id */
    chain_id: '',
  } as unknown as BlockData;

  return blockdata;
}
