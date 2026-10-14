import { MerkleProof } from '@shared/types/isc-23/merkle';
import { Height } from 'src/shared/types/height';

export type ChannelCloseConfirmOperator = {
  port_id: string;
  channelSequence: string;
  proofInit: MerkleProof;
  proofHeight: Height;
  // Upgrade sequence of the closed counterparty channel that proofInit proves.
  counterpartyUpgradeSequence: bigint;
};
