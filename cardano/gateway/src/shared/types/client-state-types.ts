// import { type Data } from '@cuonglv0297/lucid-custom';
import { CardanoClientState } from './cardano';
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
