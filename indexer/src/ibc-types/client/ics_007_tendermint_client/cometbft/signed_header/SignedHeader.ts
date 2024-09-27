import {TmHeaderSchema} from '../block/header/TmHeader';
import {CommitSchema} from '../block/commit/Commit';
import {Data} from '../../../../plutus/data';

export const SignedHeaderSchema = Data.Object({
  header: TmHeaderSchema,
  commit: CommitSchema,
});
export type SignedHeader = Data.Static<typeof SignedHeaderSchema>;
export const SignedHeader = SignedHeaderSchema as unknown as SignedHeader;
