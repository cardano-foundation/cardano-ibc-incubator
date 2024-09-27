import {ClientStateSchema} from '../client_state/ClientState';
import {HeightSchema} from '../height/Height';
import {ConsensusStateSchema} from '../consensus_state/ConsensusState';
import {Data} from '../../../plutus/data';

export const ClientDatumStateSchema = Data.Object({
  client_state: ClientStateSchema,
  consensus_states: Data.Map(HeightSchema, ConsensusStateSchema),
});
export type ClientDatumState = Data.Static<typeof ClientDatumStateSchema>;
export const ClientDatumState = ClientDatumStateSchema as unknown as ClientDatumState;
