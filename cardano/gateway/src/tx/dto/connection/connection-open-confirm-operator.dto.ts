import { Height } from 'src/shared/types/height';

export type ConnectionOpenConfirmOperator = {
  connectionSequence: string;
  proofAck: string;
  proofHeight: Height;
};
