import { ClientState } from '../client-state-types';
import { ConsensusState } from '../consensus-state';
import { Height } from '../height';
import { MerklePath, MerkleProof } from '../isc-23/merkle';

export type VerifyMembershipParams = {
  cs: ClientState;
  cons_state: ConsensusState;
  height: Height;
  processed_time: bigint;
  processed_height: bigint;
  delay_time_period: bigint;
  delay_block_period: bigint;
  proof: MerkleProof;
  path: MerklePath;
  value: string;
};
