import { Height } from 'src/shared/types/height';

export type ConnectionOpenAckOperator = {
  connectionSequence: string;
  counterpartyClientState: string;
  counterpartyConnectionID: string;
  proofTry: string;
  proofClient: string;
  proofHeight: Height;
};
