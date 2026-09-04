import { MerkleProof } from '@shared/types/isc-23/merkle';

import { TimeoutPacketOperator } from './timeout-packet-operator.dto';

export type TimeoutOnClosePacketOperator = TimeoutPacketOperator & {
  proofClose: MerkleProof;
};
