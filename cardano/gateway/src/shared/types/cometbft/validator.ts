import { GrpcInvalidArgumentException } from '~@/exception/grpc_exceptions';
import { CRYPTO_ADDRESS_SIZE } from '../../../constant';

export type Validator = {
  address: string;
  pubkey: string;
  votingPower: bigint;
  proposerPriority: bigint;
};

// ValidateBasic performs basic validation.
export function validateBasic(v: Validator) {
  if (!v) {
    throw new GrpcInvalidArgumentException('nil validator');
  }
  if (!v.pubkey) {
    throw new GrpcInvalidArgumentException('validator does not have a public key');
  }

  if (v.votingPower < 0) {
    throw new GrpcInvalidArgumentException('validator has negative voting power');
  }

  if (v.address.length / 2 !== CRYPTO_ADDRESS_SIZE) {
    throw new GrpcInvalidArgumentException(`validator address is the wrong size: ${v.address}`);
  }
}
