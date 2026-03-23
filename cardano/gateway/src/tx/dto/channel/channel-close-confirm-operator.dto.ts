import { MerkleProof } from '@shared/types/isc-23/merkle';
import { Height } from 'src/shared/types/height';

export type ChannelCloseConfirmOperator = {
  port_id: string;
  channelSequence: string;
  proofInit: MerkleProof;
  proofHeight: Height;
};
