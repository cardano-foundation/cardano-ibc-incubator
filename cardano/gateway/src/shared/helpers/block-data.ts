import { BlockData } from '@plus/proto-types/build/ibc/lightclients/ouroboros/ouroboros';
import { BlockDto } from '../../query/dtos/block.dto';
import { BlockHeaderDto } from '../modules/mini-protocals/dtos/block-header.dto';

export function normalizeBlockDataFromOuroboros(blockDataRes: BlockDto, blockHeaderDto: BlockHeaderDto): BlockData {
  const blockdata: BlockData = {
    /** Block number */
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
    prev_hash: blockHeaderDto.prevHash,
    /** Epoch number */
    epoch_no: blockDataRes.epoch,
    /** Hex string of block header to cbor */
    header_cbor: blockHeaderDto.headerCbor,
    /** Hex string of block txs to cbor */
    body_cbor: blockHeaderDto.bodyCbor,
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
