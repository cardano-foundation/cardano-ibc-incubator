import { Height } from 'src/shared/types/height';

export type Coin = {
  denom: string;
  amount: bigint;
};
export type SendPacketOperator = {
  sourcePort: string;
  sourceChannel: string;
  token: Coin;
  sender: string;
  receiver: string;
  signer: string;
  timeoutHeight: Height;
  timeoutTimestamp: bigint;
  memo: string;
};
