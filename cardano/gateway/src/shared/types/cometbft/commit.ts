import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import {
  BLOCKID_FLAG_ABSENT,
  BLOCKID_FLAG_COMMIT,
  BLOCKID_FLAG_NIL,
  CRYPTO_ADDRESS_SIZE,
  MAX_SIGNATURE_SIZE,
} from '../../../constant';
import { EPOCH_DIFF_BTW_GO_JS } from '../../../constant/block';

export type PartSetHeader = { total: bigint; hash: string };
export type BlockID = { hash: string; partSetHeader: PartSetHeader };
export type Commit = { height: bigint; round: bigint; blockId: BlockID; signatures: CommitSig[] };
export type CommitSig = { block_id_flag: bigint; validator_address: string; timestamp: bigint; signature: string };

// ValidateBasic performs basic validation that doesn't involve state data.
// Does not actually check the cryptographic signatures.
export function validateBasic(commit: Commit) {
  if (commit.height < 0) {
    throw new GrpcInvalidArgumentException('negative Height');
  }
  if (commit.round < 0) {
    throw new GrpcInvalidArgumentException('negative Round');
  }

  if (commit.height >= 1) {
    if (isZeroBlockId(commit.blockId)) {
      throw new GrpcInvalidArgumentException('commit cannot be for nil block');
    }

    if (commit.signatures.length == 0) {
      throw new GrpcInvalidArgumentException('no signatures in commit');
    }

    for (const commitSig of commit.signatures) {
      validateCommitSigBasic(commitSig);
    }
  }
}

// ValidateBasic performs basic validation.
function validateCommitSigBasic(cs: CommitSig) {
  if (![BLOCKID_FLAG_ABSENT, BLOCKID_FLAG_COMMIT, BLOCKID_FLAG_NIL].includes(BigInt(cs.block_id_flag)))
    throw new GrpcInvalidArgumentException(`unknown BlockIDFlag: ${cs.block_id_flag}`);

  switch (cs.block_id_flag) {
    case BLOCKID_FLAG_ABSENT: {
      if (cs.validator_address.length !== 0) {
        throw new GrpcInvalidArgumentException('validator address is present');
      }
      if (cs.timestamp !== 0n && 0n - cs.timestamp !== EPOCH_DIFF_BTW_GO_JS) {
        throw new GrpcInvalidArgumentException('time is present');
      }
      if (cs.signature.length !== 0) {
        throw new GrpcInvalidArgumentException('signature is present');
      }
      break;
    }
    default:
      if (cs.validator_address.length / 2 !== CRYPTO_ADDRESS_SIZE) {
        throw new GrpcInvalidArgumentException(
          `expected ValidatorAddress size to be ${CRYPTO_ADDRESS_SIZE} bytes, got ${cs.validator_address.length / 2} bytes`,
        );
      }
      // NOTE: Timestamp validation is subtle and handled elsewhere.
      if (cs.signature.length / 2 === 0) {
        throw new GrpcInvalidArgumentException('signature is missing');
      }
      if (cs.signature.length / 2 > MAX_SIGNATURE_SIZE) {
        throw new GrpcInvalidArgumentException(`signature is too big (max: ${MAX_SIGNATURE_SIZE})`);
      }
      break;
  }
}

function isZeroBlockId(block_id: BlockID): boolean {
  return block_id.hash === '' && isZeroPartSetHeader(block_id.partSetHeader);
}

function isZeroPartSetHeader(partSetHeader: PartSetHeader): boolean {
  return partSetHeader.total == 0n && partSetHeader.hash === '';
}
