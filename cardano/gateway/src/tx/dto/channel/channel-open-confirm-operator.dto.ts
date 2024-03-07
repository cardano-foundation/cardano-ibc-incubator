import { Height } from 'src/shared/types/height';
export type ChannelOpenConfirmOperator = {
  channelSequence: string;
  proofAck: string;
  proofHeight: Height;
};
