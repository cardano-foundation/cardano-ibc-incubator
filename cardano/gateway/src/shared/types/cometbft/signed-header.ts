import { Commit } from './commit';
import { TmHeader } from './header';

export type SignedHeader = {
  header: TmHeader;
  commit: Commit;
};
