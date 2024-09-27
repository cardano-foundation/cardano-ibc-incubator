import {Data} from '../../../../../plutus/data';
import {BlockIDSchema} from '../block_id/BlockID';
import {CommitSigSchema} from '../commit_sig/CommitSig';

export const CommitSchema = Data.Object({
  height: Data.Integer(),
  round: Data.Integer(),
  block_id: BlockIDSchema,
  signatures: Data.Array(CommitSigSchema),
});
export type Commit = Data.Static<typeof CommitSchema>;
export const Commit = CommitSchema as unknown as Commit;
