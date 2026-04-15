import { Height } from 'src/shared/types/height';

export type SendModulePacketOperator = {
  sourcePort: string;
  sourceChannel: string;
  signer: string;
  packetData: string;
  timeoutHeight: Height;
  timeoutTimestamp: bigint;
};
