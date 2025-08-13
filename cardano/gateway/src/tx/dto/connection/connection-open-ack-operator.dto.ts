import { Height } from 'src/shared/types/height';
import { MerkleProof } from '@shared/types/isc-23/merkle';
import { MithrilClientState } from '@shared/types/mithril';

export type ConnectionOpenAckOperator = {
  connectionSequence: string;
  counterpartyClientState: MithrilClientState;
  counterpartyConnectionID: string;
  proofTry: MerkleProof;
  proofClient: MerkleProof;
  proofHeight: Height;
};
