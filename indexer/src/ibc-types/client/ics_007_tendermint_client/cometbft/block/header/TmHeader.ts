import {Data} from '../../../../../plutus/data';
import {ConsensusSchema} from '../../protos/types_pb/Consensus';
import {BlockIDSchema} from '../block_id/BlockID';

export const TmHeaderSchema = Data.Object({
  chain_id: Data.Bytes(),
  height: Data.Integer(),
  time: Data.Integer(),
  validators_hash: Data.Bytes(),
  next_validators_hash: Data.Bytes(),
  app_hash: Data.Bytes(),
});
export type TmHeader = Data.Static<typeof TmHeaderSchema>;
export const TmHeader = TmHeaderSchema as unknown as TmHeader;
