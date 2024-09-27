import {Data} from '../../../../../plutus/data';

export const ConsensusSchema = Data.Object({
  block: Data.Integer(),
  app: Data.Integer(),
});
export type Consensus = Data.Static<typeof ConsensusSchema>;
export const Consensus = ConsensusSchema as unknown as Consensus;
