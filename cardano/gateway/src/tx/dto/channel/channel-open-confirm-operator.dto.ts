import { Height } from 'src/shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';
export type ChannelOpenConfirmOperator = {
  channelSequence: string;
  proofAck: MerkleProof;
  proofHeight: Height;
};
