import { Height } from '../../../shared/types/height';

export type PruneConsensusStateOperatorDto = {
  clientId: string;
  height: Height;
  constructedAddress: string;
};
