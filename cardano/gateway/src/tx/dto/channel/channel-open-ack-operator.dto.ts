import { Height } from 'src/shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';

export type ChannelOpenAckOperator = {
  channelSequence: string;
  counterpartyChannelId: string;
  counterpartyVersion: string;
  proofTry: MerkleProof; // hex string
  proofHeight: Height;
};
