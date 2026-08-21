import { Height } from '@shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';

export type PrunePacketHistoryOperator = {
  portId: string;
  channelId: string;
  sequence: bigint;
  proofCommitmentAbsence: MerkleProof;
  proofHeight: Height;
  signer: string;
};
