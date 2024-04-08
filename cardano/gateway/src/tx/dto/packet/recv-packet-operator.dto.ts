import { Height } from 'src/shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';

export type RecvPacketOperator = {
  channelId: string;
  packetSequence: bigint;
  packetData: string;
  proofCommitment: MerkleProof;
  proofHeight: Height;
  timeoutHeight: Height;
  timeoutTimestamp: bigint;
};
