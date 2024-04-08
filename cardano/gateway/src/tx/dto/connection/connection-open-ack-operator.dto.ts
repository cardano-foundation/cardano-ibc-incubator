import { Height } from 'src/shared/types/height';
import { CardanoClientState } from '@shared/types/cardano';
import { MerkleProof } from '@shared/types/isc-23/merkle';

export type ConnectionOpenAckOperator = {
  connectionSequence: string;
  counterpartyClientState: CardanoClientState;
  counterpartyConnectionID: string;
  proofTry: MerkleProof;
  proofClient: MerkleProof;
  proofHeight: Height;
};
