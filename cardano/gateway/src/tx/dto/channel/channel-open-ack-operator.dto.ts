import { Height } from 'src/shared/types/height';

export type ChannelOpenAckOperator = {
  channelSequence: string;
  counterpartyChannelId: string;
  counterpartyVersion: string;
  proofTry: string; // hex string
  proofHeight: Height;
};
