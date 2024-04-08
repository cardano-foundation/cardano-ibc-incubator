import { Height } from 'src/shared/types/height';
import { MerkleProof } from '../../../shared/types/isc-23/merkle';

export type AckPacketOperator = {
  channelId: string;
  packetSequence: bigint;
  packetData: string;
  proofHeight: Height;
  proofAcked: MerkleProof;
  acknowledgement: string;
  timeoutHeight: Height;
  timeoutTimestamp: bigint;
};
