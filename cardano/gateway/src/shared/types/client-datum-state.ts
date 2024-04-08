import { ClientState } from './client-state-types';
import { ConsensusState } from './consensus-state';
import { Height } from './height';

export type ClientDatumState = {
  clientState: ClientState;
  consensusStates: Map<Height, ConsensusState>;
};
