// import { type Data } from 'lucid-cardano';
import { Height } from './height';
import { ProofSpec } from './proof-specs';
export type ClientState = {
  chainId: string;
  trustLevel: {
    numerator: bigint;
    denominator: bigint;
  };
  trustingPeriod: bigint;
  unbondingPeriod: bigint;
  maxClockDrift: bigint;
  frozenHeight: Height;
  latestHeight: Height;
  proofSpecs: ProofSpec[];
};
