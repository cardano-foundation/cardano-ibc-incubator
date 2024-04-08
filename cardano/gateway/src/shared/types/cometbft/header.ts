import { GrpcInvalidArgumentException } from 'nestjs-grpc-exceptions';
import { ConsensusState } from '../consensus-state';
import { MAX_CHAIN_ID_LENGTH, TM_HASH_SIZE } from '../../../constant';

export type TmHeader = {
  chainId: string;
  height: bigint;
  time: bigint;
  validatorsHash: string;
  nextValidatorsHash: string;
  appHash: string;
};

// ValidateBasic performs stateless validation on a Header returning an error
// if any validation fails.
//
// NOTE: Timestamp validation is subtle and handled elsewhere.
export function validateBasic(header: TmHeader) {
  if (header.chainId.length > MAX_CHAIN_ID_LENGTH) {
    throw new GrpcInvalidArgumentException(
      `chainID is too long; got: ${header.chainId.length}, max: ${MAX_CHAIN_ID_LENGTH}`,
    );
  }
  if (header.height < 0) {
    throw new GrpcInvalidArgumentException('negative Height');
  }
  validateHash(header.nextValidatorsHash);
}

function validateHash(hash: string): boolean {
  if (hash.length > 0 && hash.length / 2 !== TM_HASH_SIZE) {
    throw new GrpcInvalidArgumentException(`expected size to be ${TM_HASH_SIZE} bytes, got ${hash.length / 2} bytes`);
  }

  return true;
}

// ConsensusState returns the updated consensus state associated with the header
export function getConsensusStateFromTmHeader(h: TmHeader): ConsensusState {
  return <ConsensusState>{
    timestamp: h.time,
    next_validators_hash: h.nextValidatorsHash,
    root: {
      hash: h.appHash,
    },
  };
}
