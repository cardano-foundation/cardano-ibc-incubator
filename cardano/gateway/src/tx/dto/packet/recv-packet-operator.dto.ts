import { Height } from 'src/shared/types/height';

export type RecvPacketOperator = {
  channelId: string;
  packetSequence: bigint;
  packetData: string;
  proofCommitment: string;
  proofHeight: Height;
  timeoutHeight: Height;
  timeoutTimestamp: bigint;
};
