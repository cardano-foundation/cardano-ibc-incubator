import { Height } from 'src/shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';

export type ConnectionOpenAckOperator = {
  connectionSequence: string;
  counterpartyClientState: string;
  counterpartyClientStateTypeUrl: string;
  counterpartyConnectionID: string;
  proofTry: MerkleProof;
  proofClient: MerkleProof;
  proofHeight: Height;
};
