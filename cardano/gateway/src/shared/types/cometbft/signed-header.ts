import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { Commit, validateBasic as validateCommitBasic } from './commit';
import { TmHeader, validateBasic as validateTmHeaderBasic } from './header';

export type SignedHeader = {
  header: TmHeader;
  commit: Commit;
};

export function validateBasic(sh: SignedHeader, chainID: string) {
  if (!sh.header) {
    throw new GrpcInvalidArgumentException('missing header');
  }
  if (!sh.commit) {
    throw new GrpcInvalidArgumentException('missing commit');
  }

  validateTmHeaderBasic(sh.header);
  validateCommitBasic(sh.commit);

  if (sh.header.chainId !== chainID) {
    throw new GrpcInvalidArgumentException(`header belongs to another chain ${sh.header.chainId}, not ${chainID}`);
  }

  // Make sure the header is consistent with the commit.
  if (sh.commit.height !== sh.header.height) {
    throw new GrpcInvalidArgumentException(
      `header and commit height mismatch: ${sh.commit.height} vs ${sh.header.height}`,
    );
  }
}
