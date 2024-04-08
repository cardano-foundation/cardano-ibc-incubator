export type ConsensusState = {
  timestamp: bigint;
  next_validators_hash: string;
  root: {
    hash: string;
  };
};
